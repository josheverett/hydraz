import { existsSync, readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { detectRepo } from '../../core/repo/detect.js';
import { findSessionByName } from '../../core/sessions/index.js';
import { refreshSessionStatus } from '../../core/orchestration/index.js';
import { sshExec } from '../../core/providers/devpod.js';

export function registerLogsCommand(program: Command): void {
  program
    .command('logs')
    .description('Show Codex JSONL events for a session')
    .argument('<session>', 'Session name')
    .action(async (sessionName: string) => {
      const repo = detectRepo();
      if (!repo) {
        console.error('Not in a git repository.');
        return;
      }

      const found = findSessionByName(repo.root, sessionName);
      if (!found) {
        console.error(`Session "${sessionName}" not found.`);
        return;
      }

      const session = refreshSessionStatus(found.id, repo.root);
      if (!session.codex?.eventsPath) {
        console.log('\nNo Codex event log recorded for this session.\n');
        return;
      }

      if (session.executionTarget !== 'local') {
        try {
          console.log(sshExec(`hydraz-${session.id}`, `cat ${quote(session.codex.eventsPath)}`));
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
        }
        return;
      }

      if (!existsSync(session.codex.eventsPath)) {
        console.log('\nCodex event log does not exist yet.\n');
        return;
      }
      console.log(readFileSync(session.codex.eventsPath, 'utf-8'));
    });
}

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
