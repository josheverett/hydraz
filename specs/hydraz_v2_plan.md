# Hydraz v2 Implementation Plan

> This is the implementation plan for Hydraz v2. It defines the phased build order, dependencies, and risks.
>
> **All three v2 documents must be read and understood before implementation:**
> - `specs/hydraz_v2_spec.md` — the authoritative specification (product behavior and architecture)
> - `specs/hydraz_v2_plan.md` (this file) — the implementation plan (phased build order)
> - `specs/hydraz_v2_architecture.md` — the full architecture document (detailed design rationale, v1 codebase audit, design-input document synthesis, artifact schemas, state machine, risk analysis)
>
> The architecture document is the canonical reference for understanding _why_ decisions were made.
> The spec defines _what and why_ at the product level. This plan defines _how and when_.
> All three must remain aligned.

---

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

- The master prompt (`src/core/config/master-prompt.ts`) describes a 3-persona workflow but it all runs in a single Claude process.
- The v1 prompt builder (`src/core/prompts/builder.ts`) was removed. v2 stages each have their own prompt templates in `src/core/swarm/prompts/`.
- The controller (`src/core/orchestration/controller.ts`) now drives `runSwarmPipeline` which transitions through all `SwarmPhase` states. The v1 states `implementing` and `verifying` no longer exist -- replaced by `SwarmPhase` (investigating, architecting, planning, etc.).
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

## 3. Implementation Phases

### Phase 1: Swarm types, artifact model, and state machine [DONE]

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

### Phase 2: Investigation stage [DONE]

**Goal**: Implement the investigator -- a read-only Claude Code invocation that explores the repo and produces `investigation/brief.md`.

**Key changes:**
- New `src/core/swarm/investigator.ts`: Build investigator prompt, launch Claude, validate output
- New `src/core/swarm/prompts/investigator.ts`: Investigator prompt template
- The investigator runs in the session worktree with full repo access but is instructed to make no changes

**Why second**: Simplest stage to implement (one Claude invocation, one output file). Proves the pattern of "launch Claude, read artifact from disk."
**Dependencies**: Phase 1
**Risks**: Low. Read-only pass with a single artifact.

### Phase 3: Architecture stage [DONE]

**Goal**: Implement the architect -- reads investigation, produces design document.

**Key changes:**
- New `src/core/swarm/architect.ts`: Build architect prompt (includes investigation brief), launch Claude, validate output
- New `src/core/swarm/prompts/architect.ts`: Architect prompt template (initial design only; plan-review is a separate file `prompts/architect-review.ts`, added in Phase 4)

**Why third**: Second-simplest stage. Same pattern as investigator but with a richer input (investigation brief).
**Dependencies**: Phase 2
**Risks**: Low. Single invocation, single artifact.

### Phase 4: Planning stage + architect-planner consensus loop [DONE]

**Goal**: Implement the planner and the consensus loop between planner and architect.

**Key changes:**
- New `src/core/swarm/planner.ts`: Build planner prompt (includes investigation + architecture), launch Claude, parse structured outputs (`plan.md`, `task-ledger.json`, `ownership.json`, worker briefs)
- New `src/core/swarm/prompts/planner.ts`: Planner prompt template
- New `src/core/swarm/prompts/architect-review.ts`: Architect plan-review prompt template
- New `src/core/swarm/consensus.ts`: Drive the planner <-> architect loop, enforce 10-round cap, handle architect-final-say
- Note: `parser.ts` was not created as a separate file. Schema validation (validateTaskLedger, validateOwnershipMap) lives in `artifacts.ts`.

**Why fourth**: This is the most complex pre-worker stage. The consensus loop introduces the first loop construct and the first multi-artifact validation.
**Dependencies**: Phase 3
**Risks**: Planner may produce malformed JSON. Mitigate with validation + structured output instructions + retry. The consensus loop needs careful bounds enforcement.

### Phase 5: Worker fan-out with local worktrees [DONE]

**Goal**: Create N worktrees and launch N worker Claude processes in parallel with strict TDD methodology.

**Key changes:**
- New `src/core/swarm/workers.ts`: Worker lifecycle -- create worktrees from base commit, build worker prompts, launch N Claude processes, track exits
- New `src/core/swarm/prompts/worker.ts`: Worker prompt template (TDD, prove-it, atomic commits, ownership constraints)
- Modify `src/core/providers/worktree.ts` if needed: support pinning base commit for multiple worktrees

**Why fifth**: Core parallelism. All prior stages produce the artifacts workers consume.
**Dependencies**: Phase 4 (plan artifacts)
**Risks**: Multiple concurrent Claude processes; workers writing outside owned paths; API rate limits.

### Phase 6: Fan-in and branch merge [DONE]

**Goal**: Merge worker branches into the integration branch.

**Key changes:**
- New `src/core/swarm/merge.ts`: Sequential merge of worker branches into integration branch, conflict detection, merge report
- Two outcomes implemented: clean merge, unresolvable conflict (session -> failed)
- Note: Claude-assisted conflict resolution (launching a short-lived Claude process to resolve merge conflicts) is NOT implemented. Conflicts abort with an error. This is future work.

**Why sixth**: Must follow worker completion. Ownership map makes conflicts unlikely; merge logic is the safety net.
**Dependencies**: Phase 5
**Risks**: Git merge edge cases. Mitigate with simple sequential strategy and thorough testing.

### Phase 7: Review panel with famous-engineer personas [DONE]

**Goal**: Launch 3 parallel reviewer Claude processes with distinct famous-engineer personas.

**Key changes:**
- New `src/core/swarm/reviewer.ts`: Build reviewer prompts (persona + integrated code + task + plan), launch 3 in parallel, parse structured reviews
- New `src/core/swarm/prompts/reviewer.ts`: Reviewer prompt templates with persona injection
- New `src/core/swarm/review-aggregate.ts`: Aggregate reviews, categorize findings as architectural vs implementation, determine if approved or changes-requested
- Ship default reviewer personas: Carmack, Metz, Torvalds (as persona definitions, not in `src/core/config/` built-in personas -- separate concept)

**Why seventh**: Review panel operates on the merged result, so it depends on fan-in.
**Dependencies**: Phase 6
**Risks**: Getting reviewers to produce consistently structured, categorized output. Mitigate with clear output format instructions and parsing fallbacks.

### Phase 8: Categorized feedback loops (outer loop) [DONE]

**Goal**: Route review feedback to the correct loop-back target and re-enter the pipeline.
**Note**: The `determineFeedbackRoute` function implements the routing logic. The full `runOuterLoop` that wires all stages together is implemented in Phase 9 (controller integration) since it's the main orchestration loop.

**Key changes:**
- Outer loop tracking lives in `src/core/swarm/pipeline.ts`; feedback routing via `determineFeedbackRoute` in `src/core/swarm/review-aggregate.ts`
- Both feedback types rewind to planning (consensus) via the outer loop; architectural feedback additionally refreshes the in-memory architecture design from disk
- Enforce 5-outer-loop bound; transition to `failed` if exceeded

**Why eighth**: This wires together all prior stages into a complete loop. It's integration, not new capability.
**Dependencies**: All prior phases
**Risks**: State machine complexity with multiple loop-back targets. Mitigate with clear state tracking in `task-ledger.json`.

### Phase 9: Controller integration, CLI surface, delivery [DONE]

**Goal**: Wire the full pipeline into the controller and CLI. Replace v1 controller entirely.

**Key changes:**
- Rewrite `src/core/orchestration/controller.ts`: `startSession()` now drives `runSwarmPipeline`
- CLI `run` command: added `--swarm` (no-op), `--workers N`, `--reviewers` flags
- Note: `status`, `review`, `sessions` commands NOT updated for swarm-aware display (still show v1-level detail). Swarm-aware display is future work.
- Note: `interactive.ts` does not pass `swarmOptions` to `startSession` (no interactive worker/reviewer override). Future work.
- PR creation from integration branch after review approval (container/cloud mode only)

**Why ninth**: Integration and UX. Wires together all phases.
**Dependencies**: All prior phases
**Risks**: Breaking the existing CLI surface. Mitigate with thorough testing.

### Phase 10: Resume and checkpoint support [PARTIAL]

**Goal**: Make swarm sessions resumable from any stage.

**Key changes:**
- `src/core/swarm/resume.ts`: `determineResumePoint` reads `task-ledger.json` and artifact state to determine re-entry point (implemented, not wired to controller)
- Handle partial completion at every stage: re-enter pipeline at the right point
- Handle partial worker completion: re-launch only failed/stalled workers

**Why last**: Resume is important but not blocking for initial end-to-end. Ship the happy path first.
**Dependencies**: All prior phases
**Risks**: Resume state reconstruction is complex. Mitigate by making `task-ledger.json` the single source of truth.

### Post-phase: README overhaul [DONE]

### Post-phase: Dead code audit [DONE]

### Post-phase: Manual testing and bug fixes [PARTIAL]

**Local bare metal: PASSED.** Bugs found and fixed during testing:
- Artifact path mismatch: prompts now include absolute `swarmDir` path
- Review content aggregation: pipeline reads actual review files
- SIGKILL fallback: executor escalates to SIGKILL after 5s
- Worker worktree reuse: implementation feedback loops re-use existing worktrees
- Missing phase emissions: pipeline emits all state machine phases
- Container context plumbing (removed -- superseded by container-side orchestration)

**Container/cloud mode: PASSED.** Container-side orchestration verified end-to-end (cloud test 11). Full swarm pipeline ran inside a GCP-backed DevPod container: investigation, architecture, planning, consensus, workers, merge, review -- 3 outer loops to approval. Container hello-world also verified end-to-end (v2.1.0).

### Post-phase: Complexity reduction (4 rounds) [DONE]

- Extracted `ExecutionContext` to replace per-stage options bags
- Created `artifactPath` helper for prompt path templating
- Consensus now calls `runPlanner` instead of inlining
- Consolidated duplicate `APPROVED` parsing into `parseReviewVerdict`
- Threaded `maxConsensusRounds` from pipeline config to consensus
- Folded `orchestrator.ts` into `review-aggregate.ts`
- Removed dead code: `architectFinalSay`, `conflict-resolved`, `canContinueConsensus`, `canContinueOuterLoop`, `OUTER_LOOP_MAX_ITERATIONS`, `run-phase.ts`, `conflictFiles`
- Removed unused barrel exports for `resume.ts`

### Post-phase: Dev workflow fixes [DONE]

- `postbuild` script for `chmod +x` on CLI entry point (npm link compatibility)
- CLI version reads from `package.json` dynamically
- Config `version` field removed (inert, no migration logic)

### Container-side orchestration [DONE]

**Problem (resolved):** The swarm pipeline ran on the host. For container/cloud mode, Claude ran inside the container but the orchestrator read artifacts from the host filesystem -- different filesystems, artifacts invisible across the boundary.

**Solution (implemented):** The entire swarm pipeline runs inside the container. The host:
1. Creates DevPod workspace (existing code)
2. Copies Hydraz `dist/` into the container via `tar | ssh` pipe (`/tmp/hydraz-dist/`)
3. SSHs into the container and runs `node /tmp/hydraz-dist/core/swarm/pipeline-runner.js '<serialized-options>'`
4. Streams structured JSON events from SSH stdout for real-time phase tracking on the host
5. Reads pipeline result from `/tmp/hydraz-pipeline-result.json` via SSH after exit
6. Creates PR, cleans up DevPod workspace (existing code)

**Implementation:**
- `src/core/swarm/pipeline-runner.ts`: `SerializablePipelineOptions` type, `toSerializable()`, `toPipelineOptions()` (adds stdout-printing callbacks), `executePipeline()` (calls `ensureSwarmDirs` + `runSwarmPipeline` + writes result JSON)
- `src/core/claude/ssh.ts`: `buildSshNodeCommand()` -- builds SSH command to run `node <script> <args>` with auth env (same pattern as `buildSshClaudeArgs`)
- `src/core/providers/devpod.ts`: `scpToContainer()` -- copies local directory into container via `tar | ssh` pipe (25x faster than SCP over DevPod tunnels); `getDistRoot()` -- locates `dist/` at runtime via `import.meta.url`
- `src/core/orchestration/controller.ts`: container mode uses `tar | ssh` + SSH pipeline-runner pattern; local mode calls `runSwarmPipeline` directly
- `containerContext` removed from `ExecutionContext`, `PipelineOptions`, and all 6 stage drivers (investigator, architect, planner, consensus, workers, reviewer) -- no longer needed since the pipeline runs container-local

### Hello World mode [DONE]

First-class CLI command (`hydraz hello-world [--local|--container|--cloud]`) for infrastructure sanity checks. Exercises the full infrastructure path (auth, workspace, DevPod/container setup, dist copy) but bypasses the swarm pipeline, running a single Claude instance with a deterministic task.

**Flow:**
1. Resolve auth (same as `startSession`)
2. Validate container auth if container target (same)
3. Create workspace via provider (same)
4. For container targets: copy dist via `tar | ssh` (validates the pipe)
5. Invoke single Claude via `launchClaude` with task: "Create a file called `hello-world-{unixTimestamp}.txt` with the exact contents `hello world`"
6. Verify file exists in workspace (local: filesystem, container: SSH)
7. Report structured pass/fail per step
8. Clean up workspace

**Implementation:**
- `src/cli/commands/hello-world.ts`: CLI command registration
- `src/core/orchestration/hello-world.ts`: orchestration logic
- Reuses `launchClaude` from executor, `scpToContainer`/`scpFilesToContainer`/`sshExec` from devpod, `getProvider` from controller

### Shipped in v2.1.0

- **Verbose/debug mode**: `--verbose` flag with exhaustive debug logging, `--branch` flag for container clone override, container flow fixes (git remote URL cloning, docker provider forcing, `.worktreeinclude` SCP from host to container)

### v2.2.0 Backlog

**P0 — Ship-blocking for non-experimental:**
- ~~**Serial worker execution (default)**: workers execute serially by default, with parallel mode opt-in via `--parallel`.~~ (done in v2.2.0)
- ~~**Prompt calibration for proportionality and approval bias**: proportionality sections added to investigator, architect, and planner. Architect-review default verdict APPROVED. Reviewer prompt reworked with anti-approval-bias language.~~ (done in v2.2.0)
- ~~**Credentials out of `process.argv`**: options JSON moved from CLI argument to `HYDRAZ_PIPELINE_OPTIONS` env var, not visible in `ps aux`.~~ (done in v2.2.0)

**P1 — High impact:**
- **Event streaming during consensus/planning**: the terminal goes silent during the architect-planner consensus loop because phase transitions are consumed without printing. A long gap with zero output is unacceptable. Emit visible events for each consensus round attempt.
- **Heartbeats for long operations**: `devpod up` (90-300s), `scpToContainer`, and the SSH pipeline runner all block with zero user feedback. Switch to `spawn` with stdout streaming and print periodic heartbeats for operations that don't produce their own output.
- **Signal handling and graceful shutdown**: no SIGINT handler. Ctrl+C kills the process without transitioning the session to `stopped` or cleaning up the DevPod workspace. Orphaned cloud VMs burn money silently.
- **Zombie DevPod workspace cleanup on failure**: failed sessions don't reliably clean up DevPod workspaces. `hydraz clean` should auto-detect and force-delete all orphaned workspaces. Consider cleanup-on-start (detect and warn about existing zombies).

**P2 — Quality of life:**
- **Worker count intelligence**: planner should detect when a task is too small for N workers and assign fewer meaningful work streams. Currently a trivial task (e.g., "add one file") gets decomposed into 3 workers where 2 do make-work, which wastes Opus invocations and can cause review panel rejections.
- **Consensus loop complexity awareness**: the architect-planner loop should fast-path for simple tasks instead of deliberating for multiple rounds on a trivial task. Complexity-aware bounds or a lightweight planner bypass for trivial tasks.
- **Verification phase**: post-review test execution with inner retry loop (see spec §18).
- **Leftover worktree branch cleanup**: branches from completed/failed sessions accumulate; needs a cleanup strategy.

**P3 — CLI convenience and developer experience:**
- **`hydraz ssh [session]`**: resolve the DevPod workspace name from session metadata and SSH in. Eliminates the need to type `devpod ssh hydraz-<uuid>` manually.
- **`hydraz logs [session]`**: tail artifacts and events from the container (or local session dir) without manually finding paths.
- **`hydraz artifacts [session]`**: list or display swarm artifacts (investigation brief, architecture, plan, worker briefs, reviews) for a session without navigating `~/.hydraz` paths manually.
- **`hydraz cost [session]`**: per-session cost summary (total tokens, estimated cost, per-stage breakdown). The executor already tracks `inputTokens`, `outputTokens`, `cost`, `durationMs`.
- **`hydraz diff [session]`**: show the aggregate diff of what the swarm produced. For container sessions, SSH in and `git diff main..HEAD`. For local, diff the worktree.
- **Remove dead `container-auth-file.ts`**: fully tested (8 tests), imported by nothing. Orphaned by the container-side orchestration rewrite.

**P4 — Future / architectural:**
- **Resume wiring**: `determineResumePoint` exists and is tested but not connected to `resumeSession` in the controller.
- **Architect council**: parallel architects with synthesis (see spec non-goals).
- **Detach/background for cloud mode**: closing the laptop kills the SSH connection and the entire pipeline. Needs server-side orchestration (run the orchestrator inside the container so it survives client disconnect).

### Known doc discrepancies

**Resolved:**
- ~~Spec §11.1: "no separate --swarm needed" wording contradicts listing --swarm as a declared flag~~ (fixed)
- ~~Architecture §3.3 roles table: artifact filenames abbreviated~~ (fixed)
- ~~Architecture §3.9 resume bullets: abbreviated filenames~~ (fixed)
- ~~CLI help text for `--swarm` in `run.ts` says "Enable swarm pipeline (default)" vs README saying "No-op"~~ (fixed)

- ~~Pipeline swarm events not written to `events.jsonl`~~ (fixed: pipeline now emits all declared event types; controller persists them via `appendEvent` for both local and container modes)
- ~~README re-audited against final architecture~~ (done)

**Open:**

(none)

**Previously open, now resolved:**
- ~~**Container git-push regression**: believed to be a code bug but was actually a GitHub token permissions issue — the push logic works correctly when the token has write access~~

---

## 4. First Implementation Slice

**Recommendation: Phase 1 + Phase 2 (types + investigation stage)**

Build the swarm type system, artifact model, and the simplest pipeline stage (investigator). This proves:

- The artifact directory structure works
- The "launch Claude, read artifact from disk" pattern works
- The swarm state machine transitions work
- The event system extensions work

It introduces zero parallelism and zero loop complexity. It's one Claude invocation that reads the repo and writes one file. Everything after builds on this foundation.

---

## 5. Open Questions and Risks

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

## 6. Manual E2E Verification

After all v2.2.0 code changes are complete, run a full manual end-to-end test before tagging the release. At minimum:

- [ ] Local bare-metal: `hydraz run "<task>"` — full pipeline to completion
- [ ] Local bare-metal with `--parallel`: verify parallel worker execution still works
- [ ] Container/cloud mode (if changes touched container paths): `hydraz run --container "<task>"` or `--cloud`
- [ ] `hydraz hello-world --local` sanity check
- [ ] Verify serial worker chaining: confirm later workers build on earlier workers' commits (inspect git log on integration branch)
