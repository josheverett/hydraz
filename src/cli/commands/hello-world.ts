import type { Command } from 'commander';
import { detectRepo } from '../../core/repo/detect.js';
import { runHelloWorld, formatHelloWorldReport } from '../../core/orchestration/hello-world.js';
import { setVerbose } from '../../core/debug.js';

export function registerHelloWorldCommand(program: Command): void {
  program
    .command('hello-world')
    .description('Run a hello-world sanity check to verify infrastructure')
    .option('--local', 'Run locally (bare metal)')
    .option('--container', 'Run locally in a container')
    .option('--cloud', 'Run in cloud')
    .option('--verbose', 'Print detailed debug output to stderr')
    .option('--branch <name>', 'Override the branch cloned into the container')
    .action(async (options: {
      local?: boolean;
      container?: boolean;
      cloud?: boolean;
      verbose?: boolean;
      branch?: string;
    }) => {
      if (options.verbose) {
        setVerbose(true);
      }

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
        branchOverride: options.branch,
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
