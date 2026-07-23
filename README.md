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

Container mode supports Compose-based devcontainers with a custom `workspaceFolder`. Hydraz pins a unique Compose project name for each local-container session and removes that project's named volumes during workspace cleanup.

## Commands

```bash
hydraz run "<goal>"        # start a detached Codex goal, cloud by default
hydraz status [session]    # refresh and show session state
hydraz attach [session]    # show session details and stream remote Codex events
hydraz logs <session>      # print Codex JSONL events
hydraz resume <session> "<prompt>"
hydraz debug [session]     # show prompt-safe invocation and rollout proof
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
| `--reasoning-effort <effort>` | Override Codex reasoning effort |
| `--speed <speed>` | `fast` or `standard` |
| `--max-runtime <duration>` | Maximum cloud workspace runtime; defaults to `24h` |
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

Cloud runs pass the maximum runtime to DevPod as the workspace inactivity timeout. DevPod measures its own control-plane activity rather than Codex CPU, process, network, or repository activity, so Hydraz treats this value as a hard runtime lease for detached work. Override the `24h` default when a goal needs a different bound, for example `hydraz run --max-runtime 36h "Run the reliability evaluation"`.

`hydraz resume` accepts the same `--model`, `--reasoning-effort`, and `--speed`
overrides.

## Managed Codex Runtime Settings

Hydraz owns the model settings used for every Codex run instead of relying on
ambient Codex defaults. Fresh and legacy Hydraz configs resolve to:

```json
{
  "codex": {
    "model": "gpt-5.6-sol",
    "reasoningEffort": "ultra",
    "speed": "fast"
  }
}
```

Use `hydraz config` to view or change these values. Global settings are stored
in `~/.config/hydraz/config.json`.

Resolution precedence is:

1. `hydraz run` or `hydraz resume` flags
2. settings pinned to the session being resumed
3. global Hydraz config
4. the Sol/Ultra/Fast built-in defaults

Hydraz pins the resolved values in session metadata. A resume therefore keeps
the original model configuration unless the resume command explicitly
overrides it. Host Codex config and `.hydraz/codex.container.toml` remain
available for unrelated preferences, but cannot override these managed values.

Hydraz 4.1 requires Codex CLI 0.144.0 or newer for the GPT-5.6 Sol defaults.

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

Container and cloud runs do not require include entries for Codex. Hydraz
imports host `auth.json`, global `AGENTS.md`, rules, and user-authored skills
from `$CODEX_HOME` (or `~/.codex`) into an isolated session home. It builds a
Linux-safe `config.toml` from portable host preferences and then applies the
optional repository overlay `.hydraz/codex.container.toml`.

Existing `hydrazincludes` entries still copy their literal targets before the
automatic Codex import. Hydraz does not reinterpret a legacy `~/.codex` target
as the isolated session home.

Host MCP servers, plugins, marketplaces, hooks, notifications, trust state,
feature flags, commands, desktop/TUI settings, and path-bearing sections are
not imported. Plugins, browser caches, sessions, and other runtime state are
never copied. For container and cloud runs, Hydraz provisions its pinned
Playwright CLI and matching Linux Chromium under the container user's home and
exposes the ordinary `playwright` command directly on `PATH`. The target
repository does not need Playwright dependencies, an MCP server, or
browser-specific configuration. Other Linux-specific replacements can still be
installed by the Dev Container and configured through the optional container
overlay.

Optional `.hydraz/HYDRAZ.md` content is appended to the goal-shaped prompt passed to Codex. `AGENTS.md` remains Codex-native and is read by Codex itself.

## Codex Invocation

Hydraz runs Codex non-interactively through `codex exec`. For container and cloud targets, DevPod is the outer sandbox, so Hydraz gives Codex full access inside that workspace and avoids Codex's inner Linux sandbox:

```bash
codex exec \
  --json \
  --sandbox danger-full-access \
  --model gpt-5.6-sol \
  --skip-git-repo-check \
  -c 'model_reasoning_effort="ultra"' \
  -c 'features.fast_mode=true' \
  -c 'service_tier="priority"' \
  -c 'web_search_mode="live"' \
  -o final.md \
  "<goal prompt>"
```

`fast` maps to `features.fast_mode=true` and `service_tier="priority"`.
`standard` explicitly maps to `features.fast_mode=false` and
`service_tier="default"`.

Hydraz intentionally does not pass `codex exec --search`; live web search is
enabled for `exec` with the `web_search_mode` config override instead.

## Invocation Diagnostics

Each runner writes `codex/invocation.json` from the same command object passed
to `spawn()`. It records the exact non-prompt argv, requested and normalized
model settings, mode, timestamps, spawn state, Codex thread id, and exit code.
The goal or resume prompt is omitted. Completed runner results embed the same
evidence so it remains available after a remote workspace is destroyed.

Use `hydraz debug [session]` to inspect:

- **Invocation proof**: what Hydraz passed to the Codex process
- **Codex self-recorded proof**: best-effort model and reasoning values from the
  matching Codex rollout `turn_context`
- **Backend routing**: explicitly reported as not externally verifiable

Rollout formats are internal to Codex. Missing or changed data is reported as
`unavailable` and never fails a run. Service tier is compared only when Codex
records it.

## Single Executable

`pnpm run build:sea` builds the GitHub release binary. The SEA binary embeds the container runner and the platform-neutral Playwright runtime that Hydraz copies into DevPod workspaces, so container/cloud mode does not depend on an adjacent repository `dist/` directory. Chromium itself and its Ubuntu dependencies are installed inside container and cloud workspaces on first use and reused after a successful smoke check.

The SEA build smoke checks `hydraz --version` plus both embedded container payloads before packaging the tarball.

## Secret Redaction

Hydraz redacts known secret formats before writing verbose debug output or session events. This includes GitHub token prefixes such as `github_pat_` and `ghp_`, OpenAI-style `sk-...` keys, authorization header values, and token-like JSON/env fields. Serialized `HYDRAZ_CODEX_RUNNER_OPTIONS` values are omitted entirely from verbose SSH command output.

Redaction is applied only at logging and local event persistence boundaries. Runtime values passed to DevPod, GitHub, Codex, and subprocess environments are not modified.

`--verbose` can still include sensitive paths, branch names, repo names, and other operational metadata. It should be treated as diagnostic output, not a public log format.

## Session Data

Hydraz stores local session metadata under:

```
~/.hydraz/repos/<repo>-<hash>/sessions/<id>/
  session.json
  events.jsonl
  codex/
    invocation.json
    events.jsonl
    stderr.log
    final.md
    result.json
```

For container/cloud sessions, Codex artifacts live in the remote workspace under `/tmp/hydraz-codex/<session-id>/` and the local `session.json` records their paths plus the detached runner PID, requested model settings, prompt-safe invocation evidence, rollout verification, Codex thread id, delivery result, and PR URL when delivery succeeds.

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
