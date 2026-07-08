> **EXPERIMENTAL: USE WITH CAUTION** - Hydraz v3 is a deliberately small harness around the Codex CLI.

<p align="center">
  <img src="https://raw.githubusercontent.com/josheverett/hydraz/main/hydraz-logo.png" alt="Hydraz logo" width="300">
</p>

<h1 align="center">Hydraz</h1>

Hydraz provisions a local, container, or cloud workspace, injects repo-owned auth/config files, starts a detached `codex exec --json` run, and records enough metadata to check status, stream logs while the workspace exists, resume, stop, and deliver the result.

Codex owns the agent behavior. Hydraz owns the harness:

```
Provision workspace -> copy Hydraz runner -> run codex exec -> persist logs/result -> push/PR
```

## Quickstart

```bash
pnpm install
pnpm build

hydraz run "Implement the migration and keep tests green"
hydraz status
hydraz logs <session>
hydraz resume <session> "Continue from the previous blocker"
```

`hydraz run` defaults to cloud mode. Use `--local` or `--container` when you want a different target.

## Commands

```bash
hydraz run "<goal>"        # start a detached Codex goal, cloud by default
hydraz status [session]    # refresh and show session state
hydraz attach [session]    # show session details and stream remote Codex events
hydraz logs <session>      # print Codex JSONL events
hydraz resume <session> "<prompt>"
hydraz stop [session]      # stop the detached runner
hydraz sessions            # list sessions
hydraz sessions clear      # clear local Hydraz sessions for this repo
hydraz shell <session>     # open devpod ssh for container/cloud sessions
hydraz clean               # remove orphaned DevPod workspaces
hydraz config              # configure Codex/GitHub defaults
```

### `run` Options

| Flag | Description |
|------|-------------|
| `--session <name>` | Session name |
| `--branch <name>` | Branch name |
| `--model <model>` | Pass a model override to Codex |
| `--sandbox <mode>` | `read-only`, `workspace-write`, or `danger-full-access`; container/cloud runs default Codex to `danger-full-access` inside the DevPod boundary |
| `--search` | Enable live Codex web search; currently enabled by default via Codex config overrides |
| `--no-push` | Do not push after Codex completes |
| `--no-pr` | Do not create a draft PR |
| `--keep-workspace` | Preserve workspace after successful delivery |
| `--local` | Run on a local worktree |
| `--container` | Run in a local DevPod container |
| `--cloud` | Run in a cloud DevPod workspace (default) |
| `--no-clone` | Use local repo path instead of cloning from remote |
| `--verbose` | Enable diagnostic output |

## Repo Configuration

Target repos may include `.hydraz/config.json` with `hydrazincludes` entries. Hydraz copies these host paths into the container/cloud workspace before starting Codex, which is the intended auth/bootstrap path for v3.

```json
{
  "hydrazincludes": [
    { "host": "~/.codex/auth.json", "container": "~/.codex/auth.json" },
    { "host": "~/.codex/config.toml", "container": "~/.codex/config.toml" }
  ]
}
```

Optional `.hydraz/HYDRAZ.md` content is appended to the goal-shaped prompt passed to Codex. `AGENTS.md` remains Codex-native and is read by Codex itself.

## Codex Invocation

Hydraz runs Codex non-interactively through `codex exec`. For container and cloud targets, DevPod is the outer sandbox, so Hydraz gives Codex full access inside that workspace and avoids Codex's inner Linux sandbox:

```bash
codex exec \
  --json \
  --sandbox danger-full-access \
  --skip-git-repo-check \
  -c 'web_search_mode="live"' \
  -o final.md \
  "<goal prompt>"
```

Hydraz intentionally does not pass `codex exec --search`; in Codex CLI 0.143.x that flag belongs to the interactive entrypoint, not `exec`. Live web search is enabled for `exec` with the `web_search_mode` config override instead.

## Session Data

Hydraz stores local session metadata under:

```
~/.hydraz/repos/<repo>-<hash>/sessions/<id>/
  session.json
  events.jsonl
  codex/
    events.jsonl
    stderr.log
    final.md
    result.json
```

For container/cloud sessions, Codex artifacts live in the remote workspace under `/tmp/hydraz-codex/<session-id>/` and the local `session.json` records their paths plus the detached runner PID, Codex thread id, delivery result, and PR URL when delivery succeeds.

Successful delivery may clean up the remote DevPod workspace. After cleanup, commands that need remote artifacts, such as `hydraz logs`, can no longer SSH to those paths. Use `hydraz attach`/`hydraz logs` while a session is active, and use `hydraz status <session>` after completion to refresh local delivery metadata.

Use `hydraz sessions clear --force` to remove local Hydraz session metadata and local workspace directories for the current repo. This does not delete Git branches. Use `hydraz clean --force` separately to remove orphaned DevPod workspaces and backing VMs.

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

The repo uses pnpm with a 7-day minimum package age cooldown (`minimum-release-age=10080`) to reduce supply-chain risk.

## License

MIT
