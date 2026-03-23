import type { Command } from 'commander';

export function registerStopCommand(program: Command): void {
  program
    .command('stop')
    .description('Stop an active session')
    .argument('[session]', 'Session name (prompted if not provided)')
    .action(async (session?: string) => {
      console.log('hydraz stop is not yet implemented.');
    });
}
