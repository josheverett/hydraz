# Hydraz v3 Roadmap

## Near Term

- Make delivery fully asynchronous: have `status` clean up successful remote workspaces when `codex/result.json` reports a delivered run.
- Add richer `logs` rendering that summarizes Codex JSONL events instead of printing raw lines only.
- Add a `diff` command that shells out to the preserved workspace and shows the session branch diff.
- Add a `doctor` command for Codex CLI, DevPod, git remote, and hydrazincludes diagnostics.

## Follow Ups

- Delete legacy v2 swarm/persona internals once the v3 runner has enough regression coverage.
- Replace vestigial config fields (`defaultPersonas`, `claudeAuth`) with a migration that tolerates old config files but no longer exposes those fields publicly.
- Add a first-class local monitor process if automatic cleanup must happen without a later `status` call.
