import { select, input, confirm, checkbox } from '@inquirer/prompts';
import { detectRepo } from '../core/repo/detect.js';
import { loadConfig, configExists, initializeConfigDir } from '../core/config/index.js';
import { listPersonas, validateSwarmSelection } from '../core/personas/index.js';
import {
  createNewSession,
  listSessions,
  initRepoState,
  getActiveSessions,
  type SessionMetadata,
} from '../core/sessions/index.js';
import { createEvent, appendEvent } from '../core/events/index.js';
import { suggestBranchName, isValidSessionName, isValidBranchName } from '../core/branches/index.js';

export async function runInteractive(): Promise<void> {
  const repo = detectRepo();

  if (!repo) {
    console.error('Not in a git repository. Run hydraz from a repository root.');
    process.exit(1);
    return;
  }

  if (!configExists()) {
    const shouldInit = await confirm({
      message: 'No Hydraz config found. Initialize with defaults?',
      default: true,
    });
    if (shouldInit) {
      initializeConfigDir();
      console.log('Config initialized at ~/.config/hydraz/\n');
    } else {
      return;
    }
  }

  initRepoState(repo.root);

  console.log(`\nHydraz — ${repo.name}\n`);

  const activeSessions = getActiveSessions(repo.root);
  const allSessions = listSessions(repo.root);

  const choices: { name: string; value: string }[] = [
    { name: 'Start new session', value: 'new' },
  ];

  if (activeSessions.length > 0) {
    choices.push({ name: `Attach to existing session (${activeSessions.length} active)`, value: 'attach' });
  }
  if (allSessions.length > 0) {
    choices.push({ name: 'Review completed session', value: 'review' });
  }
  choices.push({ name: 'Config', value: 'config' });

  const choice = await select({
    message: 'What would you like to do?',
    choices,
  });

  switch (choice) {
    case 'new':
      await newSessionFlow(repo.root, repo.name);
      break;
    case 'attach':
      console.log('\nAttach flow will be fully wired in the orchestration phase.\n');
      break;
    case 'review':
      console.log('\nReview flow will be fully wired in the review surfaces phase.\n');
      break;
    case 'config':
      console.log('\nRun "hydraz config" directly.\n');
      break;
  }
}

async function newSessionFlow(repoRoot: string, repoName: string): Promise<void> {
  const config = loadConfig();

  const sessionName = await input({
    message: 'Session name',
    validate: (val) => {
      if (!isValidSessionName(val)) {
        return 'Use 2-64 chars: lowercase letters, numbers, hyphens. Cannot start/end with hyphen.';
      }
      return true;
    },
  });

  const suggestedBranch = suggestBranchName(sessionName, config.branchNaming.prefix);
  const branchName = await input({
    message: 'Branch name',
    default: suggestedBranch,
    validate: (val) => {
      if (!isValidBranchName(val)) {
        return 'Invalid git branch name.';
      }
      return true;
    },
  });

  const executionTarget = await select({
    message: 'Execution target',
    choices: [
      { name: 'Local', value: 'local' as const },
      { name: 'Cloud', value: 'cloud' as const },
    ],
    default: config.executionTarget,
  });

  const personas = await selectPersonas(config.defaultPersonas);

  const task = await input({
    message: 'Task (issue URL or description)',
    validate: (val) => val.trim().length > 0 || 'Task cannot be empty.',
  });

  console.log('\n  Summary:');
  console.log(`    Session:   ${sessionName}`);
  console.log(`    Branch:    ${branchName}`);
  console.log(`    Target:    ${executionTarget}`);
  console.log(`    Personas:  ${personas.join(', ')}`);
  console.log(`    Task:      ${task}\n`);

  const confirmed = await confirm({ message: 'Launch session?', default: true });
  if (!confirmed) {
    console.log('\nSession cancelled.\n');
    return;
  }

  const session = createNewSession({
    name: sessionName,
    repoRoot,
    branchName,
    personas,
    executionTarget,
    task,
  });

  appendEvent(
    repoRoot,
    createEvent(session.id, 'session.created', `Session "${sessionName}" created`, {
      metadata: { branch: branchName, target: executionTarget },
    }),
  );

  console.log(`\nSession "${sessionName}" created (${session.id}).`);
  console.log('Orchestration will begin once the executor integration is complete.\n');
}

async function selectPersonas(
  defaults: [string, string, string],
): Promise<[string, string, string]> {
  const useDefaults = await confirm({
    message: `Use default swarm? (${defaults.join(', ')})`,
    default: true,
  });

  if (useDefaults) {
    return [...defaults];
  }

  const allPersonas = listPersonas();
  const selected = await checkbox({
    message: 'Select exactly 3 personas',
    choices: allPersonas.map((p) => ({
      name: `${p.displayName}${p.isBuiltIn ? '' : ' (custom)'}`,
      value: p.name,
      checked: defaults.includes(p.name),
    })),
  });

  const available = allPersonas.map((p) => p.name);
  return validateSwarmSelection(selected, available);
}
