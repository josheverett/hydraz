import type { Command } from 'commander';
import { detectRepo } from '../../core/repo/detect.js';
import { runHelloWorld, formatHelloWorldReport } from '../../core/orchestration/hello-world.js';

export function registerHelloWorldCommand(program: Command): void {
  program
    .command('hello-world')
    .description('Run a hello-world sanity check to verify infrastructure')
    .option('--local', 'Run locally (bare metal)')
    .option('--container', 'Run locally in a container')
    .option('--cloud', 'Run in cloud')
    .action(async (options: {
      local?: boolean;
      container?: boolean;
      cloud?: boolean;
    }) => {
      const repo = detectRepo();
      if (!repo) {
        console.error('Not in a git repository.');
        return;
      }

      const executionTarget = options.cloud
        ? 'cloud' as const
        : options.container
          ? 'local-container' as const
          : 'local' as const;

      console.log(`\nHydraz Hello World (${executionTarget})\n`);

      const result = await runHelloWorld({
        executionTarget,
        repoRoot: repo.root,
        onStep: (step) => {
          const detail = step.detail ? ` (${step.detail})` : '';
          console.log(`  ${step.name.padEnd(17)}${step.status}${detail}`);
        },
      });

      console.log(`\n  Result: ${result.passed ? 'PASS' : 'FAIL'}\n`);

      if (!result.passed) {
        process.exitCode = 1;
      }
    });
}
