# Hydraz Roadmap

## Runtime Bounds

### Per-agent turn limits

Pass `--max-turns` to Claude Code invocations, configurable per role. Prevents runaway workers from consuming unbounded tokens. Reasonable defaults: investigator 30, architect 30, planner 30, workers 100, reviewers 50.

### Per-agent orchestrator timeout

Kill a Claude Code process after N minutes at the orchestrator level (SIGTERM, then SIGKILL). Independent of Claude's own internal limits. Protects against hung processes.

### Context window verification

Confirm whether `claude-opus-4-6` via the CLI gives 200k or 1M context window. If 200k, the re-read-every-turn strategy must be tuned for token efficiency.

---

## Feedback Routing Fix

### Architectural feedback routing is currently dead logic

When the review panel categorizes feedback as "architectural," the pipeline refreshes `architectureDesign` from disk — but nothing ever updates `architecture/design.md` after the initial architect stage. Both "architectural" and "implementation" routes effectively do the same thing today. Either re-invoke the architect on architectural feedback, or remove the distinction entirely.

---

## Resume

### Smart resume from checkpoint

`determineResumePoint` exists in `resume.ts` with tests, but `resumeSession` in the controller does not call it — it resets to `created` and reruns the full pipeline. Target: read `task-ledger.json` and re-enter at the appropriate checkpoint.

---

## Verification Phase (v2.2)

A post-review verification phase that runs tests before delivery. Position: after review approval, before delivery. Test criteria sourced from reviewer output. Inner retry loop (verify -> single fix-up worker -> re-verify, max 2-3 attempts). On exhaustion, deliver with warning. Artifacts: `swarm/verification/result.md`, `swarm/verification/criteria.md`.

---

## Reviewer Persona Storage

Store reviewer personas at `~/.config/hydraz/reviewers/` with seeded defaults and custom persona support. Allow users to define and reference named reviewers.

---

## Planner Intelligence

### Worker count awareness

The planner should detect when a task is too small for N workers and produce a plan with fewer workers, rather than awkwardly splitting trivial work.

### Consensus complexity awareness

Fast-path for simple tasks where the architect-planner consensus loop adds latency without value.

---

## CLI Improvements

### Convenience commands

- `hydraz ssh` — SSH into a running container workspace
- `hydraz logs` — Stream or tail session event logs
- `hydraz artifacts` — List/view swarm artifacts for a session
- `hydraz cost` — Show per-stage cost breakdown for a session
- `hydraz diff` — Show git diff of changes made by a session

### Swarm-aware display

`status`, `review`, `sessions`, `events` commands need v2 output showing worker states, loop counts, review panel output, and per-stage metrics.

---

## Infrastructure

### Detach/background for cloud mode

Closing the laptop kills the SSH pipeline. Cloud mode needs server-side orchestration that survives client disconnection.

### Leftover worktree branch cleanup

Branches from completed/failed sessions accumulate. Need a cleanup mechanism (manual command or automatic on session completion).

### Dead code removal

`container-auth-file.ts` is imported by nothing. Remove it.

---

## Configurable Model Selection

`claude-opus-4-6` is currently hardcoded. Add a `--model` flag or config option for model selection.
