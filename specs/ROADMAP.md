# Hydraz v3 Roadmap

## Near Term

- Render delivery details in `status`, including PR URL, delivery error, and final Codex message when available.
- Preserve or copy Codex logs locally before cleaning up delivered remote workspaces so `logs` still works after `status` destroys the DevPod workspace.
- Add richer `logs` rendering that summarizes Codex JSONL events instead of printing raw lines only.
- Add a `diff` command that shells out to the preserved workspace and shows the session branch diff.
- Add a `doctor` command for Codex CLI capabilities, DevPod, git remote, and hydrazincludes diagnostics.

## Follow Ups

- Add a saved config migration command if users need old config files rewritten eagerly instead of passively normalized on save.
- Add a first-class local monitor process if automatic cleanup must happen without a later `status` call.
