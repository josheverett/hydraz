import type { Command } from 'commander';

export function registerPersonasCommand(program: Command): void {
  program
    .command('personas')
    .description('Manage built-in and custom personas and choose the global default swarm')
    .action(async () => {
      console.log('hydraz personas is not yet implemented.');
    });
}
