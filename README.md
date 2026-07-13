> **EXPERIMENTAL: USE WITH CAUTION** - Hydraz v4 is a deliberately small harness around the Codex CLI.

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
| `--base <branch>` | Base branch for workspace creation and PR delivery |
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
| `--verbose` | Enable diagnostic output with known token/API-key values redacted |

Use `--base <branch>` when the session should branch from and open its PR against a branch other than the repository default, for example `hydraz run --base staging "Update the demo"`.

## Repo Configuration

Target repos may include `.hydraz/config.json` with `hydrazincludes` entries.
Hydraz retains the v3 behavior of copying those arbitrary host paths into the
container/cloud workspace before starting Codex.

```json
{
  "hydrazincludes": [
    { "host": "~/.config/example", "container": "~/.config/example" }
  ]
}
```

Local container runs do not require include entries for Codex. Hydraz imports
host `auth.json`, global `AGENTS.md`, rules, and user-authored skills from
`$CODEX_HOME` (or `~/.codex`) into an isolated container home. It builds a
Linux-safe `config.toml` from portable host preferences and then applies the
optional repository overlay `.hydraz/codex.container.toml`.

Host MCP servers, plugins, marketplaces, hooks, notifications, trust state,
feature flags, commands, desktop/TUI settings, and path-bearing sections are
not imported. Plugins, browser caches, sessions, and other runtime state are
never copied. Install Linux capability replacements in the Dev Container and
declare them in the container overlay instead.

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

## Single Executable

`pnpm run build:sea` builds the GitHub release binary. The SEA binary embeds the container runner payload that Hydraz copies into DevPod workspaces, so container/cloud mode does not depend on an adjacent repository `dist/` directory.

The SEA build smoke checks both `hydraz --version` and the embedded runner payload path before packaging the tarball.

## Secret Redaction

Hydraz redacts known secret formats before writing verbose debug output or session events. This includes GitHub token prefixes such as `github_pat_` and `ghp_`, OpenAI-style `sk-...` keys, authorization header values, and token-like JSON/env fields.

Redaction is applied only at logging and local event persistence boundaries. Runtime values passed to DevPod, GitHub, Codex, and subprocess environments are not modified.

`--verbose` can still include sensitive paths, branch names, repo names, and other operational metadata. It should be treated as diagnostic output, not a public log format.

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

The repo uses pnpm with a 7-day minimum package age cooldown (`minimumReleaseAge: 10080`).

## License

MIT
