import type { Command } from 'commander';

export function registerMcpCommand(program: Command): void {
  program
    .command('mcp')
    .description('Manage MCP server configuration and connectivity')
    .action(async () => {
      console.log('hydraz mcp is not yet implemented.');
    });
}
