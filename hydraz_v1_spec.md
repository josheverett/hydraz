# Hydraz v1 Specification

## 0. Current State (read this first)

**Status:** Phases 0-16 complete. 38 test files. The full pipeline works end-to-end: local bare-metal, local containers (Docker via DevPod), and cloud containers (GCP via DevPod, proven with zero code changes from local). Container workspaces are automatically cleaned up after verified push; orphans can be cleaned manually with `hydraz clean`.

**Next step:** Phase 17 (multi-executor backend support) is deferred until a second backend is needed. All v1 phases are complete.

**Codebase entry points:** `src/cli/index.ts` (CLI entry), `src/core/orchestration/controller.ts` (session lifecycle), `src/core/providers/local-container.ts` (container provider), `src/core/claude/executor.ts` (Claude Code executor).

**Agent workflow conventions:**
- Suggest a conventional commit message at the end of every turn where you write code. The human commits manually.
- Put any questions for the human at the very bottom of your message, in bold.
- Never suggest stopping or "picking up in the next session." Keep working until told to stop.
- When you encounter an ambiguity or design decision that needs input, discuss it before proceeding. When agreement is reached, update the spec.
- Always remind the human to rebuild (`npm run build`) before manual testing.
- Stop after each atomic sub-phase so the human can run `npm test` and commit.
- **Spec and README must stay current with every commit.** Any commit that changes behavior, adds commands, changes test counts, or modifies the public surface must include corresponding updates to both `hydraz_v1_spec.md` and `README.md`. When editing either document, perform multiple self-review passes to ensure all information is internally consistent — test counts, command lists, phase statuses, deliverable claims, and current-state summaries must all agree with each other and with the actual codebase.
- **CRITICAL:** See Section 26b (Coding Standards) for prove-it-first methodology (the most important rule), TDD, type deduplication, and phase completion gate rules.

## 1. Overview

Hydraz is an interactive, repo-root CLI for autonomous, persona-driven coding swarms.

The near-term goal is not to build a generic "agent platform." The goal is to ship an opinionated developer tool that lets an engineer stand in a repository, launch a session, describe a task, and walk away while a 3-agent swarm operates autonomously in an isolated local or cloud workspace.

Hydraz is intended to become:
- an internal engineering standard first
- a public installable CLI later, via npm (`npm install -g hydraz`) as the primary distribution channel
- eventually also packaged for Homebrew distribution on macOS

The design should therefore optimize for:
- fast onboarding
- strong defaults
- low conceptual overhead
- clear session state
- reproducible environments
- forward compatibility with public packaging and future integrations

Hydraz should feel closer to "a real coding operator" than "a prompt runner."

---

## 2. Product Goals

### Primary product goal
Enable an engineer to do something as simple as:

1. `cd` into a repo
2. run `hydraz`
3. choose a session or create a new one
4. describe the task
5. choose local or cloud execution
6. leave the system to work autonomously

### Secondary product goals
- Support both local and cloud execution from day one
- Standardize agent workflows across an engineering team
- Minimize branch/worktree/session chaos
- Allow opinionated persona-driven swarms without exposing complexity in normal usage
- Make the CLI interactive by default, while still supporting non-interactive scriptable invocation
- Use Claude Code CLI under the hood as the default execution backend (with future support for alternative backends)
- Support Claude Max OAuth-token-based headless auth for containerized/devcontainer execution
- Provide clean future extension points for:
  - events/webhooks
  - richer UI
  - integrations
  - Homebrew install

### Non-goals for v1
- Building a generic N-agent platform
- Supporting arbitrary swarm sizes
- Exposing every internal phase as a user-facing command
- Becoming a giant logging/observability system
- Requiring users to understand internal orchestration
- Building a custom code-editing engine (Hydraz orchestrates; coding backends like Claude Code do the work)
- Making every repo or team invent its own workflow contract

---

## 3. Core Product Philosophy

Hydraz should be built around a few strong beliefs.

### 3.1 Humans should submit jobs, not drive every phase
The engineer should not need to run:
- planner
- implementer
- verifier
- review
- branch setup
- worktree setup
- log plumbing

That is Hydraz's job.

The human-facing workflow should be job submission and result review.

### 3.2 Workspace isolation matters more than swarm theatrics
A huge portion of the real pain comes from:
- dev server port conflicts
- mixed runtime state
- branch chaos
- context contamination across tasks
- local environment inconsistency

Therefore:
- environment isolation is foundational
- swarm autonomy is layered on top

### 3.3 Three personas is a strict product choice
Hydraz v1 should support exactly 3 agents/personas per session.

This is not a technical limit; it is an opinionated product constraint. The design should be intentionally strict here. Three is treated as the battle-tested sweet spot and the CLI should be philosophically committed to it.

### 3.4 The system prompt is policy, not a toy
Hydraz should have a strong built-in "master swarm prompt" that explains:
- what the swarm is
- how the swarm coordinates
- what artifacts it should produce
- how it should behave autonomously
- when to stop, escalate, or self-correct

Users may edit the global master prompt, but if many users feel compelled to do so, that is a product smell. Persona editing is normal; master prompt editing should be rare.

### 3.5 Artifacts and events beat raw firehose logs
Hydraz should not dump giant log rivers into the CLI by default.

The primary user-facing outputs should be:
- status
- review summary
- structured framework events
- artifacts such as summaries, plans, verification reports, and PR drafts

Full transcripts or app logs may exist as optional retained artifacts, but should not define the normal UX.

### 3.6 Strong defaults enable team standardization
Hydraz is initially meant to be shared as a standard with an engineering team. That means:
- one blessed setup path
- one blessed session model
- one blessed persona model
- one blessed config model
- one blessed interactive experience

The CLI should not feel like a loose toolkit.

### 3.7 Hydraz orchestrates; coding backends do the work
Hydraz is not building its own autonomous code-editing model runtime.

Hydraz is:
- the operator shell
- the session manager
- the workspace manager
- the persona/prompt/config layer
- the orchestration layer
- the event/artifact layer

The coding executor backend (Claude Code CLI by default) is:
- the actual coding engine
- the thing running commands, editing files, using tools, leveraging MCPs, and performing the core coding work inside each workspace

This separation is core to the design.

---

## 4. Naming and Branding Context

The CLI name is **Hydraz**.

Important naming note to preserve:
- It carries a double meaning/reference:
  - Hydra / mythology / many heads / swarm
  - Hydrazine / propulsion / volatile energy

This double meaning should be remembered in future product/branding work.

---

## 5. High-Level Technical Direction

## 5.1 Recommended stack direction
The working plan assumes:
- Node.js / TypeScript for the CLI
- Inquirer (`@inquirer/prompts`) for all interactive prompts and wizard flows
- Commander for CLI command parsing and routing
  - Inquirer and Commander are complementary: Commander parses invocations like `hydraz run --cloud "fix this"` into commands, flags, and arguments and routes to the right handler; Inquirer drives interactive prompts within those handlers
  - Commander is the most popular Node CLI parsing library (~50M weekly downloads), has zero dependencies, and has strong TypeScript support
- DevPod as the workspace launcher abstraction for local/cloud container execution
- `.devcontainer/devcontainer.json` per the open Dev Container standard
- Git-aware session/branch management
- Claude Code CLI as the default execution backend
- MCP support as a first-class tool configuration concept
- A Hydraz orchestration layer that launches and coordinates executor backend sessions/processes

### Why Node/TypeScript
- Best fit for a polished public CLI
- Natural path to npm distribution
- Easy future path to Homebrew packaging
- Strong ecosystem for interactive CLIs
- Good interop with shell tooling and JSON/YAML-based config

### Why Claude Code CLI
Claude Code CLI is required for v1. It is the only supported executor backend. The architecture uses a clean adapter boundary (see Phase 17) so alternative backends can be added in the future, but that is out of scope for v1.

For v1, Hydraz requires:
- Claude Code CLI is installed and available inside the workspace
- Hydraz launches Claude Code under the hood
- Hydraz delegates all coding/tool-use behavior to Claude Code
- Hydraz layers persona coordination, session identity, and workflow on top

Claude Code was chosen because of:
- compatibility with the user's current stack
- plugin/MCP familiarity
- Claude Max plan compatibility
- alignment with existing real-world usage patterns

---

## 6. Claude Code Dependency and Auth Model

This section is critical and should be treated as hard architecture, not an implementation footnote.

## 6.1 Claude Code is required for v1
Hydraz v1 requires Claude Code CLI. Alternative backends are out of scope for v1 (see Phase 17 for future plans).

This means:
- Hydraz should verify Claude Code availability during `hydraz config`
- workspaces/containers should ensure `claude` is installed and callable
- Hydraz runtime integration should be built around launching and supervising executor backend sessions/processes

## 6.2 Auth modes Hydraz must support
Hydraz should support at least two Claude Code auth modes:

### Mode A: Claude.ai subscription auth
For:
- Claude Pro users
- Claude Max users

This is especially important because Hydraz must support Claude Max plans.

### Mode B: API key auth
For:
- API-billed usage
- organizational/automation cases
- non-subscription flows

Both modes should be represented cleanly in Hydraz config.

## 6.3 Headless/container auth is not interactive login
For headless devcontainers, remote workspaces, and unattended sessions, Hydraz should **not** center its design around running interactive `/login` inside the container.

That is the wrong default for this product.

Instead, the correct default for headless/containerized subscription usage is:
- generate a Claude Code OAuth token on a logged-in machine
- store/reference that token via Hydraz config/secret handling
- inject that token into the devcontainer/workspace
- let Claude Code run headlessly using that auth

This is especially important for Claude Max users.

## 6.4 Max-plan OAuth token support must be first-class
Hydraz must explicitly support the Claude Max OAuth-token path.

This should not be treated as a hack or edge case.

The design assumption should be:
- a user may already have a Claude Max plan
- they may want Hydraz to consume that auth path inside containers/workspaces
- Hydraz should make that viable and straightforward

## 6.5 Recommended auth UX
### Local/manual usage
Interactive Claude login may still be supported as a convenience path on a human-operated machine.

### Headless/containerized usage
Preferred path:
- user generates or provides OAuth token
- Hydraz stores it securely or references it
- workspace mounts/injects it
- Claude Code uses it headlessly

### API-key-based usage
Hydraz should also support:
- API key entry
- env-based injection
- provider-specific secret handling later

## 6.6 Configurable auth source
Hydraz config should allow selecting or displaying the active auth mode, e.g.:
- `claude-ai-oauth`
- `api-key`

Hydraz should also clearly indicate which auth source is active for a session.

This matters because auth precedence can otherwise become confusing.

## 6.7 Token/config injection model
Hydraz should support one or more of:
- environment variable injection
- mounted secret/config file
- persistent Claude config directory mount
- cloud secret reference

The exact mechanism can vary by provider, but the product contract should be clear:
Hydraz is responsible for making Claude Code auth work inside the target workspace.

## 6.8 Security considerations
Hydraz should assume:
- tokens are sensitive secrets
- containers/workspaces are trusted only to the extent the repo/task is trusted
- secret exposure inside a compromised workspace is a real risk

Therefore:
- do not print tokens
- avoid persisting secrets in repo-local state
- prefer secret stores / env injection / mounted secure config
- clearly distinguish user config from session metadata

---

## 7. User-Facing CLI Shape

## 7.1 Core commands

The current favored command surface is:

```bash
hydraz
hydraz config
hydraz run "<task>"
hydraz attach
hydraz sessions
hydraz status
hydraz review
hydraz resume
hydraz stop
hydraz events
hydraz personas
hydraz mcp
hydraz clean
```

This should remain intentionally small.

### Command intent

#### `hydraz`
Interactive default entrypoint when run from repo root.

Used for:
- attach vs new session
- review completed sessions
- config entrypoint
- common day-to-day use

#### `hydraz config`
Configure global defaults and advanced settings:
- default execution target
- default swarm personas
- master swarm prompt
- MCP servers
- branch naming defaults
- event retention / artifact retention policy
- provider preferences
- Claude Code auth mode
- Claude Code auth secret setup

Renamed from "bootstrap" because "config" is more natural and familiar.

#### `hydraz run "<task>"`
Non-interactive way to launch a task directly.

Supports:
- freeform prompts
- issue URLs such as Linear links
- automation/script flows

#### `hydraz attach`
Attach to an existing session in the current repo.

#### `hydraz sessions`
List active/resumable/completed sessions in the current repo.

#### `hydraz status`
Human-readable summary of session state.

Should not dump giant logs.

#### `hydraz review`
Review-ready summary of a session's outcome:
- branch
- files touched
- checks run
- pass/fail
- blockers
- PR draft summary

#### `hydraz resume`
Resume a paused/interrupted/blocked session.

#### `hydraz stop`
Stop an active session.

Should support both graceful and hard-stop semantics later, but v1 can start with a simpler stop mechanism.

#### `hydraz events`
Structured framework-level event history only.

This replaces vague `logs`.

#### `hydraz personas`
Manage built-in and custom personas and choose the global default swarm.

#### `hydraz mcp`
Manage MCP server configuration and connectivity.

#### `hydraz clean`
Clean up orphaned DevPod workspaces from completed, stopped, or failed container sessions. Lists orphans with their session state and DevPod status, then prompts for confirmation before destroying. Supports `--force` to skip the confirmation prompt.

---

## 8. Interactive UX Expectations

## 8.1 Running `hydraz` from repo root
The default UX should be interactive.

Hydraz detects:
- current repo
- existing active sessions
- resumable sessions
- recent completed sessions
- current branch

Then presents a menu similar to:

```text
Hydraz — payments-service

1. Attach to existing session
2. Start new session
3. Review completed session
4. Config
```

### Rationale
This makes the tool feel like an operating console rather than just another task-runner binary.

## 8.2 New session flow
When the user starts a new session, the flow should be short and discrete.

Example:

1. Enter session name
2. Accept or edit suggested branch name
3. Choose execution target:
   - Local
   - Cloud
4. Choose personas:
   - Use default 3
   - Override with another set of exactly 3 for this session
5. Paste issue URL or type freeform task
6. Confirm and launch

Then the system runs autonomously.

### Example interactive flow
```text
Start new session
Session name: fix-auth-timeout
Branch name: hydraz/fix-auth-timeout
Execution target: Cloud

Default swarm:
- Architect
- Implementer
- Verifier

Use defaults? [Y/n]

Task:
https://linear.app/acme/issue/ENG-482/fix-auth-timeout-regression
```

## 8.3 Attach flow
When multiple sessions exist, the user should be able to attach to one.

Hydraz should show:
- session name
- branch name
- execution target
- state
- last event timestamp

Example:

```text
Active sessions:
- fix-auth-timeout      -> hydraz/fix-auth-timeout   [Verifying]
- eng-482-retry-bug     -> hydraz/eng-482-retry-bug  [Implementing]
- starcraft-sim-ladder  -> hydraz/starcraft-sim      [Blocked]
```

## 8.4 Non-interactive invocation
Hydraz should still support direct invocation for power users and automation.

Example:
```bash
hydraz run --session fix-auth-timeout --branch hydraz/fix-auth-timeout --cloud "https://linear.app/acme/issue/ENG-482/fix-this"
```

This is important for scriptability and future integration.

---

## 9. Session Model

## 9.1 Session definition
A Hydraz session is the primary unit of work.

A session owns:
- a repo
- a task
- a workspace
- a branch lane
- a persona set (exactly 3)
- Claude Code runtime/process identity
- state/history/events
- artifacts

## 9.2 Session naming
Sessions must have unique names within a repo.

The user must be able to:
- name sessions manually
- reuse or duplicate patterns sensibly
- clearly distinguish multiple concurrent efforts

This is non-negotiable.

## 9.3 Branch naming
Each session should map to one primary branch.

The user must be able to:
- accept a suggested branch name
- override/edit that branch name
- deliberately control naming conventions

Suggested defaults:
- `hydraz/<session-name>`
- or `hydraz/<ticket>-<slug>`

If a collision occurs:
- prompt to attach
- prompt to fork a new session
- prompt to rename

## 9.4 Session states
The v1 state machine:

- `created`
- `starting`
- `planning`
- `implementing`
- `verifying`
- `completed`
- `blocked` (agent self-reported blocker)
- `stopped` (user action)
- `failed` (crash/error)

`queued` was dropped for v1 (no queue system). `paused` was dropped — interrupted sessions stay in their last active state and `hydraz resume` picks up.

Terminal states `stopped`, `blocked`, and `failed` have a single valid transition back to `created` (used by `hydraz resume`). `completed` has no outgoing transitions. `resumeSession` uses `transitionState` (not direct mutation), checks `RESUMABLE_STATES`, and rejects active or completed sessions.

The CLI exposes these through `status` and `events`.

---

## 10. What the Engineer Actually Does

This section is critical because the intended devex should be simple and discrete.

## 10.1 New task workflow
1. `cd` into repo
2. run `hydraz`
3. choose **Start new session**
4. enter a session name
5. accept/edit the branch name
6. choose local or cloud
7. accept default personas or override for this session
8. paste a Linear issue URL or type freeform task
9. hit Enter
10. get coffee

That is the intended primary loop.

## 10.2 Resume task workflow
1. `cd` into repo
2. run `hydraz`
3. choose **Attach to existing session**
4. inspect status
5. review or resume as needed

## 10.3 Review workflow
1. `cd` into repo
2. run `hydraz review`
3. inspect:
   - summary
   - branch
   - checks
   - blockers
   - suggested PR content

The engineer should not need to reconstruct what happened from raw text spew.

---

## 11. Autonomous Swarm Behavior

## 11.1 User expectation
Hydraz must support meaty, project-level tasks, not only tiny edits.

Examples of in-scope style:
- "fix this Linear issue"
- "build an app where LLMs play StarCraft against each other and humans provide a strategy prompt"
- medium-to-large engineering tasks that require planning, tool usage, iteration, and validation

The user expects the swarm to have real autonomy.

## 11.2 What autonomy means here
Hydraz should autonomously:
- ingest task context
- inspect the repository
- identify needed tools
- decide on a workflow
- coordinate the 3 personas
- create/edit files
- run commands/tests/builds
- self-review and verify
- stop only when:
  - completed
  - blocked
  - explicitly stopped
  - unrecoverably failed

## 11.3 What autonomy does not mean
It does not mean infinite hidden magic.

Hydraz still needs:
- visible state
- structured events
- deterministic session metadata
- reviewable outputs
- branch ownership clarity

## 11.4 How autonomy is implemented
Hydraz should achieve autonomy by:
- assembling the right prompt/context/persona inputs
- launching a single Claude Code process per session
- coordinating the three-persona workflow through phase-based persona application within that single process
- handling workspace/session/branch lifecycle around Claude Code execution

### Single-process model
Hydraz v1 uses one Claude Code process per session, not three separate processes.

The three personas are applied through the prompt architecture: the master system prompt defines the coordination contract, and persona prompts instruct Claude Code to adopt each persona's role at the appropriate phase (e.g. Architect during planning, Implementer during coding, Verifier during verification).

This is a deliberate v1 choice that optimizes for:
- lower cost (one process, not three)
- simpler coordination (no IPC, no context-sharing protocol)
- the master prompt already defines the workflow contract and phase transitions

Running separate processes per persona may be explored in a future version if the single-process model proves insufficient, but it is not the v1 design.

This is not a "three humans in a chat room" simulation. It is a managed operator loop around a single Claude Code execution with structured phase-based persona switching.

---

## 12. Persona Model

## 12.1 Strict three-persona design
Hydraz v1 should require exactly 3 personas per session.

No more, no fewer.

This is a product choice, not a backend limitation.

## 12.2 Built-in personas
Ship with 6 built-in persona prompts.

The exact six can evolve, but a plausible starter set is:

1. Architect
2. Implementer
3. Verifier
4. Skeptic
5. Product-minded Generalist
6. Performance / Reliability Engineer

The user selects 3 as their global default swarm.

## 12.3 User-selected default swarm
Users should configure a global default set of 3 personas.

That default is used automatically for new sessions unless overridden.

## 12.4 Session-level override
When starting a session, the user may override the default set and pick another exact set of 3 for that session only.

This should happen in the new-session flow.

## 12.5 Custom personas
Users should be able to:
- add custom personas
- edit custom personas
- remove custom personas
- include custom personas in their selected 3

Custom personas are user-owned content.

## 12.6 What belongs in a persona
A persona should define role-specific behavior, not the whole swarm contract.

Examples:
- Architect: decomposes tasks, sequences work, identifies risks
- Implementer: makes pragmatic code changes, executes steps
- Verifier: tries to break assumptions and confirm acceptance criteria
- Skeptic: challenges weak reasoning
- Product-minded Generalist: keeps user/product intent in view
- Performance / Reliability Engineer: focuses on latency, scalability, failure modes

---

## 13. Prompt Architecture

This is a critical design area.

Hydraz should not be built as a loose pile of prompt text. The prompt system should have clean layers.

## 13.1 Three prompt layers

### Layer 1: Hydraz core prompt
This is the global framework policy prompt.

It explains:
- what the swarm is
- how the 3 agents coordinate
- expected workflow
- expected artifacts
- how to use tools
- how to handle uncertainty
- how to converge on a final result
- when to stop or escalate
- workspace/branch discipline
- event/reporting expectations
- how Claude Code should be used under the hood

This is the "master system prompt."

### Layer 2: Persona prompt
Each chosen persona contributes role-specific instructions.

Persona prompts refine the behavior of the 3 agents without redefining the framework itself.

### Layer 3: Task prompt
This is:
- the Linear issue
- the freeform task
- any user-supplied instructions for the specific session

## 13.2 Master system prompt editability
Users should be able to:
- view the master prompt
- edit the global master prompt
- reset it to Hydraz default

But:
- this should live under `hydraz config`
- it should not be per-session
- it should not be part of the normal everyday flow

### Product rationale
If many users feel they need to edit the master prompt, that is a sign the CLI is not properly emulating competent generalist engineers. That is considered a product smell.

## 13.3 Process rigidity
Hydraz should have a prescribed internal process.

Not because the user needs to see or manage it manually, but because persona-driven swarms need a real coordination contract or they degrade into gimmickry.

Therefore the system must define:
- swarm roles
- handoff logic
- convergence behavior
- verification expectations
- artifact outputs
- stopping conditions

This should be enforced by both:
- system prompt design
- controller/orchestrator behavior

---

## 14. MCP Support

## 14.1 MCP is first-class
Hydraz must support MCP configuration.

This includes the ability to:
- list configured servers
- add a server
- remove a server
- enable/disable a server
- scope a server globally or per repo
- test connectivity

## 14.2 Relationship to Claude Code
Because Claude Code is the default execution backend, Hydraz's MCP handling should be designed to integrate with Claude Code's MCP ecosystem rather than reinvent it unnecessarily.

Hydraz should manage:
- user-facing config
- scope resolution
- session/workspace propagation
- visibility and validation

Claude Code should remain the underlying tool consumer.

## 14.3 CLI surface
```bash
hydraz mcp
```

Should present something like:

```text
Configured MCP servers:
- github
- linear
- playwright
- postgres-readonly

Actions:
1. Add server
2. Remove server
3. Enable/disable
4. Test server
5. Set scope
```

## 14.4 Scope model
Hydraz should support at least:
- global MCP config
- repo-level MCP config

Global config is appropriate for:
- common personal tools
- user-wide defaults

Repo-level config is appropriate for:
- repo-specific tools
- recommended or required integrations
- scoped capabilities

## 14.5 Rationale
MCP is part of the tool capability layer, not the persona layer and not the master prompt layer.

This separation keeps the design clean:
- personas = behavior
- master prompt = policy
- MCP = available tools

---

## 15. Why `logs` Was Rejected

A generic `logs` command was deemed too overloaded because it could ambiguously refer to:
- framework logs
- raw LLM transcripts
- app logs
- test logs
- tool logs
- Claude Code output streams
- arbitrarily large output streams

That would create both UX ambiguity and operational risk.

### Instead use:
- `hydraz status`
- `hydraz review`
- `hydraz events`

### Optional later:
- `hydraz trace` for explicit deep debugging of framework internals only

### Retention policy guidance
Always keep:
- framework events
- summaries/reports/artifacts

Optionally keep:
- raw transcripts
- test logs
- app logs
- Claude Code raw output

Prefer:
- keep detailed logs only when tied to failure or explicitly requested
- avoid default firehose storage

This is important because some project/task combinations can easily generate massive log volume.

---

## 16. Local and Cloud Execution

## 16.1 Both should exist in v1
Hydraz should support both local and cloud execution from the first implementation.

But:
- local should be the default onboarding path
- cloud should be the default escalation path for heavier tasks
- cloud complexity should not be required for initial setup

## 16.2 Same model, different target
The user should experience the same task submission model whether they choose local or cloud.

Example:
```bash
hydraz run --local "fix this"
hydraz run --cloud "fix this"
```

Or via the interactive flow.

## 16.3 Why this matters
The whole point is:
- one repo contract
- one workflow
- one operator model
- interchangeable execution target

Hydraz should not feel like two different products.

## 16.4 The executor backend must work in both
Hydraz's local/cloud abstraction is not just about workspace creation. It must also ensure the coding executor backend is:
- installed
- authenticated
- configured
- runnable

in both target types.

---

## 17. Environment Model

## 17.1 Dev workstation container model
The Hydraz container is a general-purpose developer workstation, not an application container. It mirrors the developer's local machine. Repo-specific application containers (e.g. from `docker-compose.yml`) are the agent's responsibility, not Hydraz's. See Phase 14 for full details.

## 17.2 Recommended layering
- `.devcontainer/devcontainer.json` = dev workstation environment definition (open standard)
- DevPod = workspace launcher (local Docker or cloud provider)
- Hydraz = task/session/orchestration layer
- coding executor backend = runs inside the container

## 17.3 Why this is good
It lets Hydraz focus on:
- session isolation
- workflow orchestration
- workspace lifecycle

While the agent handles repo-specific concerns (starting services, running builds, etc.) the same way a developer would.

## 17.4 Container requirements
A Hydraz dev workstation container should, at minimum, provide:
- git
- Docker (for the agent to run repo-specific containers)
- the coding executor backend (Claude Code CLI by default)
- Node.js and common development tools
- any required MCP-related config or mounts
- injected auth/config necessary for Claude Code to run headlessly if needed

---

## 18. Config Model

Hydraz should support at least two config scopes:

## 18.1 Global config
Stored in the user config directory.

Should include:
- default execution target
- selected default 3 personas
- custom personas
- master swarm prompt
- global MCP servers
- branch naming defaults
- retention settings
- provider preferences
- executor backend auth mode (Claude Code OAuth or API key for v1)
- executor backend auth secret references/config
- executor backend install/config expectations

Example location:
- macOS/Linux: `~/.config/hydraz/`
- platform-appropriate equivalent elsewhere

## 18.2 Repo config
Stored in the repository.

Should include:
- recommended MCP servers
- repo-specific branch naming conventions
- repo-specific tool allowances/denials
- repo metadata helpful for workspace creation
- later: repo-specific defaults if truly needed

## 18.3 Session metadata
Stored per repo/session.

Should include:
- session id
- session name
- repo root
- branch name
- selected personas
- execution target
- task input
- current state
- timestamps
- event log pointer/index
- artifact locations
- workspace identifier
- provider metadata
- Claude Code process/runtime metadata
- retry/resume metadata

---

## 19. Proposed File/Data Layout

This is a suggested starting point, not a final locked contract.

### Global
```text
~/.config/hydraz/
  config.json
  master-prompt.md
  personas/
    architect.md
    implementer.md
    verifier.md
    skeptic.md
    product-generalist.md
    performance-reliability.md
    custom-foo.md
  mcp/
    servers.json
```

### Per-repo session data (under ~/.hydraz/)
```text
~/.hydraz/
  repos/
    <reponame>-<hash>/
      sessions/
        <session-id>/
          session.json
          events.jsonl
          artifacts/
            intake.md
            plan.md
            implementation-summary.md
            verification-report.md
            pr-draft.md
      workspaces/
        <session-id>/
          (git worktree checkout)
```

No Hydraz-generated files are placed in the target repository.

### Notes
- JSONL for events (confirmed as the v1 format) because it streams and appends well
- Markdown artifacts are friendly to humans and agents
- Session state is stored under `~/.hydraz/repos/` (not in the target repo)
- Sensitive auth secrets should **not** be stored in repo-local state

### Target repo policy
No Hydraz-generated files are placed in target repos. All session data, worktrees, and workspace state live under `~/.hydraz/repos/`. No `.gitignore` entries are needed in target repos.

---

## 20. Architecture Concept

## 20.1 Major layers

### Layer A: CLI shell / UX layer
Responsible for:
- interactive menus
- prompts
- status views
- user commands
- rendering session lists
- surfacing events/review summaries

### Layer B: Command/application layer
Responsible for:
- command parsing
- config loading
- session creation/attachment
- provider selection
- orchestration initiation
- artifact/event management

### Layer C: Session/orchestration layer
Responsible for:
- managing the session lifecycle
- spawning/resuming work
- coordinating the 3-agent swarm
- checkpointing
- retries/resume behavior
- mapping workflow state to events

### Layer D: Workspace/provider layer
Responsible for:
- local/cloud target abstraction
- workspace creation/resume/destruction
- environment preparation
- repo mounting or checkout
- branch/session workspace identity
- executor backend install/auth propagation

### Layer E: Executor backend layer
Responsible for:
- invoking the coding executor backend
- supervising executor process lifecycles
- assembling prompt/context handoff
- bridging session state to executor execution
- capturing meaningful outputs/artifacts
- mapping executor activity into Hydraz events

### Layer F: Storage/state layer
Responsible for:
- config
- session metadata
- events
- artifacts
- retention policy

## 20.2 Important architectural rule
Hydraz should isolate the executor backend integration behind a clear adapter boundary.

That way:
- the rest of Hydraz speaks in session/orchestration concepts
- backend-specific invocation details are centralized
- auth/config/env propagation is easier to reason about
- swapping or adding executor backends is straightforward

---

## 21. Events Model

Events are important and deliberately first-class.

## 21.1 Purpose
Events should be:
- lightweight
- human-readable
- machine-parseable
- suitable for future webhooks/integrations

## 21.2 Example event types
- `session.created`
- `session.attached`
- `workspace.created`
- `workspace.resumed`
- `branch.created`
- `branch.checked_out`
- `claude.ready`
- `claude.auth_resolved`
- `swarm.started`
- `swarm.phase_changed`
- `artifact.created`
- `verification.failed`
- `verification.passed`
- `session.blocked`
- `session.completed`
- `session.failed`
- `session.stopped`

## 21.3 Example event schema
```json
{
  "timestamp": "2026-03-23T18:00:00Z",
  "sessionId": "sess_123",
  "type": "swarm.phase_changed",
  "state": "verifying",
  "message": "Verification phase started",
  "metadata": {
    "branch": "hydraz/fix-auth-timeout"
  }
}
```

## 21.4 Why events matter
Events provide:
- compact visibility
- debuggability without log floods
- future integration points for webhooks or dashboards
- a clean abstraction for status displays

---

## 22. Review Output Expectations

`hydraz review` should be one of the most polished outputs in the product.

It should summarize:
- session name
- branch name
- execution target
- selected personas
- task summary
- files changed
- checks run
- check outcomes
- blockers/questions
- confidence / readiness
- PR draft summary
- Claude Code auth mode used (summarized, non-sensitive)

This is what most engineers will care about after submission.

Hydraz should feel like it returns something reviewable, not merely "some stuff happened."

---

## 23. Detailed Implementation Plan

This section is written for an implementation agent.

## Phase 0: Foundation decisions [DONE]
1. Create repo for Hydraz CLI
2. Initial tech stack (resolved):
   - Node.js / TypeScript
   - npm as package manager
   - Inquirer (`@inquirer/prompts`) for interactive prompts and wizard flows
   - Commander for CLI command parsing and routing
   - Vitest as test runner
3. Define code organization
4. Establish release/build path with future Homebrew packaging in mind
5. Decide config storage utilities and cross-platform path handling

### Deliverables
- repo initialized
- TypeScript build pipeline
- lint/test setup (Vitest as the test runner)
- packaging skeleton
- initial README with product intent

## Phase 1: CLI shell and basic command framework [DONE]
Implement the public command surface with stubs:

- `hydraz`
- `hydraz config`
- `hydraz run`
- `hydraz attach`
- `hydraz sessions`
- `hydraz status`
- `hydraz review`
- `hydraz resume`
- `hydraz stop`
- `hydraz events`
- `hydraz personas`
- `hydraz mcp`

### Requirements
- running `hydraz` from repo root launches interactive shell
- commands resolve current repo
- if not in repo, produce clear guidance
- each command should have well-defined help text

### Deliverables
- CLI skeleton with navigation
- repo detection
- command routing
- interactive top-level menu

## Phase 2: Config system [DONE]
Implement global config and file layout.

### Needs
- initialize config directory
- store/load config JSON
- store/load master prompt
- manage built-in and custom personas
- manage MCP configuration
- branch naming defaults
- execution target default
- Claude Code auth mode selection
- Claude Code auth secret reference/config storage
- Claude Code presence/config checks

### `hydraz config`
Should support at least:
- viewing current config summary
- editing default execution target
- editing default personas
- viewing/editing/resetting master prompt
- setting Claude auth mode
- setting OAuth-token-based config for headless Max/Pro usage
- setting API-key-based config if desired
- validating Claude Code availability

### Deliverables
- config loader/saver
- schema validation
- built-in persona install/seed process
- master prompt file handling
- interactive config screens
- auth-config management
- Claude Code health checks

## Phase 3: Persona management [DONE]
Implement persona storage and selection.

### Needs
- 6 seeded built-in persona prompts
- global default swarm selection (exactly 3)
- session-level override
- add/edit/remove custom personas
- built-in vs custom distinction in UI

### Validation rules
- exactly 3 selected for defaults
- exactly 3 selected for a session
- prevent invalid states
- preserve custom persona content cleanly

### Deliverables
- `hydraz personas` UX
- persona file model
- selection/validation logic
- session-time persona override flow

## Phase 4: Session model and local state [DONE]
Implement the session state system (stored under `~/.hydraz/repos/`).

### Needs
- session creation
- unique session naming checks
- branch naming checks
- session listing
- attach/resume mechanics
- session metadata persistence
- event log file
- artifact directory structure

### Deliverables
- `.hydraz/` layout creation
- session metadata schema
- event append/read path
- attach/new session flows
- `hydraz sessions`
- `hydraz status`
- `hydraz events`

## Phase 5: Workspace/provider abstraction [DONE]
Implement a provider abstraction without overcomplicating v1.

### Needs
- define local vs cloud execution interfaces
- local provider implementation first
- cloud provider shape second
- workspace identity attached to session
- branch/workspace association rules
- Claude Code install/auth propagation hooks
- secret injection strategy for headless auth

### Important
The user should select local/cloud in the same workflow. The orchestration layer should not care excessively about which provider is underneath.

### Deliverables
- provider interface
- local provider
- cloud provider (DevPod abstracts local vs cloud; no separate implementation needed)
- create/resume workspace hooks
- workspace events
- Claude auth propagation path

## Phase 6: Prompt assembly system [DONE]
Implement the prompt composition model.

### Needs
- load Hydraz core prompt
- load three selected persona prompts
- ingest task input
- construct final swarm prompt package
- clearly separate framework policy vs persona vs task data

### Deliverables
- prompt builder module
- prompt source tracking
- prompt reset/update behavior
- config integration for master prompt edits

## Phase 7: Claude Code executor integration [DONE]
Integrate Claude Code as the execution backend.

### Needs
- create an adapter/executor boundary so the rest of Hydraz does not depend on raw CLI invocation details everywhere
- verify Claude Code availability in the workspace
- resolve auth mode for the session
- inject env/config/secrets appropriately
- submit task and environment context
- support autonomous operation
- route major lifecycle milestones to events
- capture useful artifacts
- respect persona selection and prompt assembly

### Deliverables
- Claude executor interface/module
- process-launch supervision
- auth-resolution logic
- task submission path
- state mapping from Claude execution to Hydraz session states

## Phase 8: Autonomous workflow controller [DONE]
Implement the internal session workflow that the user does not manually drive.

### Core expectations
Hydraz should:
1. create/resume workspace
2. create/checkout session branch
3. resolve Claude Code auth/config
4. ingest task
5. initialize swarm
6. run autonomously
7. produce artifacts
8. surface events/state

### Deliverables
- controller loop
- checkpointing
- blocked/failure/completion transitions
- resume handling
- stop handling

## Phase 9: Review surfaces [DONE]
Implement polished human-facing outputs.

### `hydraz review`
Should summarize:
- task
- branch
- personas
- files changed
- checks
- outcomes
- blockers
- suggested PR text
- auth mode used (non-sensitive)
- execution target

### `hydraz status`
Should be short and friendly.

### `hydraz events`
Should be compact and structured.

### Deliverables
- review renderer
- status renderer
- events renderer
- artifact summarization logic

## Phase 10: MCP management [DONE]
Implement MCP configuration management.

### Needs
- global MCP registry in config
- repo-level MCP metadata
- add/remove/enable/disable/test flows
- scope handling
- propagation into Claude Code execution environment

### Deliverables
- `hydraz mcp` UX
- MCP config schema
- connectivity test path
- merge logic for global + repo scope

## Phase 11: Packaging and install path [DONE]
Make the CLI installable and ready for public distribution.

npm is the primary distribution channel (`npm install -g hydraz`). Node is already a prerequisite, every target user has npm, and the `package.json` is already configured with `bin`, `files`, and `main` fields. Homebrew is a future secondary channel for macOS-native feel.

### Needs
- package metadata
- versioning
- build/release artifacts
- install docs
- npm publish pipeline
- Homebrew-forward-compatible packaging layout (future)

### Deliverables
- npm publish flow (primary)
- install instructions for npm
- draft Homebrew formula strategy (future)
- versioning and release automation

## Phase 12: Move session/workspace data out of target repos [DONE]
Move all Hydraz-generated state (sessions, worktrees, events, artifacts) out of the target repo's `.hydraz/` directory and into `~/.hydraz/`, keyed by repo path. This eliminates the need for `.gitignore` entries in target repos and avoids polluting the working tree.

### Needs
- relocate session storage from `<repo>/.hydraz/sessions/` to `~/.hydraz/repos/<repo-hash>/sessions/`
- relocate worktrees from `<repo>/.hydraz/workspaces/` to `~/.hydraz/repos/<repo-hash>/workspaces/`
- repo config (`.hydraz/repo.json`) may remain in-repo if committable, or move to global config keyed by repo path
- update all path resolution logic
- migrate or ignore existing `.hydraz/` data

### Deliverables
- updated path resolution
- session/worktree relocation
- no `.hydraz/` pollution in target repos
- backward compatibility or clean migration

## Phase 13: CI and PR checks [DONE]
Add GitHub Actions CI so tests and type-checking run automatically on every PR and push to `main`/`dev`. The codebase has 419+ tests but no automation enforcing they pass before merge.

### Needs
- GitHub Actions workflow for PR checks
- run `npm test` (Vitest)
- run `npm run typecheck` (tsc --noEmit)
- run on push to `main` and `dev`, and on all PRs
- fail the PR if tests or type-check fail
- pinned to Node 22 (no matrix — forward-compat over breadth)
- CI status badge in README

### Deliverables
- `.github/workflows/ci.yml` — single job: checkout → setup-node 22 → npm ci → typecheck → test
- CI badge at top of `README.md`

### Note
This phase is intentionally minimal. Linting, coverage thresholds, and release automation can be added incrementally later.

## Phase 14: Local container execution [DONE]
Add container support to local mode so agents operate in isolated Docker environments. This is required before cloud execution because the full pipeline (worktree + container + Claude Code + env isolation) must be proven locally first. Cloud is the same model with a different host.

### Container model
The container is **not** a Hydraz-provided image. Each target repo owns its own `.devcontainer/devcontainer.json` per the open [Dev Container specification](https://containers.dev/). Hydraz does not provide a default container definition — it uses whatever the repo defines.

If a repo does not have a `.devcontainer/devcontainer.json`, container mode is unavailable for that repo. Hydraz should fail with a clear error: "Container mode requires a `.devcontainer/devcontainer.json` in the target repo."

Repo-specific application containers (e.g. from `docker-compose.yml`) are the agent's responsibility, not Hydraz's. Just as a developer would run `docker compose up` locally when needed, the agent starts whatever services the task requires inside the container. Hydraz does not attempt to detect, parse, or manage repo Dockerfiles.

The only hard requirement Hydraz places on the devcontainer is that Claude Code CLI must be callable inside it. Hydraz validates this post-launch and fails with a clear error if `claude` is not found.

### `.worktreeinclude` and environment files
Hydraz supports the `.worktreeinclude` convention — a community standard used by Claude Code (desktop and CLI), Roo Code, and the standalone `git-worktreeinclude` CLI. A `.worktreeinclude` file at the repo root lists gitignored files (like `.env`) that should be copied into new worktrees.

Hydraz implements this independently because Hydraz creates worktrees itself (via `git worktree add`), so Claude Code's native `.worktreeinclude` handling never fires. Hydraz's `copyWorktreeIncludes` runs during worktree creation and copies listed files from the main checkout into the new worktree.

For security, Hydraz treats `.worktreeinclude` as a fail-closed allowlist of regular files. If any listed entry resolves to a symlink, Hydraz aborts worktree setup rather than dereferencing it into the new worktree.

This is critical for container mode: the worktree is mounted into the DevPod container, so files copied by `.worktreeinclude` (e.g. `.env` files) are available inside the container at `/workspaces/<name>/`. Without this, the agent would have no access to repo env files inside the container.

### Docker access inside containers
For local container mode, the host Docker socket is mounted into the container (socket mount, not Docker-in-Docker). This is the devcontainer ecosystem default for local dev — simple, performant, and well-supported.

For cloud mode, Docker-in-Docker is used instead (no host socket to share on a remote VM). The agent code doesn't care which mechanism is in play — it just runs `docker` commands either way.

### DevPod as workspace abstraction
DevPod is the workspace launcher abstraction for both local and cloud execution:
- **Local:** DevPod with Docker provider (container runs on your machine)
- **Cloud:** DevPod with a cloud provider such as GCP (same container, remote host)
- **Same `devcontainer.json`** for both — one definition, any provider

DevPod is free and open source (MPL-2.0, no license conflict with Hydraz's MIT). You only pay for cloud compute. Hydraz talks to DevPod, DevPod talks to the infrastructure. One integration, any provider.

### Proven DevPod mechanics (verified)
The following were verified manually against DevPod v0.6.15 with Docker provider (OrbStack):

- **`devpod up <local-dir> --ide none`** — creates and starts a workspace from a local directory's devcontainer.json. First run ~30s (image build + feature install). Subsequent runs faster (cached image).
- **Repo files mounted at `/workspaces/<workspace-name>/`** — DevPod copies/mounts the repo contents into the container at this path automatically.
- **devcontainer features** — standard features (e.g. `ghcr.io/devcontainers/features/node`, `ghcr.io/devcontainers/features/git`) install correctly during image build.
- **`containerEnv` in devcontainer.json** — environment variables defined in `containerEnv` are available inside the container. (Auth injection uses an SSH stdin launch script instead, for cloud compatibility and to avoid temp auth files.)
- **`ssh <workspace>.devpod "command"`** — executes a command inside the container via SSH. Clean exit, proper stdout. This is the programmatic exec interface Hydraz will use.
- **`devpod ssh --command`** — also works but produces a spurious "Error tunneling to container" message on exit. Use raw SSH instead.
- **`devpod delete <workspace>`** — clean teardown, removes container.

### Execution target model
The `executionTarget` type expands from `'local' | 'cloud'` to `'local' | 'local-container' | 'cloud'`:
- **`local`** — bare metal, current behavior (worktree + spawn `claude` on host)
- **`local-container`** — Docker on your machine via DevPod with Docker provider (container + worktree inside container + exec `claude` inside container via SSH)
- **`cloud`** — same container model, same `LocalContainerProvider`, remote host via DevPod with GCP provider. No separate `CloudProvider` needed — DevPod abstracts the infrastructure.

### Git lifecycle: bare metal vs container (verified)
Git worktrees use absolute paths in their `.git` file (e.g. `gitdir: /Users/josh/.hydraz/repos/.../workspaces/...`). These paths don't translate across the Docker mount boundary — a worktree created on the host has broken git state inside the container. This is a known unresolved issue in both `devcontainers/cli` (issue #796) and DevPod (issues #512, #1597).

The solution: **all git operations in container mode happen inside the container, not on the host.** This creates two distinct git strategies:

- **Bare metal (`local`):** Hydraz creates worktrees on the host via `git worktree add`. All file and git operations happen on the host filesystem. This is the existing behavior.
- **Container (`local-container` and `cloud`):** Hydraz mounts the main repo root into the container via DevPod, then creates the worktree inside the container via SSH at `/tmp/hydraz-worktrees/<session-id>` (outside the mounted repo root to avoid host filesystem pollution). All git operations (worktree creation, branch management, commit, push) happen container-side. The host orchestrates via SSH but never touches git state for container sessions.

This divergence is correct and intentional. Container mode (both local-container and cloud) shares one git strategy; bare metal has another. The container strategy works identically for cloud — proven end-to-end on GCP with zero code changes from local container mode.

### Architecture: where container lifecycle sits
A `LocalContainerProvider` implements the existing `WorkspaceProvider` interface:
1. Starts a DevPod workspace with the **main repo root** as the source (`devpod up <repo-root> --ide none`)
2. SSHs into the container and creates the git worktree (`git worktree add -b <branch> <path>`)
3. Host-side prevalidates `.worktreeinclude` entries, rejecting symlinks before any container-side copy
4. SSHs into the container and copies `.worktreeinclude` files from the mounted repo root into the worktree
5. Returns a `WorkspaceInfo` with the container-internal worktree path
6. `destroyWorkspace` removes the worktree inside the container (via SSH), then calls `devpod delete`

### Architecture: how Claude executes inside the container
The executor spawns Claude Code CLI inside the container via SSH rather than on the host:
- Instead of `spawn('claude', args, { cwd: workingDirectory })`, the executor runs `ssh <workspace>.devpod sh -s` and streams a short launch script over SSH stdin that `cd`s into the worktree, exports any auth env vars in-memory, and `exec`s `claude <args>`
- The controller passes an execution context to the executor indicating whether to run locally or via SSH
- Streaming output works the same way — stdout from the SSH process is the stream-json output from Claude

### Auth inside containers (verified)
Claude Code CLI respects the **`CLAUDE_CODE_OAUTH_TOKEN`** environment variable for headless authentication. The full flow:

1. **One-time setup (on a machine with a browser):** user runs `claude setup-token` to generate a long-lived OAuth token (valid 1 year, requires Claude Pro or Max subscription)
2. **Hydraz config:** user provides the token to `hydraz config`, which stores it securely
3. **Container launch:** Hydraz streams a shell script to the container over SSH stdin. That script exports `CLAUDE_CODE_OAUTH_TOKEN` in-memory and immediately `exec`s Claude in the target worktree. No temp auth file is created inside the container, and the token never appears on the host filesystem.
4. **Onboarding bypass:** the container also needs a `~/.claude.json` with `"hasCompletedOnboarding": true` to skip the interactive onboarding wizard. Hydraz handles this as a post-launch setup step.

Note: there are known upstream issues with OAuth in headless/container environments (claude-code issues #29983, #30096). These are Claude Code bugs, not a Hydraz design problem, but worth monitoring.

### Model selection
Hydraz v1 hardcodes `--model claude-opus-4-6` for all Claude Code sessions. This is an opinionated product decision — Hydraz uses the best available model. Configurable model selection is deferred until there's a real use case driving it.

### Prerequisites for container mode
- Docker (or OrbStack) running on the host
- DevPod CLI installed (`devpod version` to verify)
- Target repo has a `.devcontainer/devcontainer.json`
- Target repo has a git remote configured — container mode delivers work via push to remote. Repos without a remote are rejected with a clear error. For the initial beta, automated push/PR delivery is GitHub-only: `origin` must point at `github.com`.
- Claude Code CLI available inside the container (repo's devcontainer responsibility)

### Container setup steps (automatic)
After launching the DevPod workspace, Hydraz automatically:
1. Verifies Claude Code CLI is callable inside the container
2. Creates a git worktree at `/tmp/hydraz-worktrees/<session-id>`
3. Revalidates and copies `.worktreeinclude` files into the worktree (symlink entries fail setup)
4. Injects Claude auth via SSH for the remote `claude` invocation

### Needs
- `LocalContainerProvider` implementing `WorkspaceProvider`
- DevPod lifecycle integration (`devpod up`, `devpod delete`)
- SSH-based command execution for running Claude inside containers
- Auth token injection via container environment variables
- Validation: devcontainer.json exists, Claude Code callable post-launch
- Execution target expansion to include `local-container`

### Important
The full local pipeline must work end-to-end before cloud is attempted. Cloud is just "same thing, different host." Local containers prove the container model works; cloud adds remote orchestration on top.

### Deliverables
- `LocalContainerProvider` with DevPod integration
- SSH-based executor path for container mode
- Container env var auth injection
- Pre-flight validation (devcontainer.json exists, Docker running, DevPod available)
- Post-launch validation (Claude Code callable inside container)
- Execution target type expansion (`local-container`)

## Phase 15: Cloud container execution [DONE]
Add cloud execution via DevPod with a GCP provider. This is the same container model proven in Phase 14 (local containers), running on a remote host instead of local Docker.

The spec has stated since the beginning: "Support both local and cloud execution" (secondary product goal #1). Phase 14 proved the container model locally. Phase 15 proves it in the cloud.

### Key finding: no separate CloudProvider needed (verified)
The full Hydraz cloud pipeline was proven end-to-end on GCP with **zero code changes** from the local container implementation. The `LocalContainerProvider` works identically on GCP — DevPod abstracts the infrastructure difference completely.

What was proven:
- `devpod provider add gcloud -o PROJECT=hydraz-dev -o ZONE=us-central1-a -o MACHINE_TYPE=e2-standard-8` — one-time setup
- The active DevPod provider determines whether containers run locally (Docker) or on cloud (GCP). Hydraz never knows or cares.
- Full pipeline: auth → VM provisioning (~15s) → container build (~75s) → worktree creation → Opus 4.6 → git commit → session complete
- SSH exec works identically to local containers
- Auth injection via SSH works identically to local containers
- Worktree at `/tmp/hydraz-worktrees/` works identically to local containers

This means the `CloudProvider` stub can remain as-is or be removed. The `cloud` execution target in the CLI should route to the same `LocalContainerProvider` — the name is misleading, but the implementation is correct. The user selects local vs cloud by configuring which DevPod provider is active, not by changing Hydraz code.

### Architecture
Cloud execution reuses the container pipeline from Phase 14 exactly:
- Same `LocalContainerProvider`
- Same `devcontainer.json` per repo
- Same worktree-inside-container strategy (at `/tmp/hydraz-worktrees/`)
- Same SSH-based command execution
- Same auth token injection via SSH stdin (no temp auth file inside the container)

DevPod handles VM provisioning, Docker installation, file sync, and SSH tunneling. Hydraz talks to DevPod; DevPod talks to the infrastructure.

### GCP setup (verified)
One-time setup for cloud execution:
1. Install `gcloud` CLI and authenticate: `gcloud auth login && gcloud auth application-default login`
2. Create GCP project with Compute Engine API enabled and billing linked
3. `gcloud auth application-default set-quota-project <project-id>`
4. `devpod provider add gcloud -o PROJECT=<project-id> -o ZONE=<zone> -o MACHINE_TYPE=e2-standard-8`
5. `devpod provider use gcloud` (makes it the default)

Cost: e2-standard-8 (8 vCPUs, 32GB RAM) = ~$0.27/hr on-demand. VMs auto-stop after 10 minutes of inactivity.

### Remaining needs
- Route `cloud` execution target to `LocalContainerProvider` in the controller (or rename the execution targets)
- DevPod provider selection in Hydraz config (which provider to use: docker vs gcloud)
- GCP project/zone/machine-type configuration in `hydraz config`
- Updated README with cloud prerequisites
- DevPod workspace cleanup after sessions (see Phase 16)

### Deliverables
- `cloud` execution target wired to container pipeline
- DevPod provider configuration in Hydraz config
- GCP setup documentation
- End-to-end cloud pipeline proven manually (done)

### Important
Phase 14's local container pipeline is the foundation. Cloud is "same thing, different host." If something breaks in cloud, debug locally first.

## Phase 16: DevPod workspace cleanup and push verification [DONE]
Completed container sessions leave DevPod workspaces running on GCP (costing ~$0.27/hr). Hydraz should verify work is safely pushed before cleanup, and clean up automatically after.

### Push verification before cleanup
Container mode delivers work via push to a remote branch. If the push fails (network, auth, GitHub outage), the work only exists inside the ephemeral container. Destroying the workspace loses the work.

Hydraz must verify the branch was pushed before destroying the workspace:
- After session completion, check if the session branch exists on the remote (`git ls-remote`)
- If push succeeded: destroy the workspace
- If push failed: preserve the workspace, notify the user with recovery instructions (`devpod ssh <workspace>` to access and manually push)
- VMs auto-stop after 10 minutes of inactivity (data preserved), so preserving the workspace doesn't mean paying indefinitely

### Needs
- Push verification in the controller after session completion
- Call `devpodDelete` only after confirmed push
- Handle cleanup on session stop and session failure, not just completion
- Graceful handling when DevPod workspace is already gone
- Notify user on push failure with workspace recovery instructions
- Consider: should `hydraz clean` also clean up orphaned DevPod workspaces?

### Deliverables
- Push verification before workspace destruction
- Automatic DevPod workspace teardown after confirmed push
- Clear error messaging and recovery path for push failures
- `hydraz clean` command for manual orphan cleanup (optional for v1)
- No orphaned containers after normal session lifecycle with successful push

## Phase 17: Multi-executor backend support [DEFERRED]
Hydraz currently hardcodes Claude Code CLI as the executor. This phase extracts an `ExecutorBackend` interface so alternative backends (e.g. Codex, OpenCode) can be swapped in. Deferred until a second backend is actually needed.

### Needs
- define an `ExecutorBackend` interface with `launch()`, `stop()`, `parseStream()` methods
- implement `ClaudeCodeBackend` as the default
- the orchestration controller talks to the interface, never to Claude-specific details
- executor backend selection via config

### Deliverables
- `ExecutorBackend` interface
- `ClaudeCodeBackend` implementation (refactor of existing executor)
- config option to select backend
- documentation for implementing new backends

---

## 24. Suggested Directory Structure for the Hydraz Codebase

A plausible internal code layout:

```text
src/
  cli/
    index.ts
    commands/
      config.ts
      run.ts
      attach.ts
      sessions.ts
      status.ts
      review.ts
      resume.ts
      stop.ts
      events.ts
      personas.ts
      mcp.ts
      clean.ts
    ui/
      app.tsx
      screens/
      components/
  core/
    config/
    personas/
    prompts/
    sessions/
    events/
    artifacts/
    providers/
    claude/
    orchestration/
    repo/
    branches/
  types/
  utils/
```

This is only a suggestion, but the separation should roughly preserve:
- CLI UX
- core domain logic
- provider/runtime abstractions
- Claude-specific execution integration

---

## 25. Important Validation Rules

These should be enforced early.

### Persona rules
- exactly 3 personas in default swarm
- exactly 3 personas in session swarm
- built-ins cannot be accidentally corrupted
- custom personas clearly distinguished

### Session rules
- session names unique per repo
- branch names user-editable
- clear conflict handling
- sessions persist reliably

### Prompt rules
- master prompt is global only
- no per-session master prompt override in v1
- task prompt remains task-specific
- persona prompts remain role-specific

### Logging/event rules
- do not default to giant transcript dumps
- events remain structured and lightweight
- review/status stay human-scale

### Claude/auth rules
- the executor backend must be available before execution starts
- headless/container sessions must not rely on interactive login
- auth source must be explicit
- secrets must not leak into repo-local session state
- session should know which auth mode it used, without storing raw secrets
- stored session metadata must be bound to its containing session directory and current repo; tampered `id` or `repoRoot` values are rejected

---

## 26. Testing Strategy

### Test runner
Vitest is the test runner for all Hydraz tests.

### API-design-driven TDD
Hydraz should follow strict API-design-driven test-driven development whenever possible.

The workflow is:
1. Define the module's public API (types, function signatures, return types) before writing implementation
2. Write tests against that API surface
3. Implement until the tests pass
4. Refactor with confidence

This applies to all core domain modules: config, personas, sessions, events, prompt assembly, branch naming, validation, and the Claude executor adapter. The goal is that the API contract is settled first, tests codify the contract, and implementation follows.

When a module's behavior is ambiguous, writing the tests first is the mechanism for resolving that ambiguity — the test becomes the specification.

### Prove-it-first methodology

No assumption or hypothesis may be acted on until it is verified with evidence. This is a universal engineering discipline, not specific to any tool or domain.

The rules:
- **Never assume behavior — verify it.** Documentation, web searches, blog posts, and memory are hints, not facts. They may be outdated, wrong, or describe a different version/context. The only source of truth is running the thing and observing what happens.
- **Isolate before diagnosing.** When something doesn't work, strip away layers until the problem is reproducible in the simplest possible form. Fix what is actually broken, not what you think might be broken.
- **Hypothesize, then prove or disprove.** Form a testable hypothesis, design a minimal experiment that would confirm or falsify it, run the experiment, then act on the result. Do not skip straight from hypothesis to fix.
- **Prove the fix, not just the theory.** After fixing, verify the fix works end-to-end, not just that the theory sounds right.

#### Illustrative example from v1 development

A web search stated that `--verbose` conflicted with `--output-format stream-json` in Claude Code CLI. Based on this, `--verbose` was removed from the executor. The actual behavior of the installed version was the exact opposite: `stream-json` **requires** `--verbose`. This caused a silent spawn failure — no output, no error — and wasted significant debugging time across multiple hypotheses and attempted fixes.

The entire issue would have been caught in 5 seconds by running the proposed command in isolation before writing any code:
```
echo 'hello' | claude --print --output-format stream-json
# → Error: stream-json requires --verbose
```

### What to test

#### Unit tests (high priority from Phase 0)
- Config loading, saving, schema validation, and defaults
- Persona selection and validation rules (exactly-3 constraint, built-in vs custom)
- Session state machine transitions
- Branch naming generation and collision detection
- Prompt assembly (layer composition: master + persona + task)
- Event creation and serialization
- Artifact path resolution

#### Integration tests (from Phase 7 onward)
- Claude Code executor adapter: process launch, auth resolution, output capture
- Session lifecycle: create, attach, resume, stop
- Config + session + prompt assembly end-to-end

#### What not to test in automated tests
- Actual Claude Code execution (mock the executor boundary)
- Interactive CLI prompts (test the logic they drive, not the prompts themselves)

### Test organization
Tests should live alongside source files or in a parallel `__tests__/` structure, following Vitest conventions. The choice should be made during Phase 0 scaffold.

---

## 26b. Coding Standards

These standards apply to all code in the Hydraz codebase. They must be followed by any agent or contributor working on the project.

### Single source of truth for types and constants
Every type, interface, constant, and enum must be defined in exactly one place. Other files must import from the canonical definition — never duplicate it. If a type is used across module boundaries, it should live in the appropriate domain module (e.g. `config/schema.ts` for config types, `sessions/schema.ts` for session types) and be re-exported through barrel files as needed.

Duplicating a type definition, even if the values are identical, is a bug. When the canonical definition changes, duplicates silently drift.

### Barrel files for public module APIs
Each `src/core/<module>/` directory should have an `index.ts` that re-exports the module's public API. Consumers import from the barrel, not from internal files. Internal files may import from each other directly within the same module.

### Prove-it-first methodology
This is the most important rule in this document. It applies to everything — not just external tools, but any assertion, conclusion, diagnosis, or claim made during development.

**Never assert something as fact without evidence.** If you say "X is the default behavior," prove it. If you say "Y caused the bug," prove it. If you say "Z is a community standard," prove it. If you say "the config validation is dropping the field," verify before coding a fix. Memory, intuition, and pattern-matching are starting points for investigation, not substitutes for verification.

Specific applications:
- **External tool behavior:** CLI interfaces, APIs, env vars, file formats must be verified by actually running the tool. Never trust documentation or web search results alone.
- **Bug diagnosis:** Verify the actual cause before writing a fix. Reproduce the bug, isolate the root cause, then fix what is actually broken.
- **Community claims:** If you assert something is a standard, convention, or common practice, find evidence (docs, issues, implementations) or say "I don't know."
- **Codebase state:** If you claim "this is already handled" or "this field is preserved," verify against the actual code, not your memory of the code.

When repo tests are insufficient, manual human verification is acceptable. Document verified findings in the spec. See Section 26 for the full prove-it-first policy with a real example of why it matters.

### API-design-driven TDD
The implementation order is strict: define interfaces/types → write tests that use them (tests fail) → implement until tests pass. This is not optional or aspirational — it is the required workflow.

Tests should test behavior, not implementation details. Every atomic commit must include test additions or modifications unless the commit is purely non-functional (e.g. docs-only, spec updates, config changes). The human will run `npm test` before every commit; if tests don't pass, the commit doesn't land.

When refactoring, existing tests must continue to pass. New tests should cover the new or changed API surface.

### Phase completion gate
A phase is not complete until every item in its **Deliverables** section has been implemented and verified. Before declaring any phase done, the agent must:
1. Re-read the phase's Deliverables list from this spec
2. Verify each deliverable against the actual codebase (not memory or a personal todo list)
3. List any undelivered items explicitly
4. Only declare the phase complete when all items are confirmed delivered

This is non-negotiable. Declaring a phase complete while deliverables remain is a bug in the process, not a judgment call.

---

## 27. Open Design Questions for the Implementation Agent

### Resolved

1. **Interactive CLI library:** Inquirer (`@inquirer/prompts`) for all interactive prompts and wizard flows. This is a permanent choice, not just v1.

2. **Claude Code invocation strategy:** Direct process supervision via `claude` CLI behind an executor adapter boundary. The adapter isolates Claude-specific invocation details so the rest of Hydraz speaks in session/orchestration concepts.

3. **Cloud provider for v1:** Local execution is the fully functional v1 path, including local container support (Phase 14). Cloud execution was proven on GCP with zero code changes from the local container implementation — DevPod abstracts the infrastructure. No separate `CloudProvider` implementation is needed; `LocalContainerProvider` serves both local-container and cloud targets. The user selects local vs cloud by configuring which DevPod provider is active.

4. **Session event persistence format:** JSONL. Confirmed. Append-only, streamable, easy to tail and parse.

5. **Session data location:** All session data, worktrees, and workspace state stored under `~/.hydraz/repos/<reponame>-<hash>/`. No Hydraz-generated files in target repos.

6. **Swarm process model:** Single Claude Code process per session with phase-based persona switching. See Section 11.4 for details.

7. **Testing strategy:** Vitest as the test runner. API-design-driven TDD whenever possible. Unit tests on core domain logic from Phase 0. Integration tests on the Claude executor adapter from Phase 7. See Section 26 for details.

8. **Package manager:** npm. Chosen for maximum familiarity and vanilla toolchain.

9. **Command parsing library:** Commander. Most popular Node CLI parsing library (~50M weekly downloads), zero dependencies, strong TypeScript support. Required alongside Inquirer because they solve different problems: Commander parses CLI invocations into commands/flags/arguments; Inquirer drives interactive prompts within command handlers.

### Still open (must be resolved before or during the indicated phase)

Each question below is annotated with the phase where it becomes blocking. It must be discussed and resolved no later than the start of that phase.

1. ~~**What should the built-in six persona prompts actually be, verbatim?**~~
   **Resolved:** v1 baseline persona prompts are implemented in `src/core/config/init.ts`. Each persona prompt defines the role's perspective and responsibilities. The master system prompt handles the coordination contract; persona prompts add role-specific focus. Content will iterate based on real usage.

2. ~~**What exact artifact set is minimally necessary for v1?**~~
   **Resolved:** 5 artifacts per session: `intake.md`, `plan.md`, `implementation-summary.md`, `verification-report.md`, `pr-draft.md`. Command history excluded (too close to firehose logs; verification report captures outcomes).

3. ~~**What should stop vs pause vs blocked semantics be in v1?**~~
   **Resolved:** v1 state machine: `created` → `starting` → `planning` → `implementing` → `verifying` → `completed`. Terminal exit states: `stopped` (user action), `blocked` (agent self-reported), `failed` (crash/error). No distinct `paused` state in v1 — interrupted sessions stay in their last active state and `hydraz resume` detects and picks up. The `queued` state from the original list is dropped for v1 (no queue system yet).

4. ~~**How should session/workspace cleanup be handled after completion?**~~
   **Resolved:** For bare-metal local mode, v1 keeps worktrees on disk for review. For container mode, DevPod workspaces are destroyed after session completion once push is verified (Phase 16). Session metadata and events always persist regardless of execution mode. `hydraz clean` provides manual orphan cleanup for DevPod workspaces that weren't automatically destroyed (implemented in Phase 16).

5. ~~**What is the exact secure storage and injection strategy for Claude Max OAuth tokens across local and cloud providers?**~~
   **Resolved:** For local bare-metal execution, Claude Code manages its own auth state. For container execution (local-container and cloud), users generate a long-lived token via `claude setup-token` and store it in Hydraz config (`claudeAuth.oauthToken`). At container launch, Hydraz streams a short shell script over SSH stdin that exports `CLAUDE_CODE_OAUTH_TOKEN` in-memory and immediately `exec`s Claude in the target worktree. No temp auth file is created inside the container, and the token never appears on the host filesystem. Config file is `0600`. Implemented in Phase 14, verified on GCP in Phase 15.

6. ~~**How should Hydraz detect and report auth precedence conflicts cleanly?**~~
   **Resolved:** v1 reports the configured auth mode and validates prerequisites (e.g. `ANTHROPIC_API_KEY` is set for api-key mode). Claude Code handles its own auth precedence. Hydraz surfaces the active mode in status and review outputs.

---

## 28. Summary of the Intended Experience

Hydraz should feel like this:

An engineer stands in a repo, runs `hydraz`, starts or attaches to a session, names the session and branch, chooses local or cloud, picks or accepts a strict 3-persona swarm, pastes a task, and leaves. Behind the scenes, a strict 3-persona autonomous swarm works inside an isolated workspace, uses Claude Code CLI under the hood, uses tools and MCPs, drives its own internal workflow, and eventually returns a branch plus a crisp review surface.

That is the product.

Not:
- a prompt playground
- a manual swarm controller
- a dumping ground for giant logs
- a generic framework with no opinions

It should be:
- opinionated
- autonomous
- session-aware
- branch-aware
- workspace-aware
- Claude-Code-native
- public-package-friendly
- team-standard-friendly

And crucially, the design should preserve the branding idea that **Hydraz** evokes both many-headed coordination and volatile propulsion.

---

## 29. Immediate Next Build Step

The best next execution step for a coding agent is:

1. scaffold the CLI repo
2. implement the command surface and interactive shell
3. implement config + personas + master prompt storage
4. implement Claude auth config and health-check flows
5. implement session state under `~/.hydraz/repos/`
6. implement attach/new session flow with user-controlled session and branch naming
7. stub provider and Claude executor interfaces
8. build review/status/events surfaces before deep orchestration complexity

That order will de-risk the product fastest and make the devex tangible early.
