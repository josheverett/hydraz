# Hydraz v3 Roadmap

## Near Term

- Make delivery fully asynchronous: have `status` clean up successful remote workspaces when `codex/result.json` reports a delivered run.
- Add richer `logs` rendering that summarizes Codex JSONL events instead of printing raw lines only.
- Add a `diff` command that shells out to the preserved workspace and shows the session branch diff.
- Add a `doctor` command for Codex CLI, DevPod, git remote, and hydrazincludes diagnostics.

## Follow Ups

- Add a saved config migration command if users need old config files rewritten eagerly instead of passively normalized on save.
- Add a first-class local monitor process if automatic cleanup must happen without a later `status` call.
