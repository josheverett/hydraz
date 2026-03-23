import type { Command } from 'commander';

export function registerEventsCommand(program: Command): void {
  program
    .command('events')
    .description('Show structured framework-level event history')
    .argument('[session]', 'Session name (uses active session if not provided)')
    .action(async (session?: string) => {
      console.log('hydraz events is not yet implemented.');
    });
}
