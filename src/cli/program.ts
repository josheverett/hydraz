import { Command } from 'commander';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('hydraz')
    .description('An opinionated CLI for autonomous, persona-driven coding swarms')
    .version('0.1.0');

  return program;
}
