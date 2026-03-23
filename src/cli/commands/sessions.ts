import type { Command } from 'commander';

export function registerSessionsCommand(program: Command): void {
  program
    .command('sessions')
    .description('List active, resumable, and completed sessions in the current repo')
    .action(async () => {
      console.log('hydraz sessions is not yet implemented.');
    });
}
