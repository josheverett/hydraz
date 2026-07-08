# Hydraz v3 Architecture

Hydraz v3 is a Codex CLI harness. It no longer implements a custom multi-agent pipeline, review panel, or role-based orchestration layer.

## Pipeline

```
CLI -> Session metadata -> Workspace provider -> Detached Codex runner -> Delivery
```

1. The CLI creates a Hydraz session and chooses an execution target. Cloud is the default.
2. The provider creates a local worktree, local DevPod container, or cloud DevPod workspace.
3. For container/cloud runs, Hydraz copies its built `dist/` directory into `/tmp/hydraz-dist` and processes repo `.hydraz/config.json` `hydrazincludes`.
4. Hydraz starts a detached runner with `nohup node /tmp/hydraz-dist/core/codex/runner.js`.
5. The runner executes `codex exec --json --sandbox <mode> -o final.md "<goal prompt>"`.
6. The runner writes `events.jsonl`, `stderr.log`, `final.md`, and `result.json`.
7. On Codex success, the runner commits dirty changes, pushes the branch, and creates a draft PR when GitHub auth is configured.
8. `hydraz status` refreshes local session metadata from remote `result.json` and records completion/failure.

## Core Modules

- `src/core/orchestration/controller.ts` provisions workspaces and starts/stops/resumes detached Codex runners.
- `src/core/codex/args.ts` builds `codex exec` and `codex exec resume` command lines.
- `src/core/codex/events.ts` parses Codex JSONL events needed by Hydraz.
- `src/core/codex/runner.ts` is the remote/local detached runner entrypoint.
- `src/core/codex/delivery.ts` handles commit, push, and draft PR delivery.
- `src/core/providers/*` keeps the existing local, local-container, and cloud workspace providers.

## State Model

Hydraz uses a small v3 session state machine:

```
created -> starting -> syncing -> delivering -> completed
```

Failures move to `failed`; user stops move to `stopped`; preflight/provider issues move to `blocked`.

## Configuration

Global config keeps:

- `executionTarget` defaulting to `cloud`
- `branchNaming.prefix`
- `github.token`
- `codex.command`
- `codex.model`
- `codex.sandbox`
- `codex.search`

Repo config keeps `.hydraz/config.json` with `hydrazincludes`, plus optional `.hydraz/HYDRAZ.md` prompt content.

## Legacy Removal

The v2 orchestration internals and public commands have been removed from the source tree. Older config files may contain extra keys; v3 validation ignores unknown legacy fields and saves only the current config shape.
