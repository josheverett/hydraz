import type { Command } from 'commander';
import { detectRepo } from '../../core/repo/detect.js';
import {
  loadConfig,
  configExists,
  initializeConfigDir,
  CODEX_REASONING_EFFORTS,
  CODEX_SPEEDS,
  type CodexReasoningEffort,
  type CodexSpeed,
} from '../../core/config/index.js';
import {
  createNewSession,
  DEFAULT_CLOUD_MAX_RUNTIME,
  initRepoState,
  SessionError,
} from '../../core/sessions/index.js';
import { createEvent, appendEvent } from '../../core/events/index.js';
import { suggestBranchName, isValidBranchName, isValidSessionName } from '../../core/branches/index.js';
import { startSession } from '../../core/orchestration/index.js';
import { setVerbose } from '../../core/debug.js';

type Sandbox = 'read-only' | 'workspace-write' | 'danger-full-access';

const POSITIVE_DEVPOD_DURATION = /^(?=.*[1-9])(?:\d+(?:\.\d+)?(?:ns|us|µs|μs|ms|s|m|h))+$/;

export function registerRunCommand(program: Command): void {
  program
    .command('run')
    .description('Launch a detached Codex goal in a Hydraz-managed workspace')
    .argument('<goal>', 'Goal description')
    .option('--session <name>', 'Session name')
    .option('--branch <name>', 'Branch name')
    .option('--base <branch>', 'Base branch for workspace creation and PR delivery')
    .option('--local', 'Run locally (bare metal)')
    .option('--container', 'Run locally in a container')
    .option('--cloud', 'Run in cloud (default)')
    .option('--model <model>', 'Codex model override')
    .option('--reasoning-effort <effort>', 'Codex reasoning effort override')
    .option('--speed <speed>', 'Codex speed override: standard or fast')
    .option('--max-runtime <duration>', 'Maximum cloud workspace runtime')
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
      base?: string;
      local?: boolean;
      container?: boolean;
      cloud?: boolean;
      model?: string;
      reasoningEffort?: CodexReasoningEffort;
      speed?: CodexSpeed;
      maxRuntime?: string;
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

      if (options.base && !isValidBranchName(options.base)) {
        console.error(`Invalid base branch: "${options.base}". Branch names must not contain shell metacharacters.`);
        return;
      }

      const executionTarget = options.local
        ? 'local' as const
        : options.container
          ? 'local-container' as const
          : 'cloud' as const;
      if (options.maxRuntime !== undefined && executionTarget !== 'cloud') {
        console.error('--max-runtime is only supported with cloud runs.');
        return;
      }
      const maxRuntime = executionTarget === 'cloud'
        ? options.maxRuntime === undefined
          ? DEFAULT_CLOUD_MAX_RUNTIME
          : options.maxRuntime.trim()
        : undefined;
      if (maxRuntime !== undefined && !POSITIVE_DEVPOD_DURATION.test(maxRuntime)) {
        console.error(
          `Invalid maximum runtime: "${options.maxRuntime ?? maxRuntime}". Use a positive duration such as 90m, 12h, or 1h30m.`,
        );
        return;
      }

      if (options.sandbox && !['read-only', 'workspace-write', 'danger-full-access'].includes(options.sandbox)) {
        console.error(`Invalid sandbox mode: "${options.sandbox}".`);
        return;
      }
      if (options.model !== undefined && !options.model.trim()) {
        console.error('Invalid Codex model: expected a non-empty value.');
        return;
      }
      if (options.reasoningEffort && !CODEX_REASONING_EFFORTS.includes(options.reasoningEffort)) {
        console.error(`Invalid reasoning effort: "${options.reasoningEffort}".`);
        return;
      }
      if (options.speed && !CODEX_SPEEDS.includes(options.speed)) {
        console.error(`Invalid Codex speed: "${options.speed}". Use standard or fast.`);
        return;
      }

      let session;
      try {
        session = createNewSession({
          name: sessionName,
          repoRoot: repo.root,
          branchName,
          baseBranch: options.base,
          executionTarget,
          maxRuntime,
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
      if (options.base) {
        console.log(`Base: ${options.base}`);
      }
      console.log(`Goal: ${goal}`);
      console.log(`Target: ${executionTarget}`);
      if (maxRuntime) {
        console.log(`Max runtime: ${maxRuntime}`);
      }
      console.log('');

      await startSession(session.id, repo.root, {
        onStreamLine: (line) => console.log(line),
        onError: (msg) => console.error(msg),
      }, {
        model: options.model?.trim(),
        reasoningEffort: options.reasoningEffort,
        speed: options.speed,
        sandbox: options.sandbox,
        search: options.search,
        baseBranch: options.base,
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
