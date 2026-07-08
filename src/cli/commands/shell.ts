import type { Command } from 'commander';
import { detectRepo } from '../../core/repo/detect.js';
import { findSessionByName } from '../../core/sessions/index.js';
import { devpodSsh } from '../../core/providers/devpod.js';

export function registerShellCommand(program: Command): void {
  program
    .command('shell')
    .description('Open a shell in a preserved Hydraz workspace')
    .argument('<session>', 'Session name')
    .action(async (sessionName: string) => {
      const repo = detectRepo();
      if (!repo) {
        console.error('Not in a git repository.');
        return;
      }

      const session = findSessionByName(repo.root, sessionName);
      if (!session) {
        console.error(`Session "${sessionName}" not found.`);
        return;
      }

      if (session.executionTarget === 'local') {
        console.log(session.workspaceDir ?? 'No local workspace recorded.');
        return;
      }

      await devpodSsh(`hydraz-${session.id}`);
    });
}
