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

Hydraz lets an engineer stand in a repository, launch a session, describe a task, and walk away while a strict 3-persona swarm operates autonomously in an isolated workspace — powered by Claude Code CLI under the hood.

Supports local bare-metal execution, local container execution (Docker via DevPod), and cloud container execution (GCP via DevPod).

## Prerequisites

**Required for all modes:**
- **Node.js** >= 20.0.0
- **Claude Code CLI** — must be installed and authenticated (`claude --version` to verify)
- **Git** — required for workspace isolation via worktrees

**Required for container mode (local or cloud):**
- **Docker** (or OrbStack) — container runtime
- **DevPod CLI** — workspace launcher (`devpod version` to verify)
- A `.devcontainer/devcontainer.json` in the target repo (with Claude Code CLI included)
- A **git remote** configured on the target repo — container mode delivers work via push to remote

**Required for cloud mode (GCP):**
- **gcloud CLI** — authenticated with Application Default Credentials
- A GCP project with Compute Engine API enabled and billing linked
- DevPod GCP provider configured: `devpod provider add gcloud -o PROJECT=<id> -o ZONE=<zone> -o MACHINE_TYPE=e2-standard-8`

## Install

```bash
npm install -g hydraz
```

## Usage

### Interactive mode

```bash
cd your-repo
hydraz
```

This opens the interactive console where you can start new sessions, attach to existing ones, or review completed work.

### Non-interactive

```bash
hydraz run "fix the auth timeout regression"
hydraz run --container "refactor the database connection pool"
hydraz run --session fix-auth --branch hydraz/fix-auth "fix the auth timeout"
```

### Session management

```bash
hydraz sessions        # list all sessions in this repo
hydraz status          # show current session state
hydraz attach          # attach to an active session
hydraz stop            # stop an active session
hydraz resume          # resume a stopped/blocked session
hydraz review          # review a session's outcome
hydraz events          # show structured event history
```

### Configuration

```bash
hydraz config          # configure defaults, auth, master prompt
hydraz personas        # manage personas and default swarm
hydraz mcp             # manage MCP server configuration
```

## How it works

1. You submit a task
2. Hydraz creates an isolated workspace on a session branch
   - **Local:** git worktree on the host
   - **Container:** DevPod workspace with git worktree inside the container
3. A 3-persona swarm runs autonomously using Claude Code CLI (Opus 4.6):
   - **Planning** — the Architect decomposes the task
   - **Implementation** — the Implementer writes the code
   - **Verification** — the Verifier checks the work
4. You get back a branch with a review-ready summary

## Config

Global config lives at `~/.config/hydraz/`:

```
~/.config/hydraz/
  config.json          # defaults, auth mode, branch naming, OAuth token
  master-prompt.md     # swarm coordination prompt
  personas/            # built-in + custom persona prompts
  mcp/servers.json     # global MCP server config
```

Session data and worktrees live at `~/.hydraz/repos/<reponame>-<hash>/`.

No Hydraz-generated files are created in the target repository.

## Container auth

For container mode, Claude Code needs a portable OAuth token (the host's browser-based auth doesn't transfer into containers):

1. Run `claude setup-token` to generate a long-lived token
2. Run `hydraz config` → Claude Code auth → Set OAuth token

## Personas

Ships with 6 built-in personas: Architect, Implementer, Verifier, Skeptic, Product Generalist, and Performance/Reliability Engineer.

Each session uses exactly 3. You choose a default swarm and can override per session.

Add custom personas with `hydraz personas` — they're markdown files you can edit directly.

## Development

```bash
npm install
npm test               # run tests
npm run test:watch     # watch mode
npm run build          # compile TypeScript
npm run typecheck      # type-check without emitting
```

## License

MIT
