import type { Command } from 'commander';
import { select, confirm, password, input } from '@inquirer/prompts';
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
import { changeDefaultSwarm } from './personas.js';

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

export async function configMenu(): Promise<void> {
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
      await changeDefaultSwarm();
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
  console.log(`  OAuth token:       ${config.claudeAuth.oauthToken ? 'configured' : 'not set'}`);
  console.log(`  API key:           ${config.claudeAuth.apiKey ? 'configured' : 'not set'}`);
  console.log(`  Keep transcripts:  ${config.retention.keepTranscripts}`);
  console.log(`  Keep test logs:    ${config.retention.keepTestLogs}`);
  console.log(`  Display verbosity: ${config.displayVerbosity}`);
  console.log();
}

async function setExecutionTarget(): Promise<void> {
  const config = loadConfig();
  const target = await select({
    message: 'Default execution target',
    choices: [
      { name: 'Local', value: 'local' as ExecutionTarget },
      { name: 'Local (container)', value: 'local-container' as ExecutionTarget },
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
  const action = await select({
    message: 'Claude Code auth',
    choices: [
      { name: 'Set auth mode', value: 'mode' as const },
      { name: `Set OAuth token ${config.claudeAuth.oauthToken ? '(configured)' : '(not set)'}`, value: 'oauth-token' as const },
      { name: `Set API key ${config.claudeAuth.apiKey ? '(configured)' : '(not set)'}`, value: 'api-key' as const },
      { name: 'Clear stored credentials', value: 'clear' as const },
      { name: 'Back', value: 'back' as const },
    ],
  });

  switch (action) {
    case 'mode': {
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
      break;
    }
    case 'oauth-token': {
      console.log('\nGenerate a token with: claude setup-token');
      const token = await password({
        message: 'Paste OAuth token',
        mask: '*',
      });
      if (token.trim()) {
        config.claudeAuth.oauthToken = token.trim();
        saveConfig(config);
        console.log('\nOAuth token saved.\n');
      }
      break;
    }
    case 'api-key': {
      const key = await input({
        message: 'Enter API key',
      });
      if (key.trim()) {
        config.claudeAuth.apiKey = key.trim();
        saveConfig(config);
        console.log('\nAPI key saved.\n');
      }
      break;
    }
    case 'clear': {
      const shouldClear = await confirm({
        message: 'Clear all stored auth credentials?',
        default: false,
      });
      if (shouldClear) {
        delete config.claudeAuth.oauthToken;
        delete config.claudeAuth.apiKey;
        saveConfig(config);
        console.log('\nCredentials cleared.\n');
      }
      break;
    }
    case 'back':
      return;
  }
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
