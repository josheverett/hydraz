import type { Command } from 'commander';
import { detectRepo } from '../../core/repo/detect.js';
import { loadConfig, configExists, initializeConfigDir } from '../../core/config/index.js';
import {
  createNewSession,
  initRepoState,
  SessionError,
} from '../../core/sessions/index.js';
import { createEvent, appendEvent } from '../../core/events/index.js';
import { suggestBranchName, isValidBranchName, isValidSessionName } from '../../core/branches/index.js';
import { startSession } from '../../core/orchestration/index.js';

export function registerRunCommand(program: Command): void {
  program
    .command('run')
    .description('Launch a task directly (non-interactive)')
    .argument('<task>', 'Task description')
    .option('--session <name>', 'Session name')
    .option('--branch <name>', 'Branch name')
    .option('--local', 'Run locally (bare metal)')
    .option('--container', 'Run locally in a container')
    .option('--cloud', 'Run in cloud')
    .option('--swarm', 'No-op (swarm pipeline always runs)')
    .option('--workers <count>', 'Number of workers (default: 3)')
    .option('--parallel', 'Run workers in parallel (default: serial)')
    .option('--reviewers <names>', 'Comma-separated reviewer persona names (default: carmack,metz,torvalds)')
    .action(async (task: string, options: {
      session?: string;
      branch?: string;
      local?: boolean;
      container?: boolean;
      cloud?: boolean;
      swarm?: boolean;
      workers?: string;
      parallel?: boolean;
      reviewers?: string;
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

      if (options.session && !isValidSessionName(sessionName)) {
        console.error(`Invalid session name: "${sessionName}". Use 2-64 chars: lowercase letters, numbers, hyphens.`);
        return;
      }

      const branchName = options.branch ?? suggestBranchName(sessionName, config.branchNaming.prefix);

      if (!isValidBranchName(branchName)) {
        console.error(`Invalid branch name: "${branchName}". Branch names must not contain shell metacharacters.`);
        return;
      }
      const executionTarget = options.cloud
        ? 'cloud' as const
        : options.container
          ? 'local-container' as const
          : 'local' as const;

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

      const workerCount = options.workers ? parseInt(options.workers, 10) : undefined;
      if (options.workers && (isNaN(workerCount!) || workerCount! < 1)) {
        console.error(`Invalid worker count: "${options.workers}". Must be a positive integer.`);
        return;
      }

      const reviewerNames = options.reviewers
        ? options.reviewers.split(',').map(s => s.trim()).filter(Boolean)
        : undefined;

      console.log(`\nSession "${sessionName}" started on branch ${branchName}`);
      console.log(`Task: ${task}`);
      if (workerCount) console.log(`Workers: ${workerCount}`);
      if (reviewerNames) console.log(`Reviewers: ${reviewerNames.join(', ')}`);
      console.log('');

      await startSession(session.id, repo.root, {
        onStreamLine: (line) => console.log(line),
        onError: (msg) => console.error(msg),
      }, {
        workerCount,
        reviewerNames,
        parallel: options.parallel,
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
