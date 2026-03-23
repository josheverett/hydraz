import type { Command } from 'commander';

export function registerConfigCommand(program: Command): void {
  program
    .command('config')
    .description('Configure global defaults and advanced settings')
    .action(async () => {
      console.log('hydraz config is not yet implemented.');
    });
}
