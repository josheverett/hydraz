import type { Command } from 'commander';
import { detectRepo } from '../../core/repo/detect.js';
import { runSandbox } from '../../core/orchestration/sandbox.js';
import { setVerbose } from '../../core/debug.js';

export function registerSandboxCommand(program: Command): void {
  program
    .command('sandbox')
    .description('Set up a container workspace and drop into an interactive shell')
    .option('--container', 'Run locally in a container')
    .option('--cloud', 'Run in cloud')
    .option('--verbose', 'Print detailed debug output to stderr')
    .option('--no-cleanup', 'Leave workspace alive after exiting the shell')
    .option('--branch <name>', 'Override the branch cloned into the container')
    .action(async (options: {
      container?: boolean;
      cloud?: boolean;
      verbose?: boolean;
      cleanup?: boolean;
      branch?: string;
    }) => {
      if (options.verbose) {
        setVerbose(true);
      }

      if (!options.container && !options.cloud) {
        console.error('\nSandbox requires --container or --cloud.\n');
        process.exitCode = 1;
        return;
      }

      const repo = detectRepo();
      if (!repo) {
        console.error('Not in a git repository.');
        return;
      }

      const executionTarget = options.cloud
        ? 'cloud' as const
        : 'local-container' as const;

      console.log(`\nHydraz Sandbox (${executionTarget})\n`);

      const result = await runSandbox({
        executionTarget,
        repoRoot: repo.root,
        cleanup: options.cleanup !== false,
        branchOverride: options.branch,
        onStep: (step) => {
          const detail = step.detail ? ` (${step.detail})` : '';
          const timing = step.durationMs ? `    [${Math.round(step.durationMs / 1000)}s]` : '';
          console.log(`  ${step.name.padEnd(17)}${step.status}${detail}${timing}`);
        },
      });

      if (!result.entered) {
        console.log('\n  Result: FAIL\n');
        process.exitCode = 1;
        return;
      }

      if (result.workspaceName && options.cleanup === false) {
        console.log(`\n  Workspace kept alive: ${result.workspaceName}`);
        console.log(`  Reconnect with: devpod ssh ${result.workspaceName}\n`);
      }
    });
}
