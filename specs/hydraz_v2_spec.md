# Hydraz v2 Specification

## 0. Current State (read this first)

**Status:** All 10 implementation phases complete. Post-phase cleanup (README, dead code, 4 rounds of complexity reduction) complete. Local bare-metal mode verified end-to-end. Container/cloud mode blocked by a fundamental architecture issue (see below).

**Critical open item: container-side orchestration.** The swarm pipeline currently runs on the host. For container/cloud mode, the pipeline must run INSIDE the container so Claude invocations and artifact I/O are all container-local. This requires copying Hydraz dist into the container and executing a pipeline runner script via SSH. This is the next implementation task. See plan for details.

**Bugs found and fixed during manual testing:**
- Investigation artifact path mismatch: prompts now include absolute `swarmDir` path so Claude writes artifacts to the session directory, not the worktree
- Review content aggregation: pipeline reads actual review files from disk instead of passing empty strings
- SIGKILL fallback: executor sends SIGKILL after 5s if SIGTERM doesn't terminate the process
- Worker worktree reuse: implementation feedback loops re-use existing worktrees instead of trying to create duplicates
- Missing phase emissions: pipeline now emits all state machine phases (including `architect-reviewing` and `syncing`) to prevent invalid transitions
- Container context plumbing: `containerContext` now threaded through pipeline to all stage executors (but superseded by container-side orchestration approach)

**Post-implementation refactoring completed:**
- `ExecutionContext` extracted to eliminate repetitive plumbing across all stage drivers
- `artifactPath` helper eliminates duplicated ternary path logic in all prompts
- Consensus calls `runPlanner` instead of inlining duplicate planner logic
- Duplicate `APPROVED` parsing consolidated to single `parseReviewVerdict`
- `maxConsensusRounds` threaded from pipeline config to consensus (was ignored before)
- `orchestrator.ts` folded into `review-aggregate.ts` (10-line file eliminated)
- Dead code removed: `architectFinalSay`, `conflict-resolved`, `canContinueConsensus`, `canContinueOuterLoop`, `OUTER_LOOP_MAX_ITERATIONS`, `run-phase.ts`, `conflictFiles`, unused barrel exports
- `postbuild` script added for `chmod +x` on CLI entry point (npm link dev workflow)
- CLI version now reads from `package.json` dynamically instead of hardcoded
- Config `version` field removed (was inert, no migration logic)

**What v2 changes from v1:** v1 ran a single Claude Code process per session and simulated a "swarm" by stacking 3 persona prompts into one context window. v2 replaces this with a real multi-process pipeline: a TypeScript orchestrator drives a sequence of independent Claude Code invocations (investigator, architect, planner, parallel workers, parallel reviewers) with explicit artifact handoffs between each stage.

**Codebase entry points:** `src/cli/index.ts` (CLI entry), `src/core/orchestration/controller.ts` (session lifecycle, calls `runSwarmPipeline`), `src/core/swarm/pipeline.ts` (swarm pipeline driver), `src/core/providers/local-container.ts` (container provider), `src/core/claude/executor.ts` (Claude Code executor).

**v2 document set (all three must be read and understood before implementation):**
- `specs/hydraz_v2_spec.md` (this file) — the authoritative specification defining product behavior and architecture
- `specs/hydraz_v2_plan.md` — the implementation plan defining phased build order, dependencies, and risks
- `specs/hydraz_v2_architecture.md` — the full architecture document with detailed design rationale, v1 codebase audit, design-input document synthesis, artifact schemas, state machine, and risk analysis

The architecture document is the canonical reference for understanding _why_ decisions were made. The spec and plan must remain aligned with its content. Any conflict between documents should be resolved by discussion, not by silently overriding one document with another.

**Agent workflow conventions:**
- Suggest a conventional commit message at the end of every turn where you write code. The human commits manually.
- Put any questions for the human at the very bottom of your message, in bold.
- Never suggest stopping or "picking up in the next session." Keep working until told to stop.
- When you encounter an ambiguity or design decision that needs input, discuss it before proceeding. When agreement is reached, update the spec.
- Always remind the human to rebuild (`npm run build`) before manual testing.
- Stop after each atomic sub-phase so the human can run `npm test` and commit.
- **Spec, plan, architecture doc, and README must stay current with every commit.** Any commit that changes behavior, adds commands, changes test counts, or modifies the public surface must include corresponding updates to all relevant documents. When editing any document, perform multiple self-review passes to ensure all information is internally consistent across all three v2 documents.

---

## 1. Overview

Hydraz is an interactive, repo-root CLI for autonomous, persona-driven coding swarms.

The v1 swarm was a single Claude Code process role-playing multiple personas through prompt composition. v2 replaces this with real parallel execution: multiple independent Claude Code processes, each in an isolated workspace, coordinated by a deterministic TypeScript orchestrator.

The core product vision is unchanged from v1: an engineer stands in a repo, runs `hydraz`, describes a task, and leaves. But v2 delivers on the "swarm" promise with genuine multi-process parallelism rather than single-process persona theater.

### What Hydraz is

- An opinionated developer tool, not a generic agent platform
- A managed operator loop around Claude Code processes
- The session/workspace/orchestration layer; Claude Code does the actual coding
- Distributed as an npm package (`npm install -g hydraz`)

### What Hydraz is not

- A prompt playground
- A manual swarm controller
- A generic N-agent framework
- A replacement for Claude Code itself

### Branding

The name **Hydraz** carries a double meaning:
- Hydra / mythology / many heads / swarm
- Hydrazine / propulsion / volatile energy

v2 makes the "many heads" meaning literal.

---

## 2. Product Goals

### Primary product goal

An engineer can:
1. `cd` into a repo
2. Run `hydraz` (or `hydraz run --swarm "<task>"`)
3. Name the session and branch
4. Choose local or cloud execution
5. Specify worker count and reviewer panel (or accept defaults)
6. Leave the system to work autonomously

Behind the scenes, the swarm investigates the codebase, designs a solution, plans the work, fans out parallel workers, merges results, and runs an independent review panel -- all without human involvement until the PR is ready.

### Secondary product goals

- Real parallel execution with isolated workspaces per worker
- Structured planning pipeline with architect-planner consensus
- Independent code review by a panel of famous-engineer personas
- Categorized feedback loops that route issues to the right stage
- Full observability: per-stage cost, tokens, timing, event log
- Resume from any checkpoint via durable artifacts
- User-controlled worker count and reviewer panel composition

### Non-goals for v2

- Container-per-worker isolation (deferred; local worktrees first)
- Permission scoping per worker role (deferred; `--dangerously-skip-permissions` remains for now)
- Variable reviewer panel size (fixed at 3 for v2)
- Architect council (parallel architects with synthesis; deferred to v2.1 -- single architect with review-panel feedback is sufficient for v2.0; if the single architect proves to be the weak link, a council with famous-engineer personas and a synthesis step is the natural next move)
- Homebrew distribution (deferred from v1)

---

## 3. Core Architecture

### 3.1 Orchestrator model

The orchestrator is **Hydraz TypeScript code** -- a deterministic state machine that drives the swarm pipeline. It is NOT a Claude Code process. It makes no AI decisions.

The orchestrator:
1. Drives the swarm state machine through all pipeline stages
2. Launches Claude Code processes for each stage and waits for exit
3. Reads artifacts from disk after each stage completes
4. Validates artifacts before proceeding to the next stage
5. Creates and destroys worktrees for workers
6. Merges worker branches into the integration branch
7. Routes review feedback to the correct loop-back target
8. Tracks per-stage cost, tokens, and timing
9. Handles failures, stalls, and bounds enforcement

Communication between stages is entirely artifact-mediated. No shared context windows, no conversation history passed between stages. Each Claude Code invocation gets a fresh context with only the artifacts it needs.

### 3.2 Claude Code as stateless worker runtime

Every Claude Code invocation is:
- A fresh `claude --print` process with `--output-format stream-json --verbose`
- Stateless: it receives its full context via the prompt, not via prior conversation
- Short-lived: it runs, produces artifacts, and exits
- Role-specific: its prompt is tailored to one specific pipeline role

This is the fundamental architectural shift from v1. v1 had one long-running Claude process doing everything. v2 has many short-lived processes, each doing one thing well.

### 3.3 The pipeline

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
│   Workers    │  N instances in parallel (default 3)
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
       ├── architectural issues ──► back to Architect (step 2, skip investigation)
       ├── implementation issues ──► back to Workers (targeted fixes)
       │   (max 5 outer loops total, then fail)
       │
       ▼ (approved)
┌─────────────┐
│  Delivery    │  PR creation, cleanup
└─────────────┘
```

---

## 4. Pipeline Stages

### 4.1 Investigation

**Role**: Explore the repository and produce a factual brief about its structure, conventions, and constraints.

**Input**: Task description + full repo access
**Output**: `swarm/investigation/brief.md`
**Process**: 1 Claude instance, read-only. Instructed to make no changes to the repo.

The investigator has no agenda. Its job is pure information gathering: what languages, what frameworks, what test infrastructure, what file organization, what relevant existing code, what constraints. Its output feeds the architect so the architect doesn't have to simultaneously discover and design.

### 4.2 Architecture

**Role**: Read the investigation brief and the task, then produce a design document with recommendations, tradeoffs, and risks.

**Input**: Task + investigation brief
**Output**: `swarm/architecture/design.md`
**Process**: 1 Claude instance.

The architect thinks about _what should be built and why_. It does not decompose the work into tasks -- that's the planner's job. The architect focuses on design decisions, component boundaries, data flow, error handling strategy, and anything that affects the shape of the solution.

The architect also has a second role: reviewing the planner's output (see Section 4.4).

### 4.3 Planning

**Role**: Read the investigation + architecture and produce a detailed execution plan with task decomposition, file ownership, interface contracts, and worker briefs.

**Input**: Task + investigation brief + architecture document
**Output**: `swarm/plan/plan.md`, `swarm/task-ledger.json`, `swarm/ownership.json`, `swarm/workers/*/brief.md`
**Process**: 1 Claude instance.

The planner thinks about _how to decompose the work into executable, parallelizable tasks_. Each task must be:
- Assignable to exactly one worker
- Scoped to a set of owned files/directories
- Independent enough to execute in parallel without coordination
- Defined with acceptance criteria and interface contracts

### 4.4 Architect-planner consensus loop

After the planner produces its output, the architect reviews the plan and provides feedback. If the architect has concerns (design violations, risky decomposition, missing edge cases), the planner revises.

**Bounds**: Max 10 rounds. If the cap is hit, the architect's judgment is final -- the orchestrator takes the architect's last feedback and the planner's last plan and proceeds.

Each round produces durable artifacts:
- `swarm/plan/revisions/round-N.md` (planner revision)
- `swarm/architecture/feedback/round-N.md` (architect feedback)

### 4.5 Worker fan-out

**Role**: Implement the assigned tasks with strict TDD and prove-it methodology.

**Input**: Plan + worker brief + ownership scope + interface contracts
**Output**: Code commits on worker branch + `swarm/workers/<id>/progress.md`
**Process**: N Claude instances in parallel (default 3, user-controlled via `--workers N`)

Each worker:
- Gets its own git worktree, branched from the same base commit
- Receives an identical core prompt emphasizing strict TDD, prove-it methodology, atomic commits
- Is differentiated only by its task brief and file ownership, not by persona
- Must stay within its owned files/paths -- must not modify files outside its ownership scope
- Must run tests/lint/build before declaring completion
- Must write `progress.md` documenting what was done, what was tested, what's uncertain
- Must implement interface contracts from the plan exactly as specified

**Worker branches**: `hydraz/<session>-worker-a`, `hydraz/<session>-worker-b`, etc.
**Integration branch**: `hydraz/<session>` (the session's primary branch)

### 4.6 Merge (fan-in)

The TypeScript orchestrator merges worker branches into the integration branch sequentially (worker-a, then worker-b, then worker-c, etc.).

**Two outcomes (current implementation):**
1. **Clean merge**: continue to review
2. **Conflict, unresolvable**: merge aborts, session transitions to `failed`

Note: Claude-assisted conflict resolution (launching a short-lived Claude process to resolve merge conflicts) is not implemented. Future work.

File ownership makes conflicts unlikely. The merge phase is a safety net, not the normal path.

**Output**: `swarm/merge/report.md`

### 4.7 Review panel

**Role**: Independently review the integrated codebase from distinct engineering perspectives.

**Input**: Integrated code + original task + plan + architecture
**Output**: `swarm/reviews/<persona>.md` per reviewer
**Process**: 3 Claude instances in parallel, each embodying a famous/celebrated software engineer

Each reviewer produces a structured review with:
- Overall assessment: `approve` or `changes-requested`
- Categorized findings:
  - `architectural`: design-level issues requiring re-planning (routes back to architect)
  - `implementation`: code-level issues fixable by workers (routes back to targeted workers)
- Specific file/line references for each finding

The orchestrator aggregates reviews in memory (not persisted to disk). If any reviewer requests changes, the categorized findings determine the loop-back target.

### 4.8 Feedback loop routing

**Architectural feedback** (back to Architect, step 2):
- The architect receives: original task + investigation + previous architecture + reviewer feedback
- Produces revised architecture
- Flows back through planner -> consensus -> workers -> merge -> review
- Investigation is NOT re-run (the repo structure facts from step 1 remain valid)

**Implementation feedback** (back to Workers, targeted fixes):
- Only workers whose owned files are implicated by findings receive the feedback
- Workers get: their original brief + reviewer feedback + "fix these specific issues"
- Other workers are not re-launched
- After fixes: re-merge -> re-review

**Bounds**: Max 5 outer loops total (across both architectural and implementation feedback). If the cap is hit, the session transitions to `failed` (the controller maps all pipeline non-success outcomes to `failed`; `blocked` is reserved for pre-flight issues like auth/provider failures). Note: the pipeline internally returns `phase: 'blocked'` for exhaustion, but the controller overrides this to `failed` for the session state.

### 4.9 Delivery

After the review panel approves:
- PR creation from the integration branch
- Workspace cleanup (worktree removal or DevPod destruction)
- Final event logging and cost summary

---

## 5. Default Reviewer Personas

The review panel ships with three default famous-engineer personas. These are user-configurable via `--reviewers` or global config.

### John Carmack
Focus: correctness, edge cases, error handling, data flow, performance traps, subtle bugs. Known for mathematical rigor, relentless attention to detail, and finding the things that will break at 3am.

### Sandi Metz
Focus: code organization, naming, abstraction quality, coupling, changeability, practical design principles. Known for making complex design accessible and pragmatic, and for asking "is this code easy to change?"

### Linus Torvalds
Focus: unnecessary complexity, over-engineering, bloated abstractions, whether the code does what it needs to and nothing more. Known for simplicity, directness, and rejecting anything that doesn't carry its weight.

These three form a triangle of coverage: Carmack finds bugs, Metz finds design debt, Torvalds finds bloat. Their perspectives are well-documented enough for Claude to reliably embody.

---

## 6. Swarm State Machine

```
created
  -> starting             (auth resolution, provider checks)
  -> investigating         (investigator Claude process)
  -> architecting          (architect Claude process)
  -> planning              (planner Claude process)
  -> architect-reviewing   (architect reviews plan)
     -> planning           (if feedback, loop back; max 10 rounds)
  -> fanning-out           (worker worktrees created, worker processes launched)
  -> syncing               (workers running, orchestrator monitors)
  -> merging               (workers done, branches merged to integration)
  -> reviewing             (review panel runs in parallel)
     -> architecting       (if architectural feedback, loop back)
     -> fanning-out        (if implementation feedback, targeted re-work)
  -> delivering            (PR creation, cleanup)
  -> completed

Any phase -> failed        (unrecoverable error, pipeline failure, or bounds exceeded)
Any phase -> blocked       (pre-flight issues: auth, provider, or config problems)
Any phase -> stopped       (user action)
```

Terminal states: `completed`, `failed`, `blocked`, `stopped`.
Resumable states: `stopped`, `blocked`, `failed` -> `created` (for resume).
`completed` has no outgoing transitions.

---

## 7. Artifact Model

### 7.1 Session directory layout

```
~/.hydraz/repos/<hash>/sessions/<session-id>/
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

### 7.2 Artifact ownership

| Writer | Artifacts |
|--------|-----------|
| Investigator | `swarm/investigation/brief.md` |
| Architect | `swarm/architecture/design.md`, `swarm/architecture/feedback/round-N.md` |
| Planner | `swarm/plan/plan.md`, `swarm/task-ledger.json`, `swarm/ownership.json`, `swarm/workers/*/brief.md`, `swarm/plan/revisions/round-N.md` |
| Workers | `swarm/workers/<id>/progress.md` + code commits on their branch |
| Reviewers | `swarm/reviews/<persona>.md` |
| Orchestrator (TypeScript) | `session.json`, `events.jsonl`, `swarm/merge/report.md` (review aggregation is in-memory, not persisted; task-ledger updates not yet implemented in production) |

### 7.3 task-ledger.json schema

The task ledger is the master checkpoint file. The orchestrator reads it to determine resume points. Claude stages write structured sections of it; the orchestrator updates status fields.

```json
{
  "swarmPhase": "syncing",
  "baseCommit": "abc123def",
  "outerLoop": 1,
  "consensusRound": 0,
  "tasks": [
    {
      "id": "task-1",
      "title": "Implement auth middleware",
      "description": "Create JWT validation middleware for the API routes",
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
      "startedAt": "2026-04-07T10:00:00Z",
      "completedAt": "2026-04-07T10:15:00Z",
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

### 7.4 ownership.json schema

```json
{
  "workers": {
    "worker-a": {
      "paths": ["src/auth/", "src/middleware/auth.ts"],
      "exclusive": true
    },
    "worker-b": {
      "paths": ["src/api/routes/", "tests/api/"],
      "exclusive": true
    },
    "worker-c": {
      "paths": ["src/database/migrations/", "src/models/"],
      "exclusive": true
    }
  },
  "shared": ["package.json", "tsconfig.json"]
}
```

Files in the `shared` list may be modified by any worker. Workers are instructed to minimize shared-file changes. The merge phase handles conflicts on shared files.

---

## 8. Worker Isolation Model

### 8.1 Local mode (v2 starting point)

Each worker gets its own git worktree via the existing `createWorktree()` in `src/core/providers/worktree.ts`, branched from the same base commit pinned at session start.

- Worker branches: `hydraz/<session>-worker-a`, `-worker-b`, etc.
- Integration branch: `hydraz/<session>` (session's primary branch)
- All worktrees share the git object store (cheap on disk)
- Workers run as separate `claude --print` processes in their respective worktree directories

### 8.2 Container mode (future, deferred)

Each worker would get its own DevPod workspace via the existing `LocalContainerProvider`. Same isolation model, different substrate. Deferred until local worktree parallelism is proven and the cost model is understood.

---

## 9. Resume and Checkpoint Strategy

**Status: Design defined, not yet wired.** `determineResumePoint` exists in `resume.ts` with tests, but `resumeSession` in the controller does not call it -- it currently resets to `created` and reruns the full pipeline from scratch. Wiring resume is deferred to v2.1.0.

**Target behavior (when wired):** Each pipeline stage produces durable artifacts. The `task-ledger.json` is the canonical checkpoint. When a session is resumed, the orchestrator reads the ledger and re-enters the pipeline at the appropriate point:

- Investigation completed -> skip to architect
- Architecture completed -> skip to planner
- Plan approved -> skip to fan-out
- Some workers completed, some failed -> re-launch only failed workers
- Merge completed but review flagged issues -> re-enter at appropriate loop-back point

No conversation history or context window state is needed for resume. Everything is on disk.

---

## 10. Observability

### 10.1 Event types

Extend the existing JSONL event system with swarm-specific events:

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

### 10.2 Metrics

Per-stage metrics from `ExecutorResult` (already available from v1 executor):
- Cost (USD)
- Input tokens, output tokens
- Duration (ms)
- Turns

Aggregate swarm metrics:
- Total cost across all stages
- Total duration
- Stage-by-stage breakdown
- Consensus loop rounds used
- Outer loop iterations used
- Worker utilization (time per worker)

---

## 11. CLI Surface Changes

### 11.1 New/updated flags on `run`

```bash
hydraz run "<task>"                      # Launch swarm pipeline (swarm is always active, no separate --swarm needed)
hydraz run --workers 5 "<task>"          # 5 parallel workers
hydraz run --reviewers carmack,metz,torvalds "<task>"  # Custom reviewer panel
hydraz run --local "<task>"              # Run locally (bare metal, default)
hydraz run --container "<task>"          # Run in local Docker container via DevPod
hydraz run --cloud "<task>"              # Run on cloud VM via DevPod
```

- `--swarm`: Declared but currently a no-op (swarm pipeline always runs)
- `--workers N`: Number of parallel workers (default 3)
- `--reviewers <list>`: Comma-separated reviewer persona names (default: carmack, metz, torvalds)
- `--local` / `--container` / `--cloud`: Execution target selection (carried from v1)

### 11.2 Existing commands (swarm awareness NOT yet implemented in display)

Note: The following commands exist but their output has NOT been updated for v2 swarm awareness. They still show v1-level detail (session state, branch, timestamps). Richer swarm display (worker states, loop counts, review panel output) is future work.

- `hydraz status`: Shows session state (uses swarm phases as state values)
- `hydraz review`: Shows session review summary (v1 format, does not show panel reviews)
- `hydraz events`: Shows event log (includes swarm events via JSONL)
- `hydraz sessions`: Lists sessions
- `hydraz stop`: Stops active session
- `hydraz resume`: Resumes session (currently restarts from scratch, smart resume deferred)

### 11.3 Commands unchanged from v1

- `hydraz config`
- `hydraz attach`
- `hydraz personas`
- `hydraz mcp`
- `hydraz clean`

---

## 12. Config Model Changes

### 12.1 Swarm config defaults

**Status: Not yet in `HydrazConfig`.** Swarm defaults are currently hardcoded in `DEFAULT_SWARM_CONFIG` in `src/core/swarm/types.ts` and applied by the controller. They are NOT part of the on-disk config schema and cannot be changed via `hydraz config`. Adding them to `HydrazConfig` is future work.

Current defaults:
- `defaultWorkerCount`: 3
- `defaultReviewers`: `["carmack", "metz", "torvalds"]`
- `consensusMaxRounds`: 10
- `outerLoopMaxIterations`: 5

These can be overridden per-session via CLI flags (`--workers N`, `--reviewers <list>`).

### 12.2 Reviewer persona storage

**Status: Not implemented.** Reviewer persona definitions are currently inline strings in the controller (`"You are ${name}. Review the code with your characteristic engineering perspective."`). A proper persona storage system at `~/.config/hydraz/reviewers/` with seeded defaults and custom persona support is future work.

---

## 13. Claude Code Invocation Details

### 13.1 Common invocation pattern

All Claude Code invocations use:
```
claude --print --model claude-opus-4-6 --output-format stream-json --verbose --dangerously-skip-permissions <prompt>
```

The `--dangerously-skip-permissions` flag is a known debt item. Per-role permission scoping is deferred to a future version.

### 13.2 Role-specific prompts

Each pipeline role has its own prompt template in `src/core/swarm/prompts/`:
- `core-principles.ts`: Shared engineering principle text blocks (prove-it-first, evidence taxonomy, strict TDD) composed into all role prompts
- `paths.ts`: `artifactPath` helper for constructing absolute/relative artifact paths in prompts
- `investigator.ts`: Read-only exploration, produce factual brief
- `architect.ts`: Design reasoning, produce architecture document
- `architect-review.ts`: Architect reviews the planner's execution plan
- `planner.ts`: Task decomposition, produce structured plan artifacts
- `worker.ts`: Strict TDD implementation with ownership constraints, full prove-it methodology
- `reviewer.ts`: Famous-engineer persona review with categorized findings

All prompts embed core engineering principles via `core-principles.ts`. Workers receive the most rigorous version (full TDD + full prove-it-first + evidence taxonomy). Other roles receive evidence discipline appropriate to their function.

All prompts include the model hardcode `claude-opus-4-6`. This is an opinionated product decision carried from v1.

### 13.3 Execution context

- **Local mode**: `spawn('claude', args, { cwd: worktreeDir })` -- same as v1
- **Container mode**: SSH into DevPod workspace and exec Claude -- same as v1
- **Multiple concurrent workers**: Multiple `launchClaude()` calls returning independent `ExecutorHandle` instances. The existing executor already supports this.

---

## 14. v1 Infrastructure Reuse

v2 builds on top of v1 infrastructure rather than replacing it:

| v1 Component | v2 Usage |
|---|---|
| `WorkspaceProvider` interface | Session workspace creation unchanged. Workers create worktrees directly via `createWorktree()` from `worktree.ts`, not through the provider interface. |
| `launchClaude()` / `ExecutorHandle` | Simplified: `prompt` changed from `AssembledPrompt` to `string`. Added SIGKILL fallback after SIGTERM timeout. Called once per pipeline stage, multiple concurrent calls for workers/reviewers. |
| Event system (`appendEvent`, `readEvents`) | Extended with new swarm event types. JSONL format unchanged. |
| Session model (`SessionMetadata`, state machine) | `SessionState` replaced with `SwarmPhase` (type alias). All v1 states replaced with v2 pipeline phases. Session creation/persistence unchanged. |
| GitHub delivery | Reused for PR creation from integration branch (container mode only). |
| Config system | Unchanged on disk. Swarm defaults live in `DEFAULT_SWARM_CONFIG` in code, not in `HydrazConfig`. |
| Auth resolution | Unchanged. Each Claude invocation uses the same auth. |
| DevPod / container providers | Used for session workspace. Container-side orchestration (pipeline runs inside container) is the next implementation task. |
| Stream parser / display | Available but not actively used by v2 pipeline (pipeline stages don't stream to the user). |

---

## 15. Testing Strategy

### 15.1 Test runner

Vitest, carried from v1.

### 15.2 API-design-driven TDD

Carried from v1. The workflow is strict:
1. Define the module's public API (types, function signatures, return types)
2. Write tests against that API surface (tests fail)
3. Implement until the tests pass
4. Refactor with confidence

### 15.3 What to test in v2

**Unit tests (high priority):**
- Task ledger schema validation and state transitions
- Ownership map parsing and validation
- Swarm state machine transitions and bounds checking
- Artifact read/write utilities
- Review aggregation and feedback categorization
- Merge conflict detection logic

**Integration tests:**
- Multi-worker worktree creation and cleanup
- Consensus loop mechanics (mock Claude, verify loop bounds and artifact flow)
- Feedback routing logic (mock reviews, verify correct loop-back target)
- Full pipeline orchestration (mock all Claude calls, verify stage ordering and artifact handoffs)

**What not to test in automated tests:**
- Actual Claude Code execution (mock the executor boundary)
- Prompt quality (that's an evaluation concern, not a unit test concern)

### 15.4 Prove-it-first methodology

Carried from v1. See v1 spec Section 26 for the full evidence taxonomy (`Runtime proof`, `Source fact`, `Hypothesis`, `Unknown`) and language rules. This applies to all v2 development without modification.

---

## 16. Coding Standards

All coding standards from v1 spec Section 26b are carried forward without modification:

- **Single source of truth for types and constants**: every type defined in exactly one place
- **Barrel files for public module APIs**: each `src/core/<module>/` has an `index.ts`
- **Prove-it-first methodology**: never assert something as fact without evidence
- **API-design-driven TDD**: define interfaces -> write tests -> implement
- **Phase completion gate**: a phase is not complete until every deliverable is verified against the actual codebase

---

## 17. Suggested Directory Structure for v2 Code

```
src/core/swarm/
  index.ts                  # Barrel: public API for the swarm module
  types.ts                  # TaskLedger, OwnershipMap, WorkerState, SwarmPhase, ExecutionContext, etc.
  artifacts.ts              # Read/write/validate swarm artifacts (includes schema validation)
  state.ts                  # Swarm state machine, transitions, bounds
  pipeline.ts               # Main swarm pipeline orchestration loop
  investigator.ts           # Investigation stage driver
  architect.ts              # Architecture stage driver
  planner.ts                # Planning stage driver
  consensus.ts              # Architect-planner consensus loop (calls runPlanner)
  workers.ts                # Worker fan-out lifecycle
  merge.ts                  # Fan-in branch merge
  reviewer.ts               # Review panel driver
  review-aggregate.ts       # Aggregate reviews, categorize findings, determineFeedbackRoute
  resume.ts                 # Resume checkpoint determination (not yet wired to controller)
  prompts/
    core-principles.ts      # Shared engineering principle text blocks
    paths.ts                # artifactPath helper for prompt path templating
    investigator.ts         # Investigator prompt template
    architect.ts            # Architect prompt template
    architect-review.ts     # Architect plan-review prompt template
    planner.ts              # Planner prompt template
    worker.ts               # Worker prompt template
    reviewer.ts             # Reviewer prompt template
```

---

## 18. Open Design Questions

### Still open (to be resolved during implementation)

1. **Interface contracts in the plan**: How structured should these be? Free-text in `plan.md` initially; formalize to `contracts.json` later if needed.

2. **Worker progress monitoring**: Wait for exit initially. Add progress-file polling for stall detection in a later phase.

3. **Reviewer persona storage location**: Recommendation: `~/.config/hydraz/reviewers/` alongside the existing persona directory.

### Resolved

1. **Orchestrator model**: TypeScript supervisor, not a Claude process.
2. **Worker count**: User-controlled, default 3.
3. **Backward compatibility**: None. Clean major version break.
4. **Personas**: Applied to reviewers only. Workers get identical prompts.
5. **Verification**: Workers own TDD. No separate verification stage.
6. **Consensus bounds**: 10 rounds, architect final say.
7. **Outer loop bounds**: 5 iterations, then fail.
8. **Feedback routing**: Reviewers categorize as architectural vs implementation.
9. **Default reviewers**: Carmack, Metz, Torvalds.

---

## 19. Cost Model

### 19.1 Happy path (no loops)

| Stage | Invocations |
|-------|-------------|
| Investigation | 1 |
| Architecture | 1 |
| Planning | 1 |
| Architect review | 1 |
| Workers | N (default 3) |
| Reviewers | 3 |
| **Total** | **N + 6** (default 10) |

All at Claude Opus pricing.

### 19.2 With loops

Each consensus round adds 2 invocations (planner + architect review).
Each outer loop adds: 1 architect + 1 planner + up to 10 consensus rounds + N workers + 3 reviewers.

Worst case with all bounds hit: significant. Per-stage cost tracking is essential so users can see where spend goes.

---

## 20. Summary of the Intended Experience

An engineer stands in a repo, runs `hydraz run --swarm "build the user auth system"`, and walks away. Behind the scenes:

1. An investigator reads the codebase and documents what it finds
2. An architect designs the solution based on the investigation
3. A planner decomposes the work into parallel tasks, and the architect reviews the plan until both agree
4. Three workers implement their assigned tasks in parallel, each in an isolated worktree, using strict TDD
5. The orchestrator merges their work into an integration branch
6. John Carmack, Sandi Metz, and Linus Torvalds independently review the result
7. If changes are needed, the right part of the pipeline re-runs automatically
8. When the panel approves, a PR appears

The engineer comes back to a PR with a full audit trail: investigation brief, architecture document, plan, worker progress files, merge report, and three independent code reviews from engineering legends.

That is the product.
