import type { Command } from 'commander';

export function registerAttachCommand(program: Command): void {
  program
    .command('attach')
    .description('Attach to an existing session in the current repo')
    .argument('[session]', 'Session name (prompted if not provided)')
    .action(async (session?: string) => {
      console.log('hydraz attach is not yet implemented.');
    });
}
