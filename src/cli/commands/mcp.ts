import type { Command } from 'commander';
import { select, input, confirm } from '@inquirer/prompts';
import { detectRepo } from '../../core/repo/detect.js';
import {
  loadGlobalMcpConfig,
  saveGlobalMcpConfig,
  getEffectiveServers,
  addServer,
  removeServer,
  toggleServer,
  findServer,
  McpError,
  type McpServer,
} from '../../core/mcp/index.js';

export function registerMcpCommand(program: Command): void {
  program
    .command('mcp')
    .description('Manage MCP server configuration and connectivity')
    .action(async () => {
      await mcpMenu();
    });
}

async function mcpMenu(): Promise<void> {
  const repo = detectRepo();
  const effective = getEffectiveServers(undefined, repo?.root);

  if (effective.servers.length > 0) {
    console.log('\nConfigured MCP servers:');
    for (const server of effective.servers) {
      const status = server.enabled ? 'enabled' : 'disabled';
      console.log(`  ${server.name} (${server.command}) [${status}]`);
    }
  } else {
    console.log('\nNo MCP servers configured.');
  }
  console.log();

  const action = await select({
    message: 'MCP Actions',
    choices: [
      { name: 'Add server', value: 'add' as const },
      { name: 'Remove server', value: 'remove' as const },
      { name: 'Enable/disable server', value: 'toggle' as const },
      { name: 'Test server', value: 'test' as const },
      { name: 'Exit', value: 'exit' as const },
    ],
  });

  switch (action) {
    case 'add':
      await addServerFlow();
      break;
    case 'remove':
      await removeServerFlow();
      break;
    case 'toggle':
      await toggleServerFlow();
      break;
    case 'test':
      await testServerFlow();
      break;
    case 'exit':
      return;
  }

  await mcpMenu();
}

async function addServerFlow(): Promise<void> {
  const name = await input({
    message: 'Server name',
    validate: (val) => val.trim().length > 0 || 'Name cannot be empty.',
  });

  const command = await input({
    message: 'Command to run',
    validate: (val) => val.trim().length > 0 || 'Command cannot be empty.',
  });

  const argsRaw = await input({
    message: 'Arguments (space-separated, or leave empty)',
  });

  const args = argsRaw.trim().length > 0 ? argsRaw.trim().split(/\s+/) : undefined;

  const server: McpServer = {
    name: name.trim(),
    command: command.trim(),
    args,
    enabled: true,
  };

  try {
    let config = loadGlobalMcpConfig();
    config = addServer(config, server);
    saveGlobalMcpConfig(config);
    console.log(`\nServer "${name}" added.\n`);
  } catch (err) {
    if (err instanceof McpError) {
      console.log(`\n${err.message}\n`);
    } else {
      throw err;
    }
  }
}

async function removeServerFlow(): Promise<void> {
  const config = loadGlobalMcpConfig();
  if (config.servers.length === 0) {
    console.log('\nNo servers to remove.\n');
    return;
  }

  const name = await select({
    message: 'Select server to remove',
    choices: config.servers.map((s) => ({ name: s.name, value: s.name })),
  });

  const shouldRemove = await confirm({ message: `Remove "${name}"?`, default: false });
  if (shouldRemove) {
    try {
      const updated = removeServer(config, name);
      saveGlobalMcpConfig(updated);
      console.log(`\nServer "${name}" removed.\n`);
    } catch (err) {
      if (err instanceof McpError) {
        console.log(`\n${err.message}\n`);
      } else {
        throw err;
      }
    }
  }
}

async function toggleServerFlow(): Promise<void> {
  const config = loadGlobalMcpConfig();
  if (config.servers.length === 0) {
    console.log('\nNo servers configured.\n');
    return;
  }

  const name = await select({
    message: 'Select server to toggle',
    choices: config.servers.map((s) => ({
      name: `${s.name} [${s.enabled ? 'enabled' : 'disabled'}]`,
      value: s.name,
    })),
  });

  const server = findServer(config, name);
  if (!server) return;

  const newState = !server.enabled;
  const updated = toggleServer(config, name, newState);
  saveGlobalMcpConfig(updated);
  console.log(`\nServer "${name}" ${newState ? 'enabled' : 'disabled'}.\n`);
}

async function testServerFlow(): Promise<void> {
  const repo = detectRepo();
  const effective = getEffectiveServers(undefined, repo?.root);

  if (effective.servers.length === 0) {
    console.log('\nNo servers to test.\n');
    return;
  }

  const name = await select({
    message: 'Select server to test',
    choices: effective.servers.map((s) => ({ name: s.name, value: s.name })),
  });

  const server = findServer(effective, name);
  if (!server) return;

  console.log(`\nTesting "${name}"...`);
  console.log(`  Command: ${server.command}${server.args ? ' ' + server.args.join(' ') : ''}`);
  console.log(`  Status:  ${server.enabled ? 'enabled' : 'disabled'}`);
  console.log('  Note:    Full connectivity testing requires Claude Code runtime.\n');
}
