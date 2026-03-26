import type { Command } from 'commander';
import { confirm } from '@inquirer/prompts';
import { detectRepo } from '../../core/repo/detect.js';
import {
  findOrphanedWorkspaces,
  destroyOrphanedWorkspace,
} from '../../core/orchestration/index.js';

export function registerCleanCommand(program: Command): void {
  program
    .command('clean')
    .description('Clean up orphaned DevPod workspaces from completed/stopped/failed sessions')
    .option('--force', 'Skip confirmation prompt')
    .action(async (options: { force?: boolean }) => {
      const repo = detectRepo();
      if (!repo) {
        console.error('Not in a git repository.');
        return;
      }

      const orphans = findOrphanedWorkspaces(repo.root);

      if (orphans.length === 0) {
        console.log('\nNo orphaned DevPod workspaces found.\n');
        return;
      }

      console.log(`\nOrphaned DevPod workspaces (${orphans.length}):\n`);
      for (const orphan of orphans) {
        console.log(
          `  ${orphan.sessionName.padEnd(30)} ${orphan.workspaceName.padEnd(35)} ` +
          `[${orphan.sessionState}]  DevPod: ${orphan.devpodStatus}`,
        );
      }
      console.log();

      if (!options.force) {
        const ok = await confirm({
          message: `Destroy ${orphans.length} orphaned workspace${orphans.length > 1 ? 's' : ''}?`,
          default: false,
        });
        if (!ok) {
          console.log('Cancelled.\n');
          return;
        }
      }

      let destroyed = 0;
      for (const orphan of orphans) {
        try {
          destroyOrphanedWorkspace(orphan.workspaceName);
          console.log(`  ✓ Destroyed ${orphan.workspaceName}`);
          destroyed++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`  ✗ Failed to destroy ${orphan.workspaceName}: ${msg}`);
        }
      }

      console.log(`\nCleaned up ${destroyed}/${orphans.length} workspace${orphans.length > 1 ? 's' : ''}.\n`);
    });
}
