import { Command } from 'commander';
import { registerCommands } from './commands/index.js';
import { runInteractive } from './interactive.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('hydraz')
    .description('An opinionated CLI for autonomous, persona-driven coding swarms')
    .version('0.1.0')
    .action(async () => {
      await runInteractive();
    });

  registerCommands(program);

  return program;
}
