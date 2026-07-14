import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { registerCommands } from './commands/index.js';
import { runInteractive } from './interactive.js';
import { getDistRoot } from '../core/providers/devpod.js';
import { resolvePlaywrightRuntimeArchive } from '../core/providers/playwright-runtime.js';

declare const __HYDRAZ_VERSION__: string | undefined;

function readPackageVersion(): string {
  try {
    const cliDir = dirname(fileURLToPath(import.meta.url));
    const packagePath = join(cliDir, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(packagePath, 'utf-8')) as { version: string };
    return pkg.version;
  } catch {
    if (typeof __HYDRAZ_VERSION__ !== 'undefined') return __HYDRAZ_VERSION__;
    return 'unknown';
  }
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('hydraz')
    .description('A Codex cloud harness for detached long-running coding goals')
    .version(readPackageVersion())
    .action(async () => {
      await runInteractive();
    });

  registerCommands(program);

  const seaRunnerPayloadCommand = new Command('__sea-runner-payload')
    .description('Internal smoke check for SEA container payload availability')
    .action(() => {
      const distRoot = getDistRoot();
      const runnerPath = join(distRoot, 'core', 'codex', 'runner.js');
      if (!existsSync(runnerPath)) {
        throw new Error(`Runner payload missing: ${runnerPath}`);
      }
      const playwrightRuntimePath = resolvePlaywrightRuntimeArchive(distRoot);
      console.log(`${runnerPath}\n${playwrightRuntimePath}`);
    });
  program.addCommand(seaRunnerPayloadCommand, { hidden: true });

  return program;
}
