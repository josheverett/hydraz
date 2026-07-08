import type { Command } from 'commander';
import { confirm } from '@inquirer/prompts';
import { detectRepo } from '../../core/repo/detect.js';
import { clearRepoSessions, listSessions } from '../../core/sessions/index.js';

interface ClearSessionsOptions {
  force?: boolean;
  dryRun?: boolean;
}

export function registerSessionsCommand(program: Command): void {
  const sessions = program
    .command('sessions')
    .description('List active, resumable, and completed sessions in the current repo')
    .action(async () => {
      const repo = detectRepo();
      if (!repo) {
        console.error('Not in a git repository.');
        return;
      }

      const sessions = listSessions(repo.root);

      if (sessions.length === 0) {
        console.log('\nNo sessions found in this repo.\n');
        return;
      }

      console.log(`\nSessions in ${repo.name}:\n`);
      for (const s of sessions) {
        const age = timeSince(s.updatedAt);
        console.log(`  ${s.name.padEnd(30)} ${s.branchName.padEnd(35)} [${s.state}]  ${age}`);
      }
      console.log();
    });

  sessions
    .command('clear')
    .description('Clear all local Hydraz sessions for the current repo')
    .option('--force', 'Skip confirmation prompt')
    .option('--dry-run', 'List sessions without clearing')
    .action(async (options: ClearSessionsOptions) => {
      const repo = detectRepo();
      if (!repo) {
        console.error('Not in a git repository.');
        return;
      }

      const sessionsToClear = listSessions(repo.root);
      if (sessionsToClear.length === 0) {
        console.log('\nNo sessions found in this repo.\n');
        return;
      }

      console.log(`\nSessions to clear in ${repo.name} (${sessionsToClear.length}):\n`);
      for (const s of sessionsToClear) {
        console.log(`  ${s.name.padEnd(30)} ${s.branchName.padEnd(35)} [${s.state}]`);
      }

      if (options.dryRun) {
        console.log('\nDry run - no sessions cleared.\n');
        return;
      }

      if (!options.force) {
        const ok = await confirm({
          message: `Clear ${sessionsToClear.length} session${sessionsToClear.length > 1 ? 's' : ''}?`,
          default: false,
        });
        if (!ok) {
          console.log('\nCancelled.\n');
          return;
        }
      }

      const result = clearRepoSessions(repo.root);
      console.log(
        `\nCleared ${result.sessions} session${result.sessions === 1 ? '' : 's'} ` +
        `and ${result.workspaces} local workspace director${result.workspaces === 1 ? 'y' : 'ies'}.\n`,
      );
      console.log('Run `hydraz clean --force` to remove orphaned DevPod workspaces/VMs.\n');
    });
}

function timeSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
