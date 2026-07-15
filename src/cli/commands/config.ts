import type { Command } from 'commander';
import { select, confirm, password, input } from '@inquirer/prompts';
import {
  loadConfig,
  saveConfig,
  configExists,
  initializeConfigDir,
  type ExecutionTarget,
  type CodexReasoningEffort,
  type CodexSpeed,
  CODEX_REASONING_EFFORTS,
  CODEX_SPEEDS,
  DEFAULT_CODEX_MODEL,
} from '../../core/config/index.js';

type CodexSandbox = 'read-only' | 'workspace-write' | 'danger-full-access';

export function registerConfigCommand(program: Command): void {
  program
    .command('config')
    .description('Configure Hydraz v3 defaults')
    .action(async () => {
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

      await configMenu();
    });
}

export async function configMenu(): Promise<void> {
  const action = await select({
    message: 'Hydraz Config',
    choices: [
      { name: 'View current config', value: 'view' as const },
      { name: 'Set default execution target', value: 'execution-target' as const },
      { name: 'Set Codex command', value: 'codex-command' as const },
      { name: 'Set Codex model', value: 'codex-model' as const },
      { name: 'Set Codex reasoning effort', value: 'codex-reasoning-effort' as const },
      { name: 'Set Codex speed', value: 'codex-speed' as const },
      { name: 'Set Codex sandbox', value: 'codex-sandbox' as const },
      { name: 'Set GitHub push/PR auth', value: 'github-auth' as const },
      { name: 'Exit', value: 'exit' as const },
    ],
  });

  switch (action) {
    case 'view':
      viewConfig();
      break;
    case 'execution-target':
      await setExecutionTarget();
      break;
    case 'codex-command':
      await setCodexCommand();
      break;
    case 'codex-model':
      await setCodexModel();
      break;
    case 'codex-reasoning-effort':
      await setCodexReasoningEffort();
      break;
    case 'codex-speed':
      await setCodexSpeed();
      break;
    case 'codex-sandbox':
      await setCodexSandbox();
      break;
    case 'github-auth':
      await setGitHubAuth();
      break;
    case 'exit':
      return;
  }

  await configMenu();
}

function viewConfig(): void {
  const config = loadConfig();
  console.log('\nCurrent config:');
  console.log(`  Execution target:  ${config.executionTarget}`);
  console.log(`  Branch prefix:     ${config.branchNaming.prefix}`);
  console.log(`  Codex command:     ${config.codex.command}`);
  console.log(`  Codex model:       ${config.codex.model ?? 'default'}`);
  console.log(`  Codex reasoning:   ${config.codex.reasoningEffort}`);
  console.log(`  Codex speed:       ${config.codex.speed}`);
  console.log(`  Codex sandbox:     ${config.codex.sandbox}`);
  console.log(`  Codex search:      ${config.codex.search}`);
  console.log(`  GitHub token:      ${config.github.token ? 'configured' : 'not set'}`);
  console.log(`  Display verbosity: ${config.displayVerbosity}`);
  console.log();
}

async function setExecutionTarget(): Promise<void> {
  const config = loadConfig();
  const target = await select({
    message: 'Default execution target',
    choices: [
      { name: 'Cloud', value: 'cloud' as ExecutionTarget },
      { name: 'Local (container)', value: 'local-container' as ExecutionTarget },
      { name: 'Local', value: 'local' as ExecutionTarget },
    ],
    default: config.executionTarget,
  });

  config.executionTarget = target;
  saveConfig(config);
  console.log(`\nDefault execution target set to: ${target}\n`);
}

async function setCodexCommand(): Promise<void> {
  const config = loadConfig();
  const command = await input({
    message: 'Codex command',
    default: config.codex.command,
  });
  if (command.trim()) {
    config.codex.command = command.trim();
    saveConfig(config);
  }
}

async function setCodexModel(): Promise<void> {
  const config = loadConfig();
  const model = await input({
    message: 'Codex model (blank for Codex default)',
    default: config.codex.model ?? '',
  });
  if (model.trim()) {
    config.codex.model = model.trim();
  } else {
    config.codex.model = DEFAULT_CODEX_MODEL;
  }
  saveConfig(config);
}

async function setCodexReasoningEffort(): Promise<void> {
  const config = loadConfig();
  const reasoningEffort = await select({
    message: 'Codex reasoning effort',
    choices: CODEX_REASONING_EFFORTS.map((effort) => ({
      name: effort,
      value: effort as CodexReasoningEffort,
    })),
    default: config.codex.reasoningEffort,
  });
  config.codex.reasoningEffort = reasoningEffort;
  saveConfig(config);
}

async function setCodexSpeed(): Promise<void> {
  const config = loadConfig();
  const speed = await select({
    message: 'Codex speed',
    choices: CODEX_SPEEDS.map((value) => ({
      name: value,
      value: value as CodexSpeed,
    })),
    default: config.codex.speed,
  });
  config.codex.speed = speed;
  saveConfig(config);
}

async function setCodexSandbox(): Promise<void> {
  const config = loadConfig();
  const sandbox = await select({
    message: 'Codex sandbox',
    choices: [
      { name: 'workspace-write', value: 'workspace-write' as CodexSandbox },
      { name: 'read-only', value: 'read-only' as CodexSandbox },
      { name: 'danger-full-access', value: 'danger-full-access' as CodexSandbox },
    ],
    default: config.codex.sandbox,
  });
  config.codex.sandbox = sandbox;
  saveConfig(config);
}

async function setGitHubAuth(): Promise<void> {
  const config = loadConfig();
  const action = await select({
    message: 'GitHub push/PR auth',
    choices: [
      { name: `Set GitHub token ${config.github.token ? '(configured)' : '(not set)'}`, value: 'token' as const },
      { name: 'Clear stored GitHub token', value: 'clear' as const },
      { name: 'Back', value: 'back' as const },
    ],
  });

  switch (action) {
    case 'token': {
      const token = await password({
        message: 'Enter GitHub token',
        mask: '*',
      });
      if (token.trim()) {
        config.github.token = token.trim();
        saveConfig(config);
        console.log('\nGitHub token saved.\n');
      }
      break;
    }
    case 'clear': {
      const shouldClear = await confirm({
        message: 'Clear stored GitHub token?',
        default: false,
      });
      if (shouldClear) {
        delete config.github.token;
        saveConfig(config);
        console.log('\nGitHub token cleared.\n');
      }
      break;
    }
    case 'back':
      return;
  }
}
