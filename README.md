> **EXPERIMENTAL: USE WITH CAUTION** - This CLI is an active exploration of real multi-process coding swarms.

<p align="center">
  <img src="https://raw.githubusercontent.com/josheverett/hydraz/main/hydraz-logo.png" alt="Hydraz logo" width="300">
</p>

<h1 align="center">Hydraz</h1>

<p align="center">
  <strong>Hydra</strong> — many heads, one swarm. <strong>Hydrazine</strong> — rocket fuel.<br>
  An opinionated CLI for autonomous, multi-process coding swarms.
</p>

<p align="center">
  <a href="https://github.com/josheverett/hydraz/actions/workflows/ci.yml"><img src="https://github.com/josheverett/hydraz/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
</p>

Stand in a repo, describe a task, walk away. A real multi-process swarm — powered by Claude Code CLI (Opus 4.6) — investigates, designs, plans, implements in parallel, merges, and runs an independent review panel. You get back a branch with committed work (and a PR in container/cloud mode).

## How it works

Hydraz is a deterministic TypeScript orchestrator that drives a pipeline of independent Claude Code processes:

```
Investigate → Architect → Plan (with consensus loop) → Workers → Merge → Review Panel → Deliver
```

1. An **investigator** explores the repo and documents its structure
2. An **architect** designs the solution based on the investigation
3. A **planner** decomposes the work into tasks; the architect reviews the plan until both agree (up to 10 rounds)
4. **N workers** (default 3, serial by default) implement their assigned tasks in isolated worktrees, each using strict TDD — each worker builds on the previous worker's branch
5. The orchestrator **merges** worker branches into an integration branch
6. A **review panel** independently reviews the result (single generic reviewer by default; configurable via `--reviewers`)
7. If changes are needed, the review feedback is fed to the planner and the pipeline re-runs automatically (up to 5 iterations)
8. When the panel approves, work is delivered (PR in container/cloud mode; branch with commits in local mode)

Every stage produces durable artifacts. Every Claude invocation is stateless — fresh context, no shared conversation history. Communication between stages is entirely file-based.

## Quickstart

### Interactive mode

```bash
npm install -g hydraz
cd your-repo
hydraz
```

### Non-interactive

```bash
hydraz run "fix the auth timeout regression"
hydraz run --workers 5 "build the user management system"
hydraz run --parallel "build the user management system"
hydraz run --reviewers reviewer-a,reviewer-b "refactor the database layer"
```

### CLI flags

| Flag | Description | Default |
|------|-------------|---------|
| `--session <name>` | Session name | Auto-generated from task |
| `--branch <name>` | Branch name | Auto-generated from session |
| `--swarm` | No-op (swarm pipeline always runs) | Always on |
| `--workers <N>` | Number of workers | 3 |
| `--parallel` | Run workers concurrently instead of serially | Off (serial) |
| `--reviewers <names>` | Comma-separated reviewer names | reviewer |
| `--local` | Run locally (bare metal) | Default |
| `--container` | Run locally in a Docker container | |
| `--cloud` | Run on a cloud VM via DevPod | |

## Commands

```bash
hydraz                 # interactive mode — start sessions, attach, review
hydraz run "<task>"    # launch a task directly
hydraz hello-world     # infrastructure sanity check (supports --local, --container, --cloud, --verbose, --branch)

hydraz sessions        # list all sessions in this repo
hydraz status          # show current session state and swarm phase
hydraz attach          # attach to an active session
hydraz stop            # stop an active session
hydraz resume          # resume a stopped/blocked/failed session (currently restarts from scratch)
hydraz review          # review a session's outcome and review panel output
hydraz events          # show structured event history

hydraz config          # configure defaults, auth
hydraz personas        # manage personas
hydraz mcp             # manage MCP server configuration
hydraz clean           # clean up orphaned DevPod workspaces
```

## Review panel

A single generic reviewer evaluates the integrated result by default. The reviewer is strongly biased toward approval — it will only reject if it finds a ship-blocking defect (runtime crash, security vulnerability, fundamental architectural violation, or unmet task requirements). Verdict parsing defaults to `approve` unless `CHANGES REQUESTED` is explicitly found in the first 5 lines of the review output.

Reviewers categorize their findings as **architectural** or **implementation**. Both routes rewind through re-planning via the outer loop; architectural feedback additionally refreshes the architecture design. Review feedback is fed back to the planner so the next iteration can address the specific issues raised. The orchestrator automatically determines the feedback route.

Configurable per-session via `--reviewers` (pass multiple comma-separated names to use a multi-reviewer panel).

## Artifacts

Every session produces a full audit trail at `~/.hydraz/repos/<repo>-<hash>/sessions/<id>/swarm/`:

```
swarm/
  investigation/brief.md          # what the investigator found
  architecture/design.md          # the architect's design
  plan/plan.md                    # the decomposed execution plan
  task-ledger.json                # task assignments, status, metrics
  ownership.json                  # file ownership per worker
  workers/worker-a/brief.md      # each worker's assignment
  workers/worker-a/progress.md   # what each worker did
  merge/report.md                 # merge results
  reviews/reviewer.md             # reviewer's independent review (one per reviewer)
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

### Container setup (one-time)

```bash
# Configure container auth (portable OAuth token for headless Claude Code)
claude setup-token
hydraz config                               # → Claude Code auth → Set OAuth token

# Configure GitHub delivery auth (container/cloud push/PR automation)
hydraz config                               # → GitHub push/PR auth → Set GitHub token

# For local containers
devpod provider add docker

# For cloud containers (e.g. GCP)
devpod provider add gcloud -o PROJECT=my-project -o ZONE=us-central1-a -o MACHINE_TYPE=e2-standard-8
devpod provider use gcloud
```

### Cloud troubleshooting

**`ZONE_RESOURCE_POOL_EXHAUSTED`**: GCP doesn't have capacity for your machine type in the configured zone. Try a different zone: `devpod provider set-options gcloud -o ZONE=us-west1-b`

**Stale DevPod workspaces**: Failed sessions can leave orphaned DevPod workspaces that interfere with new runs. Run `hydraz clean` to auto-detect and force-delete all orphaned workspaces (including ones with no matching session). Hydraz also warns about orphans at session start. As a manual fallback: `devpod list` to check, `devpod delete --force <name>` to remove individually.

**`INACTIVITY_TIMEOUT`**: The default DevPod gcloud provider timeout (5m) can be too short for cold container builds. Increase it: `devpod provider set-options gcloud -o INACTIVITY_TIMEOUT=30m`

## Config

Global config lives at `~/.config/hydraz/`. Session data and worktrees live at `~/.hydraz/repos/<repo>-<hash>/`. No Hydraz-generated files are created in the target repository.

## Development

```bash
npm install
npm test               # Vitest
npm run test:watch     # watch mode
npm run build          # compile TypeScript
npm run typecheck      # type-check without emitting
```

## License

MIT
