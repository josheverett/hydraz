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
- **Swarm mode**: Opt-in via `--swarm` flag initially. Non-swarm mode is removed (v2 is a clean break, no backward compatibility with v1 single-process sessions).
- **Worker count**: User-controlled via `--workers N`, default 3.
- **Backward compatibility**: None. Major version bump, breaking changes expected.
- **Personas**: Applied to the review panel (famous engineers). Workers get identical rigorous-implementer prompts. Pipeline stages (investigator, architect, planner) are structural roles with Hydraz-provided prompts.
- **Verification**: Workers themselves are responsible for TDD, tests, lint, build. No separate verification stage. The review panel focuses on design quality, not "do tests pass."
- **Consensus bounds**: Architect-planner loop max 10 rounds (architect has final say at cap). Outer review loop max 5 iterations.
- **Review feedback routing**: Reviewers categorize findings as architectural (back to architect) vs implementation (back to workers for targeted fixes).

---

## 1. Current State

### What Hydraz v1 does today (source facts from the actual repo)

Hydraz v1 runs **one Claude Code process per session**. The "swarm" is prompt theater:

- The master prompt (`src/core/config/master-prompt.ts`) describes a 3-persona workflow but it all runs in a single Claude process.
- The prompt builder (`src/core/prompts/builder.ts`) stacks master prompt + 3 persona files + task into one `fullText` string passed as a single argument to `claude --print`.
- The controller (`src/core/orchestration/controller.ts`) transitions: `created -> starting -> planning -> (Claude runs) -> completed|failed`. States `implementing` and `verifying` exist in the schema but are never set at runtime.
- `--dangerously-skip-permissions` is hardcoded in the executor.

### Infrastructure that v2 builds on

- **Workspace providers**: `WorkspaceProvider` interface, `LocalProvider` (git worktrees), `LocalContainerProvider` (DevPod). Creating multiple worktrees for parallel workers is mechanically straightforward.
- **Executor**: `launchClaude()` returns `ExecutorHandle` with `waitForExit()`. Multiple handles can run concurrently.
- **Event system**: JSONL event log per session with typed events.
- **Session model**: State machine, metadata persistence, artifact directory.
- **GitHub delivery**: Push verification and PR creation.
- **42 test files, ~460 test cases**.

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
- New `src/core/swarm/types.ts`: `TaskLedger`, `OwnershipMap`, `WorkerState`, `SwarmPhase`, `ReviewFinding`, `SwarmConfig`
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
- New `src/core/swarm/prompts/architect.ts`: Architect prompt template (initial design + plan-review variant)

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
- Handle three outcomes: clean merge, conflict requiring resolution (launch short-lived Claude process), unresolvable conflict (session -> blocked)

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
- Modify `src/core/swarm/state.ts`: Outer loop tracking, feedback routing logic
- Handle architectural feedback: re-enter at architect stage (skip investigation)
- Handle implementation feedback: re-launch only affected workers, re-merge, re-review
- Enforce 5-outer-loop bound; transition to `blocked` if exceeded

**Why eighth**: This wires together all prior stages into a complete loop. It's integration, not new capability.
**Dependencies**: All prior phases
**Risks**: State machine complexity with multiple loop-back targets. Mitigate with clear state tracking in `task-ledger.json`.

### Phase 9: Controller integration, CLI surface, delivery

**Goal**: Wire the full pipeline into the controller and CLI. Replace v1 controller entirely.

**Key changes:**
- Rewrite `src/core/orchestration/controller.ts`: `startSwarmSession()` drives the full pipeline
- Modify CLI commands: `run` (add `--swarm`, `--workers N`, `--reviewers`), `status` (swarm-aware), `review` (show review panel output), `events` (new event types)
- Modify `src/cli/interactive.ts`: Swarm options in new-session flow
- PR creation from integration branch after review approval

**Why ninth**: Integration and UX. Wires together all phases.
**Dependencies**: All prior phases
**Risks**: Breaking the existing CLI surface. Mitigate with thorough testing.

### Phase 10: Resume and checkpoint support

**Goal**: Make swarm sessions resumable from any stage.

**Key changes:**
- Modify `src/core/swarm/state.ts`: Determine resume point from `task-ledger.json`
- Handle partial completion at every stage: re-enter pipeline at the right point
- Handle partial worker completion: re-launch only failed/stalled workers

**Why last**: Resume is important but not blocking for initial end-to-end. Ship the happy path first.
**Dependencies**: All prior phases
**Risks**: Resume state reconstruction is complex. Mitigate by making `task-ledger.json` the single source of truth.

### Post-phase: README overhaul

After all phases are complete, overhaul `README.md` to accurately reflect v2 reality. No v1 references -- clean v2 documentation with sufficient instructions for users to get started without pain. This is not a numbered phase but must be done before release.

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
