import type { Command } from 'commander';
import { detectRepo } from '../../core/repo/detect.js';
import { loadConfig, configExists, initializeConfigDir } from '../../core/config/index.js';
import {
  createNewSession,
  initRepoState,
  SessionError,
} from '../../core/sessions/index.js';
import { createEvent, appendEvent } from '../../core/events/index.js';
import { suggestBranchName } from '../../core/branches/index.js';
import { startSession } from '../../core/orchestration/index.js';

export function registerRunCommand(program: Command): void {
  program
    .command('run')
    .description('Launch a task directly (non-interactive)')
    .argument('<task>', 'Task description')
    .option('--session <name>', 'Session name')
    .option('--branch <name>', 'Branch name')
    .option('--local', 'Run locally')
    .option('--cloud', 'Run in cloud')
    .action(async (task: string, options: {
      session?: string;
      branch?: string;
      local?: boolean;
      cloud?: boolean;
    }) => {
      const repo = detectRepo();
      if (!repo) {
        console.error('Not in a git repository.');
        return;
      }

      if (!configExists()) {
        initializeConfigDir();
      }
      initRepoState(repo.root);

      const config = loadConfig();
      const sessionName = options.session ?? generateSessionName(task);
      const branchName = options.branch ?? suggestBranchName(sessionName, config.branchNaming.prefix);
      const executionTarget = options.cloud ? 'cloud' as const : 'local' as const;

      let session;
      try {
        session = createNewSession({
          name: sessionName,
          repoRoot: repo.root,
          branchName,
          personas: config.defaultPersonas,
          executionTarget,
          task,
        });
      } catch (err) {
        if (err instanceof SessionError) {
          console.error(err.message);
        } else {
          throw err;
        }
        return;
      }

      appendEvent(
        repo.root,
        createEvent(session.id, 'session.created', `Session "${sessionName}" created`),
      );

      console.log(`\nSession "${sessionName}" started on branch ${branchName}`);
      console.log(`Task: ${task}\n`);

      await startSession(session.id, repo.root, {
        onStreamLine: (line) => console.log(line),
        onError: (msg) => console.error(msg),
      });
    });
}

function generateSessionName(task: string): string {
  const slug = task
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const suffix = Date.now().toString(36).slice(-4);
  return slug ? `${slug}-${suffix}` : `session-${suffix}`;
}
