import type { Command } from 'commander';

export function registerResumeCommand(program: Command): void {
  program
    .command('resume')
    .description('Resume a paused, interrupted, or blocked session')
    .argument('[session]', 'Session name (prompted if not provided)')
    .action(async (session?: string) => {
      console.log('hydraz resume is not yet implemented.');
    });
}
