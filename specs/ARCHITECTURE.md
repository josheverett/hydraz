# Hydraz v4.1 Architecture

Hydraz is a Codex CLI harness. It no longer implements a custom multi-agent pipeline, review panel, or role-based orchestration layer.

## Pipeline

```
CLI -> Session metadata -> Workspace provider -> Detached Codex runner -> Delivery
```

1. The CLI creates a Hydraz session and chooses an execution target. Cloud is the default.
2. The provider creates a local worktree, local DevPod container, or cloud DevPod workspace.
3. For container/cloud runs, Hydraz copies its built `dist/` directory into `/tmp/hydraz-dist` and processes repo `.hydraz/config.json` `hydrazincludes`. SEA binaries extract an embedded dist-shaped runner payload first, then copy that extracted payload.
4. Hydraz starts a detached runner with `nohup node /tmp/hydraz-dist/core/codex/runner.js`.
5. The runner executes `codex exec --json --model <model> -c model_reasoning_effort=<effort> -c features.fast_mode=<bool> -c service_tier=<tier> --sandbox <mode> -o final.md "<goal prompt>"`. For container/cloud targets, Hydraz also uses `--sandbox danger-full-access --skip-git-repo-check -c 'web_search_mode="live"'` because DevPod is the external isolation boundary and Codex's `workspace-write` Linux sandbox can fail under DevPod.
6. The runner writes prompt-safe `invocation.json` lifecycle evidence plus `events.jsonl`, `stderr.log`, `final.md`, and `result.json`.
7. On Codex success, the runner commits dirty changes, pushes the branch, verifies the branch is ahead of the base branch, and creates a draft PR when GitHub auth is configured.
8. `hydraz status` refreshes local session metadata from remote `result.json`, retains invocation and rollout proof, records completion/failure, and cleans up delivered remote workspaces.

## Core Modules

- `src/core/orchestration/controller.ts` provisions workspaces and starts/stops/resumes detached Codex runners.
- `src/core/codex/args.ts` builds supported `codex exec` and `codex exec resume` command lines. Shared exec flags are placed before `resume`; live search is enabled with config overrides, not `--search`.
- `src/core/codex/events.ts` parses Codex JSONL events needed by Hydraz.
- `src/core/codex/invocation.ts` records versioned, prompt-omitted spawn lifecycle evidence.
- `src/core/codex/rollout.ts` performs best-effort comparison with Codex rollout `turn_context` records.
- `src/core/codex/runner.ts` is the remote/local detached runner entrypoint.
- `src/core/codex/delivery.ts` handles commit, push, and draft PR delivery.
- `src/core/display/sanitize.ts` strips terminal control characters and redacts known secret values before debug or event output is displayed or persisted.
- `scripts/build-sea.sh` builds the release binary and embeds `core/codex/runner.js` as a SEA asset so the binary can support container/cloud runs without an adjacent `dist/` tree.
- `src/core/providers/*` keeps the existing local, local-container, and cloud workspace providers.
- `src/cli/commands/debug.ts` renders prompt-safe invocation proof and clearly separates it from Codex self-recorded and unverifiable backend state.

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
- `codex.reasoningEffort`
- `codex.speed`
- `codex.sandbox`
- `codex.search`

The built-in managed defaults are `gpt-5.6-sol`, `ultra`, and `fast`.
Precedence is per-command override, then session-pinned value on resume, then
global Hydraz config, then the built-in defaults. All three values are passed
explicitly for new and resumed local, container, and cloud runs. Fast maps to
`features.fast_mode=true` plus `service_tier="priority"`; standard maps to
`features.fast_mode=false` plus `service_tier="default"`.

For container-backed runs, runtime options override the configured Codex sandbox to `danger-full-access` unless the CLI explicitly supplies `--sandbox`, and set `skipGitRepoCheck` for Codex exec. `codex.search` is normalized into a `web_search_mode="live"` config override by default.

Repo config keeps `.hydraz/config.json` with `hydrazincludes`, plus optional `.hydraz/HYDRAZ.md` prompt content.

## Secret Handling

Hydraz must pass real GitHub/Codex credentials to DevPod, Codex, Git, and GitHub APIs at runtime, but those values must not be printed or persisted in diagnostic artifacts. Verbose debug output and session events are redacted at the output boundary for known secret formats including GitHub PAT/OAuth token prefixes, OpenAI-style API keys, authorization headers, and token-like JSON/env fields. Serialized runner bootstrap options are omitted entirely from SSH diagnostics.

## Proof Semantics

`invocation.json` and its copy in `result.json` prove the exact non-prompt
arguments Hydraz passed to the Codex process. They do not prove how the backend
routed the request.

When available, the runner separately reads the matching Codex rollout and
compares the latest `turn_context` model and reasoning effort, plus service tier
when present. This is labeled Codex self-recorded evidence. Unknown, missing, or
malformed rollout data produces `unavailable`, never a runner failure.

`hydraz debug [session]` presents these two proof layers and explicitly labels
backend routing as not externally verifiable.

Hydraz 4.1 requires Codex CLI 0.144.0 or newer for the GPT-5.6 Sol defaults.

## Legacy Removal

The v2 orchestration internals and public commands have been removed from the source tree. Older config files may contain extra keys; v3 validation ignores unknown legacy fields and saves only the current config shape.
