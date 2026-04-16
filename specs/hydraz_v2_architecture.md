# Hydraz v2 Architecture Document

> This is the original, detailed architecture document produced during the v2 design session.
> It contains the full v1 codebase audit, design-input document synthesis, target architecture
> rationale, detailed artifact schemas, and risk analysis that informed the spec and plan.
>
> **This document is the canonical reference for architectural intent and design reasoning.**
>
> Related documents:
> - `specs/hydraz_v2_spec.md` — the authoritative specification (what and why)
> - `specs/hydraz_v2_plan.md` — the implementation plan (how and when)
>
> All three documents must be read together. The spec and plan must remain aligned with the
> architectural decisions and rationale documented here. Any agent working on v2 must review
> and understand this document before making implementation decisions.
>
> **Post-implementation update:** The core pipeline (Phases 1-9 complete, Phase 10 partial) is working
> for local bare-metal mode. Container-side orchestration is implemented: the host copies `dist/` into the
> container via `tar | ssh` pipe, runs `pipeline-runner.ts` via SSH, and reads the result after exit. The pipeline runs
> identically to local bare-metal mode inside the container -- all Claude invocations are local, no
> per-stage SSH needed. The `containerContext` plumbing that was previously threaded through each stage
> has been removed. Container hello-world verified end-to-end in v2.1.0. Verification phase designed for v2.2 (see spec §18).

---

# Hydraz v2 Swarm Harness Plan

## Design Decisions (Resolved)

All of the following were discussed and confirmed with the project owner:

- **Orchestrator model**: Hydraz TypeScript code is the deterministic supervisor. Claude Code is used only as stateless workers in distinct roles. No persistent Claude orchestrator process.
- **Swarm mode**: Always active. `--swarm` flag exists but is a no-op (swarm pipeline always runs). No backward compatibility with v1 single-process sessions.
- **Worker count**: User-controlled via `--workers N`, default 3.
- **Backward compatibility**: None. Major version bump, breaking changes expected.
- **Personas**: Applied to the review panel (famous engineers). Workers get identical rigorous-implementer prompts. Pipeline stages (investigator, architect, planner) are structural roles with Hydraz-provided prompts.
- **Verification**: Workers themselves are responsible for TDD, tests, lint, build for v2.0. No separate verification stage in v2.0. A post-review verification phase with inner retry loop is planned for v2.2 (see spec §18).
- **Consensus bounds**: Architect-planner loop max 10 rounds (architect has final say at cap). Outer review loop max 5 iterations.
- **Review feedback routing**: Reviewers categorize findings as architectural vs implementation. Both routes rewind to planning via the outer loop; architectural feedback additionally refreshes the architecture design from disk.

---

## 1. Current State

### What Hydraz v1 does today (source facts from the actual repo)

Hydraz v1 runs **one Claude Code process per session**. The "swarm" is prompt theater:

- The master prompt ([`src/core/config/master-prompt.ts`](src/core/config/master-prompt.ts)) describes a 3-persona workflow but it all runs in a single Claude process.
- The v1 prompt builder (`src/core/prompts/builder.ts`) was removed. v2 stages each have their own prompt templates in `src/core/swarm/prompts/`.
- The controller ([`src/core/orchestration/controller.ts`](src/core/orchestration/controller.ts)) now drives `runSwarmPipeline` which transitions through all `SwarmPhase` states. The v1 states `implementing` and `verifying` no longer exist -- replaced by `SwarmPhase`.
- `--dangerously-skip-permissions` is hardcoded in the executor.

### Infrastructure that v2 builds on

- **Workspace providers**: `WorkspaceProvider` interface, `LocalProvider` (git worktrees), `LocalContainerProvider` (DevPod). Creating multiple worktrees for parallel workers is mechanically straightforward.
- **Executor**: `launchClaude()` returns `ExecutorHandle` with `waitForExit()`. Multiple handles can run concurrently.
- **Event system**: JSONL event log per session with typed events.
- **Session model**: State machine, metadata persistence, artifact directory.
- **GitHub delivery**: Push verification and PR creation.
- **57 test files** (v1 base + v2 swarm module tests).

---

## 2. Key Insights from Design-Input Documents

### From the recommendations memo

- Make Hydraz the supervisor, Claude Code the worker runtime
- Externalize everything to artifacts -- file-backed control plane
- Each worker gets isolated workspace + file ownership map
- State machine: explicit fan-out, sync, fan-in phases
- Verification as first-class harness (not prompt theater)

### From the substrate document

- "The moat is in the harness" -- orchestration, not prompt cleverness
- Externalized progress artifacts beat conversation history
- Explicit role separation (planner/executor/reviewer) improves reliability
- Per-tool permissions > blanket bypass (future work)
- Cost/coordination observability is essential for multi-agent systems

---

## 3. Target Architecture

### 3.1 The Pipeline

```
┌─────────────┐
│ Investigate  │  1 Claude instance, read-only repo exploration
└──────┬──────┘
       │ investigation brief
       ▼
┌─────────────┐
│  Architect   │  1 instance, reads investigation, produces design
└──────┬──────┘
       │ architecture doc + recommendations
       ▼
┌─────────────┐
│   Planner    │  1 instance, reads investigation + architecture
└──────┬──────┘
       │ execution plan + task ledger + ownership map + worker briefs
       ▼
┌─────────────┐
│  Architect   │  1 instance, reviews plan, provides feedback
│   Review     │
└──────┬──────┘
       │ approved or feedback
       │
       ├── if feedback ──► back to Planner (max 10 rounds, architect final say)
       │
       ▼ (plan approved)
┌──────┴──────┐
│   Workers    │  N instances, serial by default (default 3, --parallel for concurrent)
│  (fan-out)   │  each in own worktree, strict TDD, prove-it methodology
└──────┬──────┘
       │ code on worker branches
       ▼
┌─────────────┐
│    Merge     │  TypeScript orchestrator, sequential branch merge
│   (fan-in)   │
└──────┬──────┘
       │ integrated branch
       ▼
┌─────────────┐
│   Review     │  3 instances in parallel, famous-engineer personas
│    Panel     │  independent reviews of integrated result
└──────┬──────┘
       │ approved, or categorized feedback
       │
       ├── architectural issues ──► back to Planner (re-plan with refreshed architecture)
       ├── implementation issues ──► back to Planner (re-plan with feedback)
       │   (max 5 outer loops total, then fail)
       │
       ▼ (approved)
┌─────────────┐
│  Verify      │  [v2.2] Run tests + optional E2E per review criteria
│  (planned)   │
└──────┬──────┘
       │ pass, or fail with retry exhausted (deliver with warning)
       │
       ├── test failures ──► single fix-up worker ──► re-verify (max 2-3 attempts)
       │
       ▼
┌─────────────┐
│  Delivery    │  PR creation, cleanup
└─────────────┘
```

### 3.2 Orchestrator (TypeScript supervisor)

The orchestrator is deterministic Hydraz TypeScript code. It:

1. Drives the swarm state machine through all pipeline stages
2. Launches Claude processes for each stage and waits for exit
3. Reads artifacts from disk after each stage completes
4. Validates artifacts before proceeding to the next stage
5. Creates/destroys worktrees for workers
6. Merges worker branches
7. Routes review feedback to the correct loop-back target
8. Tracks per-stage cost, tokens, and timing
9. Handles failures, stalls, and bounds enforcement

The orchestrator makes no AI decisions. It reads files, checks exit codes, and follows the state machine.

### 3.3 Claude Code Roles

Each role is a fresh, stateless `claude --print` invocation with a role-specific prompt.

| Role | Instances | Input | Output |
|------|-----------|-------|--------|
| Investigator | 1 | Task + repo access | `investigation/brief.md` |
| Architect | 1 | Task + investigation | `architecture/design.md` |
| Planner | 1 | Task + investigation + architecture | `plan/plan.md`, `task-ledger.json`, `ownership.json`, worker briefs |
| Architect (review) | 1 | Plan + architecture | Approval or feedback |
| Worker | N (default 3) | Plan + brief + ownership scope | Code commits + `progress.md` |
| Reviewer | 3 | Integrated code + task + plan | Review with categorized findings |

### 3.4 Worker Isolation

**Local mode (v2 starting point):**
- Each worker gets its own git worktree via `createWorktree()`. In serial mode (default), each worker branches from the previous worker's branch so later workers build on earlier workers' commits. In parallel mode (`--parallel`), all workers branch from the same base commit.
- Worker branches: `hydraz/<session>-worker-a`, `-worker-b`, etc.
- Integration branch: `hydraz/<session>` (the session's primary branch)

**Container/cloud mode (implemented):**
- The entire swarm pipeline runs inside a single DevPod container
- The host copies `dist/` via `tar | ssh` pipe, then copies `hydrazincludes` paths from host into container (if `.hydraz/config.json` exists — see §3.11), SSHs in to run `pipeline-runner.ts`, reads the result after exit
- Inside the container, the pipeline runs identically to local bare-metal mode
- Workers use local worktrees inside the container, same as bare-metal mode
- Per-worker DevPod workspaces are not used; one container hosts all workers

### 3.5 Worker Prompts

All workers receive an identical core prompt emphasizing:
- Strict TDD: write failing tests first, then implement, then verify
- Prove-it methodology: no assumptions, verify everything
- Atomic commits with clear messages
- Run tests/lint/build before declaring completion
- Write `progress.md` documenting what was done, what was tested, what's uncertain
- Stay within owned files/paths only -- do not modify files outside your ownership scope
- Interface contracts from the plan are authoritative -- implement against them exactly

Workers are differentiated only by their task brief and file ownership, not by persona.

If the target repo contains a `.hydraz/HYDRAZ.md` file, its contents are injected into all role prompts (investigator, architect, planner, workers, reviewers) — positioned after core role instructions but before task-specific content. See §3.11 for the full repo-level configuration convention.

### 3.6 Review Panel

Three parallel reviewers, each embodying a famous/celebrated software engineer. Each reviewer independently examines the integrated codebase and produces a review document.

**Proposed default panel:**

- **John Carmack** -- Known for relentless correctness, mathematical rigor, and finding subtle bugs. Focuses on: edge cases, error handling, data flow correctness, performance traps, things that will break at 3am.
- **Sandi Metz** -- Known for practical design principles, clean object-oriented architecture, and maintainability. Focuses on: code organization, naming, abstractions, coupling, whether the code is easy to change next month.
- **Linus Torvalds** -- Known for simplicity, brutal rejection of unnecessary complexity, and systems-level clarity. Focuses on: over-engineering, unnecessary abstractions, accidental complexity, whether the code does what it needs to and nothing more.

These three create a triangle of coverage: Carmack finds bugs, Metz finds design debt, Torvalds finds bloat. Their perspectives are well-documented enough for Claude to reliably embody.

The panel is user-configurable per-session via `--reviewers`. Global config for reviewers is not yet implemented.

**Review output format:**

Each reviewer produces a structured review with:
- Overall assessment (approve / changes-requested)
- Categorized findings:
  - `architectural`: design-level issues requiring re-planning
  - `implementation`: code-level issues
- Specific file/line references for each finding

The orchestrator aggregates reviews. If any reviewer requests changes, both feedback types rewind to planning via the outer loop; the architectural/implementation distinction affects whether the architecture design is refreshed from disk before re-planning.

### 3.7 Feedback Loop Routing

When reviewers flag issues:

**Architectural feedback** (back to Planner with refreshed architecture):
- The orchestrator re-reads the architecture design from disk before re-planning
- The outer loop rewinds to planning (consensus) with the refreshed architecture
- Flows through planner -> consensus -> workers -> merge -> review
- The architect is NOT re-invoked; the refresh is a disk re-read, not a new Claude invocation
- Investigation is NOT re-run (repo facts haven't changed from the workers' perspective; the investigation brief from step 1 remains valid)

**Implementation feedback** (back to Planner):
- The outer loop rewinds to planning (consensus), not directly to targeted workers
- The planner re-plans with the review feedback
- New worker fan-out, merge, and review follow
- This is the same outer loop path as architectural feedback; the only distinction is that architectural feedback refreshes the in-memory architecture design from disk before re-planning

**Bounds:**
- Max 5 outer loops total (across both architectural and implementation feedback)
- If cap hit: session transitions to `failed` (controller maps all pipeline non-success to `failed`; `blocked` is for pre-flight issues)

### 3.8 Swarm State Machine

```
created
  -> starting           (auth resolution, provider checks)
  -> investigating       (investigator Claude process)
  -> architecting        (architect Claude process)
  -> planning            (planner Claude process)
  -> architect-reviewing (architect reviews plan)
     -> planning         (if feedback, loop back; max 10 rounds)
  -> fanning-out         (worker worktrees created, worker processes launched)
  -> syncing             (workers running, orchestrator monitors)
  -> merging             (workers done, branches merged to integration)
  -> reviewing           (review panel runs in parallel)
     -> planning         (both feedback types rewind to planning via outer loop)
  -> delivering          (PR creation, cleanup)
  -> completed

Any phase -> failed      (unrecoverable error, pipeline failure, or bounds exceeded)
Any phase -> blocked     (pre-flight issues: auth, provider, or config problems)
Any phase -> stopped     (user action)
```

### 3.9 Resume / Checkpoint Strategy

**Status: Design defined, not yet wired.** `determineResumePoint` exists in `resume.ts` with tests, but `resumeSession` in the controller does not call it -- it resets to `created` and reruns the full pipeline.

**Target behavior (when wired):** Each stage produces durable artifacts. The `task-ledger.json` is the canonical checkpoint. Resume logic:

- If investigation completed: skip to architect with existing `investigation/brief.md`
- If architecture completed: skip to planner
- If plan approved: skip to fan-out
- If some workers completed, some failed: re-launch only failed workers
- If merge completed but review flagged issues: re-enter at appropriate loop-back point
- Resume reads `task-ledger.json` to determine current phase and worker states

### 3.10 Observability

Extend the existing JSONL event system with stage-specific events:

- `swarm.investigate_started`, `swarm.investigate_completed`
- `swarm.architect_started`, `swarm.architect_completed`
- `swarm.plan_started`, `swarm.plan_completed`
- `swarm.consensus_round` (with round number)
- `swarm.worker_launched`, `swarm.worker_completed`, `swarm.worker_failed`
- `swarm.merge_started`, `swarm.merge_completed`, `swarm.merge_conflict`
- `swarm.review_started`, `swarm.review_completed`
- `swarm.review_feedback` (with category: architectural | implementation)
- `swarm.outer_loop` (with iteration number)
- `swarm.delivery_started`, `swarm.delivery_completed`

Per-stage metrics from `ExecutorResult`: cost, tokens, duration, turns.
Aggregate swarm metrics: total cost, total duration, stage breakdown, loop counts.

### 3.11 Repo-level Configuration (`.hydraz/` directory)

Target repos may optionally contain a committed `.hydraz/` directory with repo-specific hydraz configuration. This is *repo-owned configuration* — authored and committed by the repo's owners, analogous to `.devcontainer/`. It is distinct from `~/.hydraz/` (hydraz-generated session data). The principle "no hydraz-generated files are placed in target repos" remains true.

**Directory layout:**
```
.hydraz/
  config.json    # Repo-specific hydraz configuration
  HYDRAZ.md      # Repo-specific prompt content injected into all swarm agent prompts
  .env           # Repo-specific secrets (listed in .worktreeinclude for worktree propagation)
```

All files are optional. If `.hydraz/` does not exist, hydraz operates exactly as before.

**`config.json`** contains repo-specific configuration keys. Currently the only key is `hydrazincludes`:

```json
{
  "hydrazincludes": [
    { "host": "~/.aigl", "container": "~/.aigl" }
  ]
}
```

`hydrazincludes` maps host paths into the container via the existing `tar | ssh` pipe mechanism (same as `scpToContainer`). Each entry specifies a host path and a container path, with tilde expansion on both sides. This fires during container setup after dist copy but before pipeline execution. Missing host paths produce a warning but do not fail the session. Not applicable in local bare-metal mode.

**`HYDRAZ.md`** provides repo-specific prompt content injected into all role prompts. Positioned after core role instructions but before task-specific content. Silent no-op if the file doesn't exist. Content should be concise and universally relevant — for example, directing agents to read existing repo-specific `CLAUDE.md` files.

**`.hydraz/.env`** contains repo-specific secrets. Propagated via the existing `.worktreeinclude` mechanism (repos add `.hydraz/.env` to their `.worktreeinclude` file). No new hydraz code needed.

**Design rationale**: The `.hydraz/` directory gives repos a standardized surface for hydraz-specific configuration without scattering files around the repo root. It is prescriptive about *structure* (one directory, known filenames, known schema) while being flexible about *content* (repos choose what to map, what prompt content to inject, what secrets to provide). This aligns with Hydraz's core philosophy of strong defaults and opinionated conventions.

---

## 4. Artifact Model

### Session directory layout

```
~/.hydraz/repos/<repo>-<hash>/sessions/<session-id>/
  session.json                    # SessionMetadata (extended with swarm phase tracking)
  events.jsonl                    # Event log

  swarm/                          # Swarm control plane
    task-ledger.json              # Master checkpoint: phases, tasks, assignments, status
    ownership.json                # File/directory ownership map per worker

    investigation/
      brief.md                    # Investigator output: repo structure, findings, constraints

    architecture/
      design.md                   # Architect output: design decisions, recommendations
      feedback/
        round-1.md                # Architect feedback on plan (per consensus round)
        round-2.md
        ...

    plan/
      plan.md                     # Planner output: decomposed execution plan
      revisions/
        round-1.md                # Plan revision after architect feedback
        ...

    workers/
      worker-a/
        brief.md                  # Task brief for this worker (written by planner)
        progress.md               # Progress file (written by worker during execution)
      worker-b/
        brief.md
        progress.md
      worker-c/
        brief.md
        progress.md

    merge/
      report.md                   # Merge/conflict report

    reviews/
      carmack.md                  # Review from John Carmack persona
      metz.md                     # Review from Sandi Metz persona
      torvalds.md                 # Review from Linus Torvalds persona
      # Note: review aggregation is done in-memory by the pipeline, not persisted to disk

    delivery/
      # Note: PR draft is currently read from sessions/<id>/artifacts/pr-draft.md (v1 path), not swarm/delivery/
```

### Who writes what

- **Investigator** writes: `swarm/investigation/brief.md`
- **Architect** writes: `swarm/architecture/design.md`, `swarm/architecture/feedback/round-N.md`
- **Planner** writes: `swarm/plan/plan.md`, `swarm/task-ledger.json`, `swarm/ownership.json`, `swarm/workers/*/brief.md`, `swarm/plan/revisions/round-N.md`
- **Workers** write: `swarm/workers/<id>/progress.md` + code commits on their branch
- **Reviewers** write: `swarm/reviews/<persona>.md`
- **Orchestrator (TypeScript)** writes: `session.json`, `events.jsonl`, `swarm/merge/report.md` (review aggregation is in-memory, not persisted; task-ledger updates not yet implemented in production)

### task-ledger.json schema (draft)

```json
{
  "swarmPhase": "syncing",
  "baseCommit": "abc123",
  "outerLoop": 1,
  "consensusRound": 0,
  "tasks": [
    {
      "id": "task-1",
      "title": "Implement auth middleware",
      "description": "...",
      "assignedWorker": "worker-a",
      "ownedPaths": ["src/auth/", "src/middleware/auth.ts"],
      "acceptanceCriteria": ["Auth middleware validates JWT", "Tests pass"],
      "interfaceContracts": ["exports validateAuth(token: string): boolean"],
      "status": "completed"
    }
  ],
  "workers": {
    "worker-a": {
      "branch": "hydraz/fix-auth-worker-a",
      "status": "completed",
      "startedAt": "...",
      "completedAt": "...",
      "cost": 0.42,
      "tokens": { "input": 50000, "output": 12000 }
    }
  },
  "stages": {
    "investigation": { "status": "completed", "cost": 0.12 },
    "architecture": { "status": "completed", "cost": 0.35 },
    "planning": { "status": "completed", "rounds": 2, "cost": 0.58 },
    "workers": { "status": "completed", "cost": 1.26 },
    "merge": { "status": "completed" },
    "review": { "status": "in-progress", "cost": 0.90 }
  }
}
```

---

## 5. Implementation Plan

### Phase 1: Swarm types, artifact model, and state machine

**Goal**: Define all data structures, schemas, and state transitions. No runtime behavior.

**Key changes:**
- New `src/core/swarm/types.ts`: `TaskLedger`, `OwnershipMap`, `WorkerStatus`, `SwarmPhase`, `ReviewFinding`, `SwarmConfig`, `ExecutionContext`
- New `src/core/swarm/artifacts.ts`: Read/write/validate all swarm artifacts (task-ledger, ownership, briefs, progress, reviews)
- New `src/core/swarm/state.ts`: Swarm state machine, phase transitions, worker sub-states, loop counters, bounds checking
- Extend `src/core/sessions/schema.ts`: New session states for the swarm pipeline
- Extend `src/core/events/logger.ts`: New swarm event types

**Why first**: Every subsequent phase depends on these types. TDD starts here.
**Dependencies**: None
**Risks**: Schema design errors force rework. Mitigate by keeping schemas minimal and extending later.

### Phase 2: Investigation stage

**Goal**: Implement the investigator -- a read-only Claude Code invocation that explores the repo and produces `investigation/brief.md`.

**Key changes:**
- New `src/core/swarm/investigator.ts`: Build investigator prompt, launch Claude, validate output
- New `src/core/swarm/prompts/investigator.ts`: Investigator prompt template
- The investigator runs in the session worktree with full repo access but is instructed to make no changes

**Why second**: Simplest stage to implement (one Claude invocation, one output file). Proves the pattern of "launch Claude, read artifact from disk."
**Dependencies**: Phase 1
**Risks**: Low. Read-only pass with a single artifact.

### Phase 3: Architecture stage

**Goal**: Implement the architect -- reads investigation, produces design document.

**Key changes:**
- New `src/core/swarm/architect.ts`: Build architect prompt (includes investigation brief), launch Claude, validate output
- New `src/core/swarm/prompts/architect.ts`: Architect prompt template (initial design only; plan-review is a separate file `prompts/architect-review.ts`, added in Phase 4)

**Why third**: Second-simplest stage. Same pattern as investigator but with a richer input (investigation brief).
**Dependencies**: Phase 2
**Risks**: Low. Single invocation, single artifact.

### Phase 4: Planning stage + architect-planner consensus loop

**Goal**: Implement the planner and the consensus loop between planner and architect.

**Key changes:**
- New `src/core/swarm/planner.ts`: Build planner prompt (includes investigation + architecture), launch Claude, parse structured outputs (`plan.md`, `task-ledger.json`, `ownership.json`, worker briefs)
- New `src/core/swarm/prompts/planner.ts`: Planner prompt template
- New `src/core/swarm/prompts/architect-review.ts`: Architect plan-review prompt template
- New `src/core/swarm/consensus.ts`: Drive the planner <-> architect loop, enforce 10-round cap, handle architect-final-say
- Note: `parser.ts` was not created as a separate file. Schema validation (`validateTaskLedger`, `validateOwnershipMap`) lives in `artifacts.ts`.

**Why fourth**: This is the most complex pre-worker stage. The consensus loop introduces the first loop construct and the first multi-artifact validation.
**Dependencies**: Phase 3
**Risks**: Planner may produce malformed JSON. Mitigate with validation + structured output instructions + retry. The consensus loop needs careful bounds enforcement.

### Phase 5: Worker fan-out with local worktrees

**Goal**: Create N worktrees and launch N worker Claude processes in parallel with strict TDD methodology.

**Key changes:**
- New `src/core/swarm/workers.ts`: Worker lifecycle -- create worktrees from base commit, build worker prompts, launch N Claude processes, track exits
- New `src/core/swarm/prompts/worker.ts`: Worker prompt template (TDD, prove-it, atomic commits, ownership constraints)
- Modify `src/core/providers/worktree.ts` if needed: support pinning base commit for multiple worktrees

**Why fifth**: Core parallelism. All prior stages produce the artifacts workers consume.
**Dependencies**: Phase 4 (plan artifacts)
**Risks**: Multiple concurrent Claude processes; workers writing outside owned paths; API rate limits.

### Phase 6: Fan-in and branch merge

**Goal**: Merge worker branches into the integration branch.

**Key changes:**
- New `src/core/swarm/merge.ts`: Sequential merge of worker branches into integration branch, conflict detection, merge report
- Two outcomes implemented: clean merge, unresolvable conflict (session -> failed). Claude-assisted conflict resolution is not implemented (future work).

**Why sixth**: Must follow worker completion. Ownership map makes conflicts unlikely; merge logic is the safety net.
**Dependencies**: Phase 5
**Risks**: Git merge edge cases. Mitigate with simple sequential strategy and thorough testing.

### Phase 7: Review panel with famous-engineer personas

**Goal**: Launch 3 parallel reviewer Claude processes with distinct famous-engineer personas.

**Key changes:**
- New `src/core/swarm/reviewer.ts`: Build reviewer prompts (persona + integrated code + task + plan), launch 3 in parallel, parse structured reviews
- New `src/core/swarm/prompts/reviewer.ts`: Reviewer prompt templates with persona injection
- New `src/core/swarm/review-aggregate.ts`: Aggregate reviews, categorize findings as architectural vs implementation, determine if approved or changes-requested
- Ship default reviewer personas: Carmack, Metz, Torvalds (as persona definitions, not in `src/core/config/` built-in personas -- separate concept)

**Why seventh**: Review panel operates on the merged result, so it depends on fan-in.
**Dependencies**: Phase 6
**Risks**: Getting reviewers to produce consistently structured, categorized output. Mitigate with clear output format instructions and parsing fallbacks.

### Phase 8: Categorized feedback loops (outer loop)

**Goal**: Route review feedback to the correct loop-back target and re-enter the pipeline.

**Key changes:**
- Outer loop tracking lives in `src/core/swarm/pipeline.ts`; feedback routing via `determineFeedbackRoute` in `src/core/swarm/review-aggregate.ts`
- Both feedback types rewind to planning (consensus) via the outer loop; architectural feedback additionally refreshes the in-memory architecture design from disk
- Enforce 5-outer-loop bound; transition to `failed` if exceeded

**Why eighth**: This wires together all prior stages into a complete loop. It's integration, not new capability.
**Dependencies**: All prior phases
**Risks**: State machine complexity with multiple loop-back targets. Mitigate with clear state tracking in `task-ledger.json`.

### Phase 9: Controller integration, CLI surface, delivery

**Goal**: Wire the full pipeline into the controller and CLI. Replace v1 controller entirely.

**Key changes:**
- Rewrite `src/core/orchestration/controller.ts`: `startSession()` now drives `runSwarmPipeline`
- CLI `run` command: added `--swarm` (no-op), `--workers N`, `--reviewers` flags
- Note: `status`, `review`, `sessions` commands NOT updated for swarm-aware display. Swarm-aware display is future work.
- Note: `interactive.ts` does not pass `swarmOptions`. Future work.
- PR creation from integration branch after review approval (container/cloud mode only)

**Why ninth**: Integration and UX. Wires together all phases.
**Dependencies**: All prior phases
**Risks**: Breaking the existing CLI surface. Mitigate with thorough testing.

### Phase 10: Resume and checkpoint support

**Goal**: Make swarm sessions resumable from any stage.

**Key changes:**
- `src/core/swarm/resume.ts`: `determineResumePoint` reads `task-ledger.json` and artifact state to determine re-entry point (implemented, not wired to controller)
- Handle partial completion at every stage: re-enter pipeline at the right point
- Handle partial worker completion: re-launch only failed/stalled workers

**Why last**: Resume is important but not blocking for initial end-to-end. Ship the happy path first.
**Dependencies**: All prior phases
**Risks**: Resume state reconstruction is complex. Mitigate by making `task-ledger.json` the single source of truth.

---

## 6. First Implementation Slice

**Recommendation: Phase 1 + Phase 2 (types + investigation stage)**

Build the swarm type system, artifact model, and the simplest pipeline stage (investigator). This proves:

- The artifact directory structure works
- The "launch Claude, read artifact from disk" pattern works
- The swarm state machine transitions work
- The event system extensions work

It introduces zero parallelism and zero loop complexity. It's one Claude invocation that reads the repo and writes one file. Everything after builds on this foundation.

---

## 7. Open Questions and Risks

### Design decisions still open

1. **Interface contracts in the plan**: The planner should produce interface contracts (function signatures, API shapes) that workers implement against. How structured should these be? Free-text in the plan, or a separate `contracts.json`? Recommendation: free-text in `plan.md` initially, formalize later if needed.

2. **Shared files (package.json, lock files)**: The ownership model needs a `shared` category for files multiple workers might touch. Recommendation: shared files are listed in `ownership.json` with `exclusive: false`. Workers are instructed to minimize shared-file changes and note them in `progress.md`. Merge phase handles conflicts.

3. **Worker progress monitoring**: Should the orchestrator poll worker progress files while workers run, or just wait for exit? Recommendation: wait for exit initially. Add polling for stall detection later.

4. **Reviewer persona storage**: Where do reviewer persona definitions live? Recommendation: `~/.config/hydraz/reviewers/` alongside the existing persona directory, but conceptually separate. Ship defaults, user can add custom.

### Technical risks

1. **Planning artifact reliability**: The planner must produce valid `task-ledger.json` and `ownership.json`. Claude may produce malformed JSON or miss required fields. Mitigation: validation + retry + clear schema instructions in the prompt.

2. **Cost**: Happy path minimum = 1 (investigate) + 1 (architect) + 1 (plan) + 1 (architect review) + 3 (workers) + 3 (reviewers) = **10 Claude Opus invocations**. With consensus loops and outer retries, could be 20-30+. Per-stage cost tracking is essential.

3. **Worker boundary violations**: Workers may modify files outside their ownership scope. Mitigation: strong prompt instructions + post-execution validation (diff worker branch, flag out-of-scope changes).

4. **Merge conflicts despite ownership**: Even with ownership, workers may make incompatible changes to shared files or interfaces. Mitigation: interface contracts in the plan + merge-phase conflict resolution.

5. **Review panel consistency**: Reviewers may produce inconsistent or unstructured output. Mitigation: structured output format in the prompt + parsing fallbacks.

---

## 8. Default Reviewer Personas

### John Carmack
Focus: correctness, edge cases, error handling, data flow, performance traps, subtle bugs. Known for mathematical rigor, relentless attention to detail, and finding the things that break at 3am.

### Sandi Metz
Focus: code organization, naming, abstraction quality, coupling, changeability, practical design principles. Known for making complex design accessible and pragmatic, and for asking "is this code easy to change?"

### Linus Torvalds
Focus: unnecessary complexity, over-engineering, bloated abstractions, whether the code does what it needs to and nothing more. Known for simplicity, directness, and rejecting anything that doesn't carry its weight.

These three form a triangle: Carmack finds bugs, Metz finds design debt, Torvalds finds bloat. User can substitute any well-known engineer per-session via `--reviewers`.
