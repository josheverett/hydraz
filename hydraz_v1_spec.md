# Hydraz v1 Specification

## 1. Overview

Hydraz is an interactive, repo-root CLI for autonomous, persona-driven coding swarms.

The near-term goal is not to build a generic “agent platform.” The goal is to ship an opinionated developer tool that lets an engineer stand in a repository, launch a session, paste a Linear issue or freeform task, and walk away while a 3-agent swarm operates autonomously in an isolated local or cloud workspace.

Hydraz is intended to become:
- an internal engineering standard first
- a public installable CLI later
- eventually packaged for Homebrew distribution on macOS

The design should therefore optimize for:
- fast onboarding
- strong defaults
- low conceptual overhead
- clear session state
- reproducible environments
- forward compatibility with public packaging and future integrations

Hydraz should feel closer to “a real coding operator” than “a prompt runner.”

---

## 2. Product Goals

### Primary product goal
Enable an engineer to do something as simple as:

1. `cd` into a repo
2. run `hydraz`
3. choose a session or create a new one
4. paste a Linear issue URL or type a meaty freeform task
5. choose local or cloud execution
6. leave the system to work autonomously

### Secondary product goals
- Support both local and cloud execution from day one
- Standardize agent workflows across an engineering team
- Minimize branch/worktree/session chaos
- Allow opinionated persona-driven swarms without exposing complexity in normal usage
- Make the CLI interactive by default, while still supporting non-interactive scriptable invocation
- Reuse existing repository Dockerfiles where possible
- Use Claude Code CLI under the hood as the hard execution dependency
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
- Replacing Claude Code CLI with a custom code-editing engine
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

That is Hydraz’s job.

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
Hydraz should have a strong built-in “master swarm prompt” that explains:
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

### 3.7 Claude Code is the execution engine
Hydraz is not building its own autonomous code-editing model runtime.

Hydraz is:
- the operator shell
- the session manager
- the workspace manager
- the persona/prompt/config layer
- the orchestration layer
- the event/artifact layer

Claude Code CLI is:
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
- Existing repo Dockerfiles reused wherever possible
- Dev container metadata layered on top of those Dockerfiles
- DevPod or equivalent workspace launcher abstraction for local/cloud execution
- Git-aware session/branch management
- Claude Code CLI as the hard execution backend
- MCP support as a first-class tool configuration concept
- A Hydraz orchestration layer that launches and coordinates Claude Code sessions/processes

### Why Node/TypeScript
- Best fit for a polished public CLI
- Natural path to npm distribution
- Easy future path to Homebrew packaging
- Strong ecosystem for interactive CLIs
- Good interop with shell tooling and JSON/YAML-based config

### Why reuse existing Dockerfiles
The team already has Dockerfiles and related app container setup. Hydraz should not throw that away.

Instead:
- app Dockerfile = application/runtime truth
- devcontainer metadata = developer/agent workspace truth
- Hydraz = workflow/session/operator layer on top
- Claude Code CLI = coding executor inside the workspace

This avoids unnecessary re-platforming.

### Why Claude Code CLI as a hard dependency
This is a product requirement, not merely a backend preference.

Hydraz must be designed around the assumption that:
- `claude` is installed/available inside the workspace
- Hydraz launches Claude Code under the hood
- Hydraz delegates coding/tool-use behavior to Claude Code
- Hydraz layers persona coordination, session identity, and workflow on top of it

This is important for:
- compatibility with the user’s current stack
- plugin/MCP familiarity
- Claude Max plan compatibility
- alignment with existing real-world usage patterns

---

## 6. Claude Code Dependency and Auth Model

This section is critical and should be treated as hard architecture, not an implementation footnote.

## 6.1 Claude Code is a hard runtime dependency
Hydraz v1 should assume Claude Code CLI is required.

That means:
- Hydraz should verify Claude Code availability during `hydraz config`
- workspaces/containers should ensure `claude` is installed and callable
- Hydraz runtime integration should be built around launching and supervising Claude Code sessions/processes

Hydraz should not treat Claude Code as optional in v1.

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

Renamed from “bootstrap” because “config” is more natural and familiar.

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
Review-ready summary of a session’s outcome:
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
A starting v1 state machine might include:

- `created`
- `queued`
- `starting`
- `planning`
- `implementing`
- `verifying`
- `blocked`
- `paused`
- `stopped`
- `failed`
- `completed`

The CLI should expose these through `status` and `events`.

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
- “fix this Linear issue”
- “build an app where LLMs play StarCraft against each other and humans provide a strategy prompt”
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

This is not a “three humans in a chat room” simulation. It is a managed operator loop around a single Claude Code execution with structured phase-based persona switching.

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

This is the “master system prompt.”

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
Because Claude Code is the hard execution dependency, Hydraz’s MCP handling should be designed to integrate with Claude Code’s MCP ecosystem rather than reinvent it unnecessarily.

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

## 16.4 Claude Code must work in both
Hydraz’s local/cloud abstraction is not just about workspace creation. It must also ensure Claude Code is:
- installed
- authenticated
- configured
- runnable

in both target types.

---

## 17. Environment Model

## 17.1 Existing app Dockerfiles
The team already has Dockerfiles and related setup for apps.

This changes implementation details, but not the overall plan.

Hydraz should typically:
- reuse the existing Dockerfile
- layer development/workspace metadata on top
- avoid forcing a separate environment definition unless necessary

## 17.2 Recommended layering
- existing Dockerfile = application/runtime base
- devcontainer metadata = developer/agent environment metadata
- Hydraz = task/session/orchestration layer
- Claude Code CLI = coding executor inside that environment

## 17.3 Why this is good
It preserves:
- existing investment
- runtime fidelity
- app-specific setup

And lets Hydraz focus on:
- entrypoint standardization
- session isolation
- workflow orchestration

## 17.4 Container requirements
A Hydraz-compatible workspace/container should, at minimum, be able to provide:
- repo files
- required app/tool dependencies
- git
- Claude Code CLI
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
- Claude Code auth mode
- Claude Code auth secret references/config
- Claude Code install/config expectations

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

### Repo-local
```text
<repo>/
  .hydraz/
    repo.json
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
```

### Notes
- JSONL for events (confirmed as the v1 format) because it streams and appends well
- Markdown artifacts are friendly to humans and agents
- The repo-local `.hydraz/` directory is a good place for durable session state
- Sensitive auth secrets should **not** be stored in repo-local state

### Gitignore strategy
- `.hydraz/sessions/` should be gitignored — session metadata, events, and artifacts are local working state
- `.hydraz/repo.json` should **not** be gitignored — it is repo-level config (recommended MCPs, branch conventions) that may be committed and shared with the team
- Hydraz should offer to add the appropriate `.gitignore` entries during `hydraz config` or first session creation

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
- Claude Code install/auth propagation

### Layer E: Claude Code executor layer
Responsible for:
- invoking Claude Code CLI
- supervising Claude Code process lifecycles
- assembling prompt/context handoff
- bridging session state to Claude Code execution
- capturing meaningful outputs/artifacts
- mapping Claude Code activity into Hydraz events

### Layer F: Storage/state layer
Responsible for:
- config
- session metadata
- events
- artifacts
- retention policy

## 20.2 Important architectural rule
Hydraz should isolate the Claude Code integration behind a clear executor/adapter boundary.

That way:
- the rest of Hydraz speaks in session/orchestration concepts
- Claude-specific invocation details are centralized
- auth/config/env propagation is easier to reason about
- future changes to Claude Code integration are less invasive

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

Hydraz should feel like it returns something reviewable, not merely “some stuff happened.”

---

## 23. Detailed Implementation Plan

This section is written for an implementation agent.

## Phase 0: Foundation decisions
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

## Phase 1: CLI shell and basic command framework
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

## Phase 2: Config system
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

## Phase 3: Persona management
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

## Phase 4: Session model and local state
Implement the `.hydraz/` repo-local state system.

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

## Phase 5: Workspace/provider abstraction
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
- cloud provider placeholder or first implementation
- create/resume workspace hooks
- workspace events
- Claude auth propagation path

## Phase 6: Prompt assembly system
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

## Phase 7: Claude Code executor integration
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

## Phase 8: Autonomous workflow controller
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

## Phase 9: Review surfaces
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

## Phase 10: MCP management
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

## Phase 11: Packaging and install path
Make the CLI installable and ready for public packaging.

### Needs
- package metadata
- versioning
- build/release artifacts
- install docs
- Homebrew-forward-compatible packaging layout

### Deliverables
- npm-ready release flow
- tarball/binary strategy as needed
- draft Homebrew formula strategy
- install instructions

## Phase 12: Move session/workspace data out of target repos
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

## Phase 13: Local container execution
Add container support to local mode so agents operate in isolated Docker environments. This is required before cloud execution because the full pipeline (worktree + container + Claude Code + env isolation) must be proven locally first. Cloud is the same model with a different host.

### Container model
The Hydraz container is a **general-purpose developer workstation** container, not an application container. It mirrors the developer's local machine: Node, git, Claude Code CLI, Docker, and common tools are pre-installed. The container is the same for all repos.

Repo-specific application containers (e.g. from `docker-compose.yml`) are the agent's responsibility, not Hydraz's. Just as a developer would run `docker compose up` locally when needed, the agent starts whatever services the task requires inside the Hydraz container. Hydraz does not attempt to detect, parse, or manage repo Dockerfiles.

This means:
- Docker-in-Docker or Docker socket mounting so the agent can run containers inside the Hydraz container
- The worktree is mounted into the Hydraz container
- The agent operates on the filesystem inside the container, same as a developer on their laptop
- Repo Dockerfiles and compose files are the agent's tools, not Hydraz's concern

### devcontainer.json
The container definition uses the open [Dev Container specification](https://containers.dev/) via `.devcontainer/devcontainer.json` checked into each repo. This is an open standard supported by VS Code, GitHub Codespaces, DevPod, JetBrains, and others. Using the standard means the dev environment works with any compatible tool, not just Hydraz.

### DevPod as workspace abstraction
DevPod is the workspace launcher abstraction for both local and cloud execution:
- **Local:** DevPod with Docker provider (container runs on your machine)
- **Cloud:** DevPod with a cloud provider such as GCP (same container, remote host)
- **Same `devcontainer.json`** for both — one definition, any provider

DevPod is free and open source (MPL-2.0). You only pay for cloud compute. Hydraz talks to DevPod, DevPod talks to the infrastructure. One integration, any provider.

### Needs
- `.devcontainer/devcontainer.json` support per the open standard
- DevPod integration for local and cloud container lifecycle
- Docker-in-Docker or Docker socket access inside the container
- mount worktree into the container
- ensure Claude Code CLI is available and authenticated inside the container
- handle port isolation between concurrent sessions
- inject auth/env as needed for headless Claude Code execution

### Important
The full local pipeline must work end-to-end before cloud is attempted. Cloud is just "same thing, different host." Local containers prove the container model works; cloud adds remote orchestration on top.

### Deliverables
- `.devcontainer/devcontainer.json` definition for the Hydraz dev workstation
- DevPod integration in the local provider
- Docker-in-Docker or socket mounting
- Claude Code availability and auth inside containers
- port isolation between sessions
- env/secret injection into containers

## Phase 14: Multi-executor backend support
Hydraz currently hardcodes Claude Code CLI as the executor. This phase extracts an `ExecutorBackend` interface so alternative backends (e.g. Codex, OpenCode) can be swapped in.

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
- Claude Code must be available before execution starts
- headless/container sessions must not rely on interactive login
- auth source must be explicit
- secrets must not leak into repo-local session state
- session should know which auth mode it used, without storing raw secrets

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

## 27. Open Design Questions for the Implementation Agent

### Resolved

1. **Interactive CLI library:** Inquirer (`@inquirer/prompts`) for all interactive prompts and wizard flows. This is a permanent choice, not just v1.

2. **Claude Code invocation strategy:** Direct process supervision via `claude` CLI behind an executor adapter boundary. The adapter isolates Claude-specific invocation details so the rest of Hydraz speaks in session/orchestration concepts.

3. **Cloud provider for v1:** Local execution is the fully functional v1 path, including local container support (Phase 13). The full pipeline (worktree + container + Claude Code + env isolation) must be proven locally before cloud is attempted. Cloud is the same container model on a remote host. Cloud execution remains a well-defined provider interface with a stub implementation until local containers are proven.

4. **Session event persistence format:** JSONL. Confirmed. Append-only, streamable, easy to tail and parse.

5. **`.hydraz/` gitignore strategy:** `.hydraz/sessions/` is gitignored (session metadata, events, artifacts are local working state). `.hydraz/repo.json` is optionally committed (repo-level config shared with the team).

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
   **Resolved:** v1 never auto-deletes workspaces. Completed/stopped/failed sessions keep their worktree on disk for review. Session metadata and events always persist. A future `hydraz clean` command can be added for explicit cleanup.

5. ~~**What is the exact secure storage and injection strategy for Claude Max OAuth tokens across local and cloud providers?**~~
   **Resolved:** v1 does not implement its own token store. For local execution, Claude Code manages its own auth state (user logs in once via `claude`). For future container/cloud, env var injection (`CLAUDE_ACCESS_TOKEN`) is the planned path but not implemented in v1's stub cloud provider.

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
5. implement repo-local session state under `.hydraz/`
6. implement attach/new session flow with user-controlled session and branch naming
7. stub provider and Claude executor interfaces
8. build review/status/events surfaces before deep orchestration complexity

That order will de-risk the product fastest and make the devex tangible early.
