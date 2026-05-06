# Hydraz Architecture

## 1. Overview

Hydraz is an opinionated CLI for autonomous, multi-process coding swarms. An engineer stands in a repo, describes a task, and walks away. A real multi-process swarm -- powered by Claude Code CLI (Opus 4.6) -- investigates, designs, plans, implements in parallel, merges, and runs an independent review panel. The engineer gets back a branch with committed work (and a PR in container/cloud mode).

The name **Hydraz** carries a double meaning: Hydra (mythology, many heads, swarm) and Hydrazine (propulsion, volatile energy).

### What Hydraz is

- An opinionated developer tool, not a generic agent platform
- A deterministic TypeScript orchestrator that drives independent Claude Code processes
- The session/workspace/orchestration layer; Claude Code does the actual coding
- Distributed as an npm package (`npm install -g hydraz`)

### What Hydraz is not

- A prompt playground or manual swarm controller
- A generic N-agent framework
- A replacement for Claude Code itself

---

## 2. Product Goals

### Primary goal

An engineer can: `cd` into a repo, run `hydraz run "<task>"`, name the session and branch, choose local or cloud execution, specify worker count and reviewer panel (or accept defaults), and leave the system to work autonomously.

### Secondary goals

- Real parallel execution with isolated workspaces per worker
- Structured planning pipeline with architect-planner consensus
- Independent code review by a configurable review panel
- Categorized feedback loops that route issues to the right stage
- Full observability: per-stage cost, tokens, timing, event log
- Resume from any checkpoint via durable artifacts
- User-controlled worker count and reviewer panel composition

### Non-goals

- Container-per-worker isolation (deferred; local worktrees first)
- Permission scoping per worker role (`--dangerously-skip-permissions` remains)
- Architect council (parallel architects with synthesis; deferred)
- Homebrew distribution (deferred)

---

## 3. Pipeline Architecture

### 3.1 The pipeline

```
Investigate -> Architect -> Plan (with consensus loop) -> Workers -> Merge -> Review Panel -> Deliver
```

```
+--------------+
| Investigate  |  1 Claude instance, read-only repo exploration
+------+-------+
       | investigation brief
       v
+--------------+
|  Architect   |  1 instance, reads investigation, produces design
+------+-------+
       | architecture doc + recommendations
       v
+--------------+
|   Planner    |  1 instance, reads investigation + architecture
+------+-------+
       | execution plan + task ledger + ownership map + worker briefs
       v
+--------------+
|  Architect   |  1 instance, reviews plan, provides feedback
|   Review     |
+------+-------+
       | approved or feedback
       |
       +-- if feedback --> back to Planner (max 10 rounds, architect final say)
       |
       v (plan approved)
+------+-------+
|   Workers    |  N instances, serial by default (default 3, --parallel for concurrent)
|  (fan-out)   |  each in own worktree, strict TDD, prove-it methodology
+------+-------+
       | code on worker branches
       v
+--------------+
|    Merge     |  TypeScript orchestrator, sequential branch merge
|   (fan-in)   |
+------+-------+
       | integrated branch
       v
+--------------+
|   Review     |  1 instance by default (configurable via --reviewers)
|    Panel     |  independent review of integrated result
+------+-------+
       | approved, or categorized feedback
       |
       +-- architectural issues --> back to Planner (re-plan with refreshed architecture)
       +-- implementation issues --> back to Planner (re-plan with feedback)
       |   (max 5 outer loops total, then fail)
       |
       v (approved)
+--------------+
|  Delivery    |  PR creation, cleanup
+--------------+
```

### 3.2 Orchestrator model

The orchestrator is deterministic Hydraz TypeScript code. It is NOT a Claude Code process. It makes no AI decisions. It:

1. Drives the swarm state machine through all pipeline stages
2. Launches Claude Code processes for each stage and waits for exit
3. Reads artifacts from disk after each stage completes
4. Validates artifacts before proceeding to the next stage
5. Creates and destroys worktrees for workers
6. Merges worker branches into the integration branch
7. Routes review feedback to the correct loop-back target
8. Tracks per-stage cost, tokens, and timing
9. Handles failures, stalls, and bounds enforcement

Communication between stages is entirely artifact-mediated. No shared context windows, no conversation history passed between stages.

### 3.3 Claude Code as stateless worker runtime

Every Claude Code invocation is:
- A fresh `claude --print` process with `--output-format stream-json --verbose`
- Stateless: receives full context via the prompt, not via prior conversation
- Short-lived: runs, produces artifacts, and exits
- Role-specific: prompt is tailored to one specific pipeline role

### 3.4 Claude Code roles

| Role | Instances | Input | Output |
|------|-----------|-------|--------|
| Investigator | 1 | Task + repo access | `investigation/brief.md` |
| Architect | 1 | Task + investigation | `architecture/design.md` |
| Planner | 1 | Task + investigation + architecture | `plan/plan.md`, `task-ledger.json`, `ownership.json`, worker briefs |
| Architect (review) | 1 | Plan + architecture | Approval or feedback |
| Worker | N (default 3) | Plan + brief + ownership scope | Code commits + `progress.md` |
| Reviewer | 1 (default) | Integrated code + task + plan | Review with categorized findings |

---

## 4. Pipeline Stages

### 4.1 Investigation

1 Claude instance, read-only. Explores the repo and produces `swarm/investigation/brief.md`. No changes to the repo.

### 4.2 Architecture

1 Claude instance. Reads the investigation brief and task, produces `swarm/architecture/design.md` with recommendations, tradeoffs, and risks. Focuses on design decisions, not task decomposition.

### 4.3 Planning

1 Claude instance. Reads investigation + architecture, produces a detailed execution plan with task decomposition, file ownership, interface contracts, and worker briefs. Outputs: `swarm/plan/plan.md`, `swarm/task-ledger.json`, `swarm/ownership.json`, `swarm/workers/*/brief.md`.

### 4.4 Architect-planner consensus loop

After the planner produces output, the architect reviews the plan and provides feedback. Max 10 rounds. If the cap is hit, the architect's judgment is final. Each round produces durable artifacts: `swarm/plan/revisions/round-N.md` and `swarm/architecture/feedback/round-N.md`.

### 4.5 Worker fan-out

N Claude instances (default 3), serial by default (`--parallel` for concurrent). Each worker gets its own git worktree. In serial mode, each worker branches from the previous worker's branch. In parallel mode, all workers branch from the same base commit. Workers must stay within their owned files/paths, use strict TDD, and write `swarm/workers/<id>/progress.md`.

Worker branches: `hydraz/<session>-worker-a`, `-worker-b`, etc.
Integration branch: `hydraz/<session>` (session's primary branch)

### 4.6 Merge (fan-in)

The TypeScript orchestrator merges worker branches into the integration branch sequentially. Two outcomes: clean merge (continue to review) or unresolvable conflict (session fails). Claude-assisted conflict resolution is not implemented. Output: `swarm/merge/report.md`.

### 4.7 Review panel

1 Claude instance by default (configurable via `--reviewers` for multiple reviewers). The reviewer is strongly biased toward approval -- it will only reject if it finds a ship-blocking defect. Each reviewer produces a structured review with categorized findings (`architectural` or `implementation`) and specific file/line references.

Verdict parsing defaults to `approve`. The parser scans the first 5 non-empty lines for `CHANGES REQUESTED` (case-insensitive, stripping markdown formatting), guarding against negation prefixes. If no explicit rejection is found, the verdict is `approve`.

### 4.8 Feedback loop routing

Both feedback types rewind through re-planning via the outer loop:

- **Architectural feedback**: refreshes the architecture design from disk before re-planning. The architect is NOT re-invoked; the refresh is a disk re-read.
- **Implementation feedback**: rewinds to planning with the review feedback passed to the planner.

Investigation is never re-run (repo structure facts remain valid).

Max 5 outer loops total. If the cap is hit, the session transitions to `failed` (the controller maps all pipeline non-success outcomes to `failed`; `blocked` is reserved for pre-flight issues like auth/provider failures).

### 4.9 Delivery

After the review panel approves: PR creation from the integration branch, workspace cleanup, final event logging and cost summary.

---

## 5. Worker Isolation

### Local mode

Each worker gets its own git worktree via `createWorktree()` in `src/core/providers/worktree.ts`. All worktrees share the git object store. Workers run as separate `claude --print` processes in their respective worktree directories.

### Container/cloud mode

The entire swarm pipeline runs inside a single DevPod container. The host:

1. Creates the DevPod workspace and worktree (existing provider code)
2. Copies Hydraz `dist/` into the container via `tar | ssh` pipe (`/tmp/hydraz-dist/`)
3. Copies `hydrazincludes` paths from host into container (if `.hydraz/config.json` exists)
4. SSHs in and runs `node /tmp/hydraz-dist/core/swarm/pipeline-runner.js` with auth env vars
5. Streams structured JSON events from SSH stdout for real-time phase tracking
6. Reads the pipeline result from `/tmp/hydraz-pipeline-result.json` via SSH after exit
7. Handles delivery (PR creation) and cleanup on the host side

Inside the container, the pipeline runs identically to local bare-metal mode. Workers use local worktrees inside the container. Per-worker DevPod workspaces are not used; one container hosts all workers.

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
  -> reviewing             (review panel runs)
     -> planning           (both feedback types rewind to planning via outer loop)
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
~/.hydraz/repos/<repo>-<hash>/sessions/<session-id>/
  session.json                    # SessionMetadata
  events.jsonl                    # Event log

  swarm/                          # Swarm control plane
    task-ledger.json              # Master checkpoint: phases, tasks, assignments, status
    ownership.json                # File/directory ownership map per worker

    investigation/
      brief.md                    # Investigator output

    architecture/
      design.md                   # Architect output
      feedback/
        round-1.md                # Architect feedback on plan (per consensus round)

    plan/
      plan.md                     # Planner output
      revisions/
        round-1.md                # Plan revision after architect feedback

    workers/
      worker-a/
        brief.md                  # Task brief (written by planner)
        progress.md               # Progress file (written by worker)
      worker-b/
        ...

    merge/
      report.md                   # Merge/conflict report

    reviews/
      reviewer.md                 # Review output (one file per reviewer)
```

### 7.2 Artifact ownership

| Writer | Artifacts |
|--------|-----------|
| Investigator | `swarm/investigation/brief.md` |
| Architect | `swarm/architecture/design.md`, `swarm/architecture/feedback/round-N.md` |
| Planner | `swarm/plan/plan.md`, `swarm/task-ledger.json`, `swarm/ownership.json`, `swarm/workers/*/brief.md`, `swarm/plan/revisions/round-N.md` |
| Workers | `swarm/workers/<id>/progress.md` + code commits on their branch |
| Reviewers | `swarm/reviews/<reviewer>.md` |
| Orchestrator (TS) | `session.json`, `events.jsonl`, `swarm/merge/report.md` |

### 7.3 Known tech debt

`ARTIFACT_FILES` in `src/core/sessions/schema.ts` still references v1 artifact names (`intake.md`, `plan.md`, `implementation-summary.md`, `verification-report.md`, `pr-draft.md`). These are vestigial and do not reflect the v2 swarm artifact model above.

---

## 8. Observability

### Event types

Extend the existing JSONL event system with swarm-specific events:

- `swarm.investigate_started`, `swarm.investigate_completed`
- `swarm.architect_started`, `swarm.architect_completed`
- `swarm.plan_started`, `swarm.plan_completed`
- `swarm.consensus_round`, `swarm.consensus_round_started`, `swarm.consensus_planner_completed`, `swarm.consensus_planner_failed`
- `swarm.consensus_review_started`, `swarm.consensus_review_completed` (with verdict)
- `swarm.worker_launched`, `swarm.worker_completed`, `swarm.worker_failed`
- `swarm.merge_started`, `swarm.merge_completed`, `swarm.merge_conflict`
- `swarm.review_started`, `swarm.review_completed`
- `swarm.review_feedback` (with category: architectural | implementation)
- `swarm.outer_loop` (with iteration number)
- `swarm.delivery_started`, `swarm.delivery_completed`
- `workspace.heartbeat`, `swarm.heartbeat` (periodic heartbeats during long-running operations)

### Per-stage metrics

From `ExecutorResult`: cost (USD), input/output tokens, duration (ms), turns.
Aggregated: total cost, total duration, stage breakdown, consensus rounds used, outer loop iterations, worker utilization.

---

## 9. CLI Surface

### Flags on `run`

```bash
hydraz run "<task>"                      # Launch swarm pipeline
hydraz run --workers 5 "<task>"          # 5 workers (serial by default)
hydraz run --parallel "<task>"           # Run workers in parallel
hydraz run --reviewers a,b "<task>"      # Custom reviewer panel
hydraz run --local "<task>"              # Run locally (bare metal, default)
hydraz run --container "<task>"          # Run in local Docker container via DevPod
hydraz run --cloud "<task>"              # Run on cloud VM via DevPod
hydraz run --verbose "<task>"            # Enable diagnostic output
hydraz run --no-clone "<task>"           # Use local repo path instead of cloning from remote
```

| Flag | Description | Default |
|------|-------------|---------|
| `--session <name>` | Session name | Auto-generated from task |
| `--branch <name>` | Branch name | Auto-generated from session |
| `--swarm` | No-op (swarm pipeline always runs) | Always on |
| `--workers <N>` | Number of workers | 3 |
| `--parallel` | Run workers concurrently instead of serially | Off (serial) |
| `--reviewers <names>` | Comma-separated reviewer names | reviewer |
| `--local` | Run locally (bare metal) | Default |
| `--container` | Run locally in a Docker container | |
| `--cloud` | Run on a cloud VM via DevPod | |
| `--verbose` | Enable diagnostic output | Off |
| `--no-clone` | Use local repo path instead of cloning | Off |

### Other commands

- `hydraz hello-world` -- infrastructure sanity check (supports `--local`, `--container`, `--cloud`, `--verbose`, `--branch`, `--no-clone`)
- `hydraz sandbox` -- set up a container workspace and drop into an interactive shell (supports `--container`, `--cloud`, `--verbose`, `--no-cleanup`, `--no-clone`, `--branch`)

### Commands not yet swarm-aware in display

`status`, `review`, `sessions`, `events` exist but still show v1-level detail (session state, branch, timestamps). Richer swarm display (worker states, loop counts, review panel output) is future work.

### Commands unchanged from v1

`config`, `attach`, `personas`, `mcp`, `clean`, `stop`, `resume` (currently restarts from scratch; smart resume deferred).

---

## 10. Config Model

### Swarm config defaults

Swarm defaults are hardcoded in `DEFAULT_SWARM_CONFIG` in `src/core/swarm/types.ts`, NOT in the on-disk `HydrazConfig` schema. They cannot be changed via `hydraz config`. Adding them to `HydrazConfig` is future work.

| Setting | Default |
|---------|---------|
| `defaultWorkerCount` | 3 |
| `defaultReviewers` | `["reviewer"]` |
| `consensusMaxRounds` | 10 |
| `outerLoopMaxIterations` | 5 |

Overridable per-session via CLI flags (`--workers N`, `--reviewers <list>`).

### Repo-level configuration (`.hydraz/` directory)

Target repos may optionally contain a committed `.hydraz/` directory with repo-specific configuration. This is repo-owned configuration -- authored and committed by the repo's owners, analogous to `.devcontainer/`. Distinct from `~/.hydraz/` which stores hydraz-generated session data. No hydraz-generated files are placed in target repos.

```
.hydraz/
  config.json    # Repo-specific hydraz configuration
  HYDRAZ.md      # Repo-specific prompt content injected into all swarm agent prompts
  .env           # Repo-specific secrets (listed in .worktreeinclude for worktree propagation)
```

All files are optional. If `.hydraz/` does not exist, hydraz operates exactly as before.

**`config.json`**: Currently supports `hydrazincludes` -- an array of host-to-container file mappings. Each entry specifies a host path and a container path. During container setup, hydraz copies each host path into the container via `tar | ssh`. Tilde expansion on both sides. Missing host paths warn but do not fail. No effect in local bare-metal mode.

**`HYDRAZ.md`**: Repo-specific prompt content injected into all role prompts (investigator, architect, planner, workers, reviewers). Positioned after core role instructions but before task-specific content. Silent no-op if absent.

**`.hydraz/.env`**: Propagated via the existing `.worktreeinclude` mechanism. No new hydraz code needed.

The `.hydraz/` directory gives repos a standardized surface for hydraz-specific configuration without scattering files around the repo root. It is prescriptive about structure (one directory, known filenames, known schema) while being flexible about content.

---

## 11. Claude Code Invocation

### Common invocation pattern

All Claude Code invocations use:
```
claude --print --model claude-opus-4-6 --output-format stream-json --verbose --dangerously-skip-permissions <prompt>
```

The `--dangerously-skip-permissions` flag is known debt. Per-role permission scoping is deferred.

### Prompt modules

Each pipeline role has its own prompt template in `src/core/swarm/prompts/`:

- `core-principles.ts` -- shared engineering principles (prove-it-first, evidence taxonomy, strict TDD) composed into all role prompts
- `paths.ts` -- `artifactPath` helper for constructing absolute/relative artifact paths
- `investigator.ts`, `architect.ts`, `architect-review.ts`, `planner.ts`, `worker.ts`, `reviewer.ts`

If the target repo contains `.hydraz/HYDRAZ.md`, its contents are injected into all role prompts.

### Execution context

- **Local mode**: `spawn('claude', args, { cwd: worktreeDir })`
- **Container mode**: the entire pipeline runs inside the container via `pipeline-runner.ts`. All Claude invocations are local `spawn` calls inside the container. The host only SSHs once to run the pipeline runner.

---

## 12. v1 Infrastructure Reuse

| v1 Component | v2 Usage |
|---|---|
| `WorkspaceProvider` interface | Session workspace creation unchanged. Workers create worktrees directly via `createWorktree()`, not through the provider. |
| `launchClaude()` / `ExecutorHandle` | Simplified: `prompt` changed from `AssembledPrompt` to `string`. Added SIGKILL fallback. Called once per stage, multiple concurrent calls for workers/reviewers. |
| Event system | Extended with swarm event types. JSONL format unchanged. |
| Session model | `SessionState` is now a type alias for `SwarmPhase`. Creation/persistence unchanged. |
| GitHub delivery | Reused for PR creation from integration branch (container/cloud mode only). |
| Config system | Unchanged on disk. Swarm defaults live in `DEFAULT_SWARM_CONFIG` in code. |
| Auth resolution | Unchanged. Each Claude invocation uses the same auth. |
| DevPod / container providers | Used for session workspace. Container-side orchestration: host copies `dist/` into container, runs `pipeline-runner.ts` via SSH, reads result after exit. |

---

## 13. Cost Model

### Happy path (no loops)

| Stage | Invocations |
|-------|-------------|
| Investigation | 1 |
| Architecture | 1 |
| Planning | 1 |
| Architect review | 1 |
| Workers | N (default 3) |
| Reviewers | R (default 1) |
| **Total** | **N + R + 4** (default 8) |

All at Claude Opus pricing.

### With loops

Each consensus round adds 2 invocations (planner + architect review). Each outer loop adds: up to 20 consensus invocations + N workers + R reviewers. Worst case with all bounds hit is significant. Per-stage cost tracking is essential.

---

## 14. Coding Standards and Testing

### Test runner

Vitest. 62 test files across the codebase.

### API-design-driven TDD

The workflow is strict: define interfaces/types -> write tests (tests fail) -> implement until tests pass -> refactor. Tests should test behavior, not implementation details.

### Prove-it-first methodology

No assumption may be acted on until verified with evidence. Evidence taxonomy:

- **Runtime proof** -- established by a passing test or manual run with observed results
- **Source fact** -- established by directly inspecting checked-in source code
- **Hypothesis** -- inference from source facts, docs, or memory; not proof
- **Unknown** -- runtime proof required but not yet obtained

The words "prove," "proven," and "proof" are reserved for Runtime proof only.

### What to test

- Unit: artifact validation, state machine transitions, ownership parsing, review aggregation, feedback routing
- Integration: multi-worker worktree lifecycle, consensus loop mechanics (mock Claude), full pipeline orchestration (mock all Claude calls)
- Do NOT test: actual Claude execution (mock the executor), prompt quality, interactive CLI prompts

---

## 15. Codebase Map

### Entry points

- `src/cli/index.ts` -- CLI entry
- `src/core/orchestration/controller.ts` -- session lifecycle, calls `runSwarmPipeline`
- `src/core/swarm/pipeline.ts` -- swarm pipeline driver
- `src/core/swarm/pipeline-runner.ts` -- container-side entry point
- `src/core/providers/local-container.ts` -- container provider
- `src/core/claude/executor.ts` -- Claude Code executor

### Swarm module (`src/core/swarm/`)

```
index.ts                  # Barrel: public API
types.ts                  # TaskLedger, OwnershipMap, SwarmPhase, ExecutionContext, etc.
artifacts.ts              # Read/write/validate swarm artifacts (includes schema validation)
state.ts                  # Swarm state machine, transitions, bounds
pipeline.ts               # Main pipeline orchestration loop
pipeline-runner.ts        # Container-side entry point
investigator.ts           # Investigation stage driver
architect.ts              # Architecture stage driver
planner.ts                # Planning stage driver
consensus.ts              # Architect-planner consensus loop
workers.ts                # Worker fan-out lifecycle
merge.ts                  # Fan-in branch merge
reviewer.ts               # Review panel driver
review-aggregate.ts       # Aggregate reviews, categorize findings, determineFeedbackRoute
resume.ts                 # Resume checkpoint determination (not yet wired to controller)
repo-config.ts            # .hydraz/ directory parsing (config.json, HYDRAZ.md, hydrazincludes)
prompts/
  core-principles.ts      # Shared engineering principle text blocks
  paths.ts                # artifactPath helper
  investigator.ts         # Investigator prompt template
  architect.ts            # Architect prompt template
  architect-review.ts     # Architect plan-review prompt template
  planner.ts              # Planner prompt template
  worker.ts               # Worker prompt template
  reviewer.ts             # Reviewer prompt template
```

---

## 16. Deferred and Future Work

### Resume wiring

`determineResumePoint` exists in `resume.ts` with tests, but `resumeSession` in the controller does not call it -- it resets to `created` and reruns the full pipeline. Target behavior: read `task-ledger.json` and re-enter at the appropriate checkpoint.

### Verification phase (v2.2 design)

A post-review verification phase that runs tests before delivery. Position: after review approval, before delivery. Test criteria sourced from reviewer output. Inner retry loop (verify -> single fix-up worker -> re-verify, max 2-3 attempts). On exhaustion, deliver with warning. Artifacts: `swarm/verification/result.md`, `swarm/verification/criteria.md`.

### Other deferred items

- **Reviewer persona storage**: `~/.config/hydraz/reviewers/` with seeded defaults and custom persona support
- **Worker count intelligence**: planner should detect when a task is too small for N workers
- **Consensus complexity awareness**: fast-path for simple tasks
- **Dead code**: `container-auth-file.ts` (imported by nothing, still in tree)
- **CLI convenience**: `hydraz ssh`, `hydraz logs`, `hydraz artifacts`, `hydraz cost`, `hydraz diff`
- **Detach/background for cloud mode**: closing the laptop kills the SSH pipeline; needs server-side orchestration
- **Leftover worktree branch cleanup**: branches from completed/failed sessions accumulate
- **Swarm-aware display**: `status`, `review`, `sessions`, `events` commands need v2 output

---

## 17. Resolved Design Decisions

- **Orchestrator model**: Hydraz TypeScript code is the deterministic supervisor. Claude Code is used only as stateless workers.
- **Swarm mode**: Always active. `--swarm` flag is a no-op. No backward compatibility with v1.
- **Worker count**: User-controlled via `--workers N`, default 3.
- **Worker execution**: Serial by default. `--parallel` for concurrent.
- **Personas**: Workers get identical rigorous-implementer prompts. Review panel uses a single generic reviewer by default (no persona embodiment). Pipeline stages are structural roles with Hydraz-provided prompts.
- **Consensus bounds**: 10 rounds, architect final say at cap.
- **Outer loop bounds**: 5 iterations, then fail.
- **Feedback routing**: Reviewers categorize as architectural vs implementation. Both rewind to planning; architectural additionally refreshes architecture from disk.
- **Model**: `claude-opus-4-6` hardcoded. Configurable model selection deferred.
