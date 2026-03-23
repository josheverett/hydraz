import type { Command } from 'commander';
import { select, confirm } from '@inquirer/prompts';
import {
  loadConfig,
  saveConfig,
  configExists,
  initializeConfigDir,
  loadMasterPrompt,
  resetMasterPrompt,
  checkClaudeAvailability,
  type ExecutionTarget,
  type AuthMode,
} from '../../core/config/index.js';

export function registerConfigCommand(program: Command): void {
  program
    .command('config')
    .description('Configure global defaults and advanced settings')
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

async function configMenu(): Promise<void> {
  const action = await select({
    message: 'Hydraz Config',
    choices: [
      { name: 'View current config', value: 'view' as const },
      { name: 'Set default execution target', value: 'execution-target' as const },
      { name: 'Set default personas', value: 'personas' as const },
      { name: 'Master prompt', value: 'master-prompt' as const },
      { name: 'Claude Code auth', value: 'auth' as const },
      { name: 'Check Claude Code availability', value: 'claude-check' as const },
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
    case 'personas':
      console.log('\nPersona management is not yet implemented. Use "hydraz personas" (coming in Phase 3).\n');
      break;
    case 'master-prompt':
      await masterPromptMenu();
      break;
    case 'auth':
      await setAuthMode();
      break;
    case 'claude-check':
      claudeCheck();
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
  console.log(`  Default personas:  ${config.defaultPersonas.join(', ')}`);
  console.log(`  Branch prefix:     ${config.branchNaming.prefix}`);
  console.log(`  Auth mode:         ${config.claudeAuth.mode}`);
  console.log(`  Keep transcripts:  ${config.retention.keepTranscripts}`);
  console.log(`  Keep test logs:    ${config.retention.keepTestLogs}`);
  console.log();
}

async function setExecutionTarget(): Promise<void> {
  const config = loadConfig();
  const target = await select({
    message: 'Default execution target',
    choices: [
      { name: 'Local', value: 'local' as ExecutionTarget },
      { name: 'Cloud', value: 'cloud' as ExecutionTarget },
    ],
    default: config.executionTarget,
  });

  config.executionTarget = target;
  saveConfig(config);
  console.log(`\nDefault execution target set to: ${target}\n`);
}

async function masterPromptMenu(): Promise<void> {
  const action = await select({
    message: 'Master prompt',
    choices: [
      { name: 'View current prompt', value: 'view' as const },
      { name: 'Reset to default', value: 'reset' as const },
      { name: 'Back', value: 'back' as const },
    ],
  });

  switch (action) {
    case 'view': {
      const prompt = loadMasterPrompt();
      console.log('\n--- Master Prompt ---');
      console.log(prompt);
      console.log('--- End ---\n');
      break;
    }
    case 'reset': {
      const shouldReset = await confirm({
        message: 'Reset master prompt to default?',
        default: false,
      });
      if (shouldReset) {
        resetMasterPrompt();
        console.log('\nMaster prompt reset to default.\n');
      }
      break;
    }
    case 'back':
      return;
  }
}

async function setAuthMode(): Promise<void> {
  const config = loadConfig();
  const mode = await select({
    message: 'Claude Code auth mode',
    choices: [
      { name: 'Claude.ai subscription (OAuth)', value: 'claude-ai-oauth' as AuthMode },
      { name: 'API key', value: 'api-key' as AuthMode },
    ],
    default: config.claudeAuth.mode,
  });

  config.claudeAuth.mode = mode;
  saveConfig(config);
  console.log(`\nAuth mode set to: ${mode}\n`);
}

function claudeCheck(): void {
  console.log('\nChecking Claude Code availability...');
  const result = checkClaudeAvailability();

  if (result.available) {
    console.log(`  Claude Code is available${result.version ? ` (v${result.version})` : ''}`);
  } else {
    console.log(`  ${result.error}`);
  }
  console.log();
}
