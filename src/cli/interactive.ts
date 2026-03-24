import { select, input, confirm, checkbox } from '@inquirer/prompts';
import { detectRepo } from '../core/repo/detect.js';
import { loadConfig, configExists, initializeConfigDir } from '../core/config/index.js';
import { listPersonas, validateSwarmSelection } from '../core/personas/index.js';
import {
  createNewSession,
  listSessions,
  findSessionByName,
  initRepoState,
  getActiveSessions,
  summarizeArtifacts,
  getArtifactStatus,
  loadArtifact,
  type SessionMetadata,
} from '../core/sessions/index.js';
import { createEvent, appendEvent, readEvents, formatEvent } from '../core/events/index.js';
import { suggestBranchName, isValidSessionName, isValidBranchName } from '../core/branches/index.js';
import { startSession } from '../core/orchestration/index.js';
import { configMenu } from './commands/config.js';
import { describeAuthMode } from '../core/providers/auth.js';

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
      await attachFlow(repo.root);
      break;
    case 'review':
      await reviewFlow(repo.root);
      break;
    case 'config':
      await configMenu();
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
    message: 'Task',
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

  console.log(`\nSession "${sessionName}" created. Launching...\n`);

  await startSession(session.id, repoRoot, {
    onStreamLine: (line) => console.log(line),
    onError: (msg) => console.error(msg),
  });
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

async function attachFlow(repoRoot: string): Promise<void> {
  const active = getActiveSessions(repoRoot);
  if (active.length === 0) {
    console.log('\nNo active sessions to attach to.\n');
    return;
  }

  const chosen = await select({
    message: 'Select session to attach to',
    choices: active.map((s) => ({
      name: `${s.name} [${s.state}] → ${s.branchName}`,
      value: s.id,
    })),
  });

  const session = active.find((s) => s.id === chosen)!;
  console.log(`\n  Session:    ${session.name}`);
  console.log(`  Branch:     ${session.branchName}`);
  console.log(`  State:      ${session.state}`);
  console.log(`  Target:     ${session.executionTarget}`);
  console.log(`  Personas:   ${session.personas.join(', ')}`);
  console.log(`  Task:       ${session.task}`);

  const events = readEvents(repoRoot, session.id);
  if (events.length > 0) {
    console.log('\n  Recent events:');
    for (const event of events.slice(-5)) {
      console.log(`    ${formatEvent(event)}`);
    }
  }
  console.log();
}

async function reviewFlow(repoRoot: string): Promise<void> {
  const sessions = listSessions(repoRoot);
  if (sessions.length === 0) {
    console.log('\nNo sessions to review.\n');
    return;
  }

  const chosen = await select({
    message: 'Select session to review',
    choices: sessions.map((s) => ({
      name: `${s.name} [${s.state}] → ${s.branchName}`,
      value: s.id,
    })),
  });

  const session = sessions.find((s) => s.id === chosen)!;
  const config = loadConfig();
  const artifacts = summarizeArtifacts(repoRoot, session.id);
  const events = readEvents(repoRoot, session.id);

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                     SESSION REVIEW                          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log(`  Session:       ${session.name}`);
  console.log(`  State:         ${session.state}`);
  console.log(`  Branch:        ${session.branchName}`);
  console.log(`  Target:        ${session.executionTarget}`);
  console.log(`  Personas:      ${session.personas.join(', ')}`);
  console.log(`  Auth mode:     ${describeAuthMode(config)}`);

  console.log('\n  ── Task ──');
  console.log(`  ${session.task}`);

  if (session.blockerMessage) {
    console.log('\n  ── Blocker ──');
    console.log(`  ${session.blockerMessage}`);
  }

  console.log('\n  ── Artifacts ──');
  console.log(`  ${getArtifactStatus(artifacts)}`);
  for (const a of artifacts) {
    const status = a.exists ? '✓' : '·';
    console.log(`    ${status} ${a.file}`);
  }

  const prDraft = loadArtifact(repoRoot, session.id, 'pr-draft.md');
  if (prDraft) {
    console.log('\n  ── PR Draft ──');
    for (const line of prDraft.trim().split('\n')) {
      console.log(`  ${line}`);
    }
  }

  if (events.length > 0) {
    console.log('\n  ── Event Timeline ──');
    for (const event of events) {
      console.log(`    ${formatEvent(event)}`);
    }
  }

  console.log();
}
