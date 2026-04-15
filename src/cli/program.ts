import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { registerCommands } from './commands/index.js';
import { runInteractive } from './interactive.js';

declare const __SEA_VERSION__: string | undefined;

function readPackageVersion(): string {
  if (typeof __SEA_VERSION__ !== 'undefined') return __SEA_VERSION__;
  const cliDir = dirname(fileURLToPath(import.meta.url));
  const packagePath = join(cliDir, '..', '..', 'package.json');
  const pkg = JSON.parse(readFileSync(packagePath, 'utf-8')) as { version: string };
  return pkg.version;
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('hydraz')
    .description('An opinionated CLI for autonomous, multi-process coding swarms')
    .version(readPackageVersion())
    .action(async () => {
      await runInteractive();
    });

  registerCommands(program);

  return program;
}
