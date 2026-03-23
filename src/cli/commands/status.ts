import type { Command } from 'commander';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show a human-readable summary of session state')
    .argument('[session]', 'Session name (uses active session if not provided)')
    .action(async (session?: string) => {
      console.log('hydraz status is not yet implemented.');
    });
}
