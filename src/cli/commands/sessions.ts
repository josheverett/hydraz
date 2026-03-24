import type { Command } from 'commander';
import { detectRepo } from '../../core/repo/detect.js';
import { listSessions } from '../../core/sessions/index.js';

export function registerSessionsCommand(program: Command): void {
  program
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
