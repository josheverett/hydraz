import type { Command } from 'commander';
import { confirm } from '@inquirer/prompts';
import { detectRepo } from '../../core/repo/detect.js';
import {
  findAllOrphanedWorkspaces,
  destroyOrphanedWorkspace,
} from '../../core/orchestration/index.js';

export function registerCleanCommand(program: Command): void {
  program
    .command('clean')
    .description('Clean up orphaned DevPod workspaces from completed/stopped/failed sessions')
    .option('--force', 'Skip confirmation prompt')
    .option('--dry-run', 'List orphans without destroying')
    .action(async (options: { force?: boolean; dryRun?: boolean }) => {
      const repo = detectRepo();
      if (!repo) {
        console.error('Not in a git repository.');
        return;
      }

      const { known, unknown, total } = findAllOrphanedWorkspaces(repo.root);

      if (total === 0) {
        console.log('\nNo orphaned DevPod workspaces found.\n');
        return;
      }

      if (known.length > 0) {
        console.log(`\nOrphaned workspaces with known sessions (${known.length}):\n`);
        for (const orphan of known) {
          console.log(
            `  ${orphan.sessionName.padEnd(30)} ${orphan.workspaceName.padEnd(35)} ` +
            `[${orphan.sessionState}]  DevPod: ${orphan.devpodStatus}`,
          );
        }
      }

      if (unknown.length > 0) {
        console.log(`\nOrphaned workspaces with no matching session (${unknown.length}):\n`);
        for (const orphan of unknown) {
          console.log(
            `  ${'(unknown)'.padEnd(30)} ${orphan.workspaceName.padEnd(35)} ` +
            `DevPod: ${orphan.devpodStatus}`,
          );
        }
      }

      console.log(`\nTotal: ${total} orphaned workspace${total > 1 ? 's' : ''}`);

      if (options.dryRun) {
        console.log('Dry run — no workspaces destroyed.\n');
        return;
      }

      if (!options.force) {
        const ok = await confirm({
          message: `Destroy ${total} orphaned workspace${total > 1 ? 's' : ''}?`,
          default: false,
        });
        if (!ok) {
          console.log('Cancelled.\n');
          return;
        }
      }

      const allWorkspaceNames = [
        ...known.map(o => o.workspaceName),
        ...unknown.map(o => o.workspaceName),
      ];

      let destroyed = 0;
      for (const name of allWorkspaceNames) {
        try {
          destroyOrphanedWorkspace(name);
          console.log(`  ✓ Destroyed ${name}`);
          destroyed++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`  ✗ Failed to destroy ${name}: ${msg}`);
        }
      }

      console.log(`\nCleaned up ${destroyed}/${total} workspace${total > 1 ? 's' : ''}.\n`);
    });
}
