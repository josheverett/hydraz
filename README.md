<p align="center">
  <img src="hydraz-logo.png" alt="Hydraz logo" width="300">
</p>

<h1 align="center">Hydraz</h1>

<p align="center">
  <strong>Hydra</strong> — many heads, one swarm. <strong>Hydrazine</strong> — rocket fuel.<br>
  An opinionated CLI for autonomous, persona-driven coding swarms.
</p>

<p align="center">
  <a href="https://github.com/josheverett/hydraz/actions/workflows/ci.yml"><img src="https://github.com/josheverett/hydraz/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
</p>

Stand in a repo, describe a task, walk away. A strict 3-persona swarm works autonomously in an isolated workspace — powered by Claude Code CLI (Opus 4.6) — and delivers a branch with committed work, ready for review.

Runs locally, in local containers (Docker via DevPod), or on cloud VMs (any cloud provider via DevPod — GCP, AWS, Azure, etc.).

## Quickstart

### Interactive mode

```bash
npm install -g hydraz
cd your-repo
hydraz
```

This opens the interactive console where you can start new sessions, attach to running ones, review completed work, and manage configuration — all from a single entry point.

<!-- TODO: add terminal recording / video gif here -->

### Non-interactive

```bash
hydraz run "fix the auth timeout regression"
hydraz run --container "refactor the database connection pool"
```

### Container setup (one-time)

Container mode runs the swarm in an isolated Docker container (locally or on any cloud provider via DevPod). Requires a `.devcontainer/devcontainer.json` in the target repo with Claude Code CLI included, and a git remote configured.

```bash
# Configure container auth (portable OAuth token for headless Claude Code)
claude setup-token
hydraz config                               # → Claude Code auth → Set OAuth token

# For local containers
devpod provider add docker

# For cloud containers (e.g. GCP)
devpod provider add gcloud -o PROJECT=my-project -o ZONE=us-central1-a -o MACHINE_TYPE=e2-standard-8
devpod provider use gcloud
```

Cloud uses the same container pipeline as local. The only difference is which DevPod provider is active.

## What happens when you run it

```
Session "fix-auth-timeout-8pr3" started on branch hydraz/fix-auth-timeout-8pr3
Task: fix the auth timeout regression

2026-03-25T06:05:26Z  session.state_changed    Session starting
2026-03-25T06:05:26Z  claude.auth_resolved     Auth: Claude.ai subscription (OAuth)
2026-03-25T06:05:31Z  workspace.created        Workspace ready
2026-03-25T06:05:32Z  claude.init              claude-opus-4-6 (23 tools)
2026-03-25T06:05:38Z  claude.tool              Glob: **/*.ts
2026-03-25T06:05:44Z  claude.text              ## Phase 1: Intake — analyzing the auth timeout...
2026-03-25T06:05:50Z  claude.tool              Read: src/auth/session.ts
2026-03-25T06:06:02Z  claude.tool              Edit: src/auth/session.ts
2026-03-25T06:06:15Z  claude.tool              Bash: npm test
2026-03-25T06:06:33Z  claude.text              ## Phase 4: Verification — all tests passing...
2026-03-25T06:06:40Z  claude.tool              Bash: git add . && git commit -m "fix: auth timeout"
2026-03-25T06:06:45Z  claude.tool              Bash: git push -u origin hydraz/fix-auth-timeout-8pr3
2026-03-25T06:06:50Z  claude.complete          Session complete · $0.24 · 45s · 12 turns
2026-03-25T06:06:50Z  session.completed        Session completed successfully
```

You get back a branch with committed, tested work.

## How it works

1. You submit a task (interactive or CLI)
2. Hydraz creates an isolated workspace on a session branch
3. A 3-persona swarm runs autonomously:
   - **Architect** — decomposes the task into a plan
   - **Implementer** — writes the code
   - **Verifier** — checks the work, runs tests
4. Work is committed and pushed to the session branch

## Commands

```bash
hydraz                 # interactive mode — start sessions, attach, review
hydraz run "<task>"    # launch a task directly
hydraz run --container "<task>"  # run in a container (local or cloud)

hydraz sessions        # list all sessions in this repo
hydraz status          # show current session state
hydraz attach          # attach to an active session
hydraz stop            # stop an active session
hydraz resume          # resume a stopped/blocked session
hydraz review          # review a session's outcome
hydraz events          # show structured event history

hydraz config          # configure defaults, auth, master prompt
hydraz personas        # manage personas and default swarm
hydraz mcp             # manage MCP server configuration
hydraz clean           # clean up orphaned DevPod workspaces
```

## Prerequisites

**All modes:**
- [Node.js](https://nodejs.org/) >= 20
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) — installed and authenticated
- [Git](https://git-scm.com/)

**Container mode** (adds):
- [Docker](https://www.docker.com/) or [OrbStack](https://orbstack.dev/)
- [DevPod CLI](https://devpod.sh/)
- `.devcontainer/devcontainer.json` in the target repo (must include Claude Code CLI)
- A git remote on the target repo

**Cloud mode** (adds):
- A cloud provider configured in DevPod (GCP, AWS, Azure, etc.)
- Cloud account with compute permissions and billing enabled

## Personas

Ships with 6 built-in personas: Architect, Implementer, Verifier, Skeptic, Product Generalist, and Performance/Reliability Engineer.

Each session uses exactly 3. You choose a default swarm and can override per session. Add custom personas with `hydraz personas` — they're markdown files you can edit directly.

## Config

Global config lives at `~/.config/hydraz/`. Session data and worktrees live at `~/.hydraz/repos/<repo>-<hash>/`. No Hydraz-generated files are created in the target repository.

## Development

```bash
npm install
npm test               # 421 tests (Vitest)
npm run test:watch     # watch mode
npm run build          # compile TypeScript
npm run typecheck      # type-check without emitting
```

## License

MIT
