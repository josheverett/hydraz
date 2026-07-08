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
import { setVerbose } from '../../core/debug.js';

type Sandbox = 'read-only' | 'workspace-write' | 'danger-full-access';

export function registerRunCommand(program: Command): void {
  program
    .command('run')
    .description('Launch a detached Codex goal in a Hydraz-managed workspace')
    .argument('<goal>', 'Goal description')
    .option('--session <name>', 'Session name')
    .option('--branch <name>', 'Branch name')
    .option('--local', 'Run locally (bare metal)')
    .option('--container', 'Run locally in a container')
    .option('--cloud', 'Run in cloud (default)')
    .option('--model <model>', 'Codex model override')
    .option('--sandbox <mode>', 'Codex sandbox mode: read-only, workspace-write, danger-full-access')
    .option('--search', 'Enable live Codex web search')
    .option('--no-push', 'Do not push the session branch after Codex completes')
    .option('--no-pr', 'Do not create a draft pull request after Codex completes')
    .option('--keep-workspace', 'Preserve the workspace after successful delivery')
    .option('--no-clone', 'Use local repo path instead of cloning from remote')
    .option('--verbose', 'Enable diagnostic output')
    .action(async (goal: string, options: {
      session?: string;
      branch?: string;
      local?: boolean;
      container?: boolean;
      cloud?: boolean;
      model?: string;
      sandbox?: Sandbox;
      search?: boolean;
      push?: boolean;
      pr?: boolean;
      keepWorkspace?: boolean;
      clone?: boolean;
      verbose?: boolean;
    }) => {
      if (options.verbose) setVerbose(true);

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
      const sessionName = options.session ?? generateSessionName(goal);

      if (options.session && !isValidSessionName(sessionName)) {
        console.error(`Invalid session name: "${sessionName}". Use 2-64 chars: lowercase letters, numbers, hyphens.`);
        return;
      }

      const branchName = options.branch ?? suggestBranchName(sessionName, config.branchNaming.prefix);
      if (!isValidBranchName(branchName)) {
        console.error(`Invalid branch name: "${branchName}". Branch names must not contain shell metacharacters.`);
        return;
      }

      if (options.sandbox && !['read-only', 'workspace-write', 'danger-full-access'].includes(options.sandbox)) {
        console.error(`Invalid sandbox mode: "${options.sandbox}".`);
        return;
      }

      const executionTarget = options.local
        ? 'local' as const
        : options.container
          ? 'local-container' as const
          : 'cloud' as const;

      let session;
      try {
        session = createNewSession({
          name: sessionName,
          repoRoot: repo.root,
          branchName,
          executionTarget,
          task: goal,
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
      console.log(`Goal: ${goal}`);
      console.log(`Target: ${executionTarget}`);
      console.log('');

      await startSession(session.id, repo.root, {
        onStreamLine: (line) => console.log(line),
        onError: (msg) => console.error(msg),
      }, {
        model: options.model,
        sandbox: options.sandbox,
        search: options.search,
        skipClone: options.clone === false,
        noPush: options.push === false,
        noPr: options.pr === false,
        keepWorkspace: options.keepWorkspace,
        verbose: options.verbose,
      });
    });
}

function generateSessionName(goal: string): string {
  const slug = goal
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const suffix = Date.now().toString(36).slice(-4);
  return slug ? `${slug}-${suffix}` : `session-${suffix}`;
}
