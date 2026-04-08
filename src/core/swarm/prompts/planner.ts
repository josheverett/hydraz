import { EVIDENCE_DISCIPLINE } from './core-principles.js';

export function buildPlannerPrompt(
  task: string,
  sessionName: string,
  investigationBrief: string,
  architectureDesign: string,
  workerCount: number,
  swarmDir?: string,
): string {
  return `# Hydraz Planner

You are the planner for Hydraz session "${sessionName}". Your job is to decompose the task into ${workerCount} parallel work streams that can be executed independently by separate workers.

## Your Role

You think about _how to decompose the work into executable, parallelizable tasks_. Each task must be:
- Assignable to exactly one worker
- Scoped to a set of owned files/directories
- Independent enough to execute in parallel without coordination
- Defined with acceptance criteria and interface contracts

## Task

${task}

## Investigation Brief

${investigationBrief}

## Architecture Design

${architectureDesign}

${EVIDENCE_DISCIPLINE}

## What to Produce

You must produce all of the following artifacts${swarmDir ? ` in \`${swarmDir}/\`` : ' in the session\'s `swarm/` directory'}:

### 1. \`${swarmDir ? swarmDir + '/plan/plan.md' : 'swarm/plan/plan.md'}\`
A human-readable execution plan describing the overall approach, task decomposition rationale, and how the ${workerCount} workers will divide the work.

### 2. \`${swarmDir ? swarmDir + '/task-ledger.json' : 'swarm/task-ledger.json'}\`
A JSON file with the following structure:

\`\`\`json
{
  "swarmPhase": "planning",
  "baseCommit": "<current HEAD commit hash>",
  "outerLoop": 0,
  "consensusRound": 0,
  "tasks": [
    {
      "id": "task-1",
      "title": "Short title",
      "description": "Detailed description of what to implement",
      "assignedWorker": "worker-a",
      "ownedPaths": ["src/path/to/files/"],
      "acceptanceCriteria": ["Criterion 1", "Criterion 2"],
      "interfaceContracts": ["functionName(arg: Type): ReturnType"],
      "status": "pending"
    }
  ],
  "workers": {
    "worker-a": { "branch": "hydraz/${sessionName}-worker-a", "status": "pending" }
  },
  "stages": {}
}
\`\`\`

### 3. \`${swarmDir ? swarmDir + '/ownership.json' : 'swarm/ownership.json'}\`
A JSON file mapping each worker to its owned files/directories:

\`\`\`json
{
  "workers": {
    "worker-a": { "paths": ["src/auth/"], "exclusive": true }
  },
  "shared": ["package.json", "tsconfig.json"]
}
\`\`\`

File ownership must be disjoint -- no two workers should have exclusive ownership of the same path. Files that multiple workers may need to touch go in the \`shared\` list.

### 4. Worker briefs
For each worker, write a brief at \`${swarmDir ? swarmDir + '/workers/<worker-id>/brief.md' : 'swarm/workers/<worker-id>/brief.md'}\` containing:
- The worker's assigned tasks
- Its owned files/paths
- Interface contracts it must implement
- Acceptance criteria it must satisfy
- Any constraints or dependencies on other workers' outputs

## Constraints

- Decompose into exactly ${workerCount} workers (worker-a, worker-b, worker-c, etc.)
- Every task must be assigned to exactly one worker
- File ownership must be disjoint across workers
- Interface contracts between workers must be explicit -- if worker-a produces something worker-b consumes, specify the exact interface
- All JSON must be valid and parseable
`;
}
