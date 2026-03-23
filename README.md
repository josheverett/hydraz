# Hydraz

An opinionated CLI for autonomous, persona-driven coding swarms.

Hydraz lets an engineer stand in a repository, launch a session, paste a task, and walk away while a strict 3-persona swarm operates autonomously in an isolated workspace — powered by Claude Code CLI under the hood.

## Quick start

```bash
npm install
npm run build
```

## Usage

```bash
# Interactive mode (from repo root)
hydraz

# Non-interactive task submission
hydraz run "fix the auth timeout regression"
hydraz run "https://linear.app/acme/issue/ENG-482/fix-auth-timeout"
```

## Development

```bash
npm test          # run tests
npm run test:watch # run tests in watch mode
npm run build      # compile TypeScript
npm run typecheck  # type-check without emitting
```

## Architecture

Hydraz is the operator shell, session manager, workspace manager, and orchestration layer. Claude Code CLI is the coding engine that runs inside each workspace.

See `hydraz_v1_spec.md` for the full product specification.

## License

MIT
