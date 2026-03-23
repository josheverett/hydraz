import type { Command } from 'commander';
import { select } from '@inquirer/prompts';
import { detectRepo } from '../../core/repo/detect.js';
import { getActiveSessions, findSessionByName } from '../../core/sessions/index.js';
import { stopSession } from '../../core/orchestration/index.js';

export function registerStopCommand(program: Command): void {
  program
    .command('stop')
    .description('Stop an active session')
    .argument('[session]', 'Session name (prompted if not provided)')
    .action(async (sessionName?: string) => {
      const repo = detectRepo();
      if (!repo) {
        console.error('Not in a git repository.');
        return;
      }

      if (sessionName) {
        const session = findSessionByName(repo.root, sessionName);
        if (!session) {
          console.error(`Session "${sessionName}" not found.`);
          return;
        }
        stopSession(session.id, repo.root, {
          onEvent: (type, message) => console.log(`  [${type}] ${message}`),
        });
        console.log(`\nSession "${sessionName}" stopped.\n`);
        return;
      }

      const active = getActiveSessions(repo.root);
      if (active.length === 0) {
        console.log('\nNo active sessions to stop.\n');
        return;
      }

      const chosen = await select({
        message: 'Select session to stop',
        choices: active.map((s) => ({
          name: `${s.name} [${s.state}]`,
          value: s.id,
        })),
      });

      const session = active.find((s) => s.id === chosen)!;
      stopSession(chosen, repo.root, {
        onEvent: (type, message) => console.log(`  [${type}] ${message}`),
      });
      console.log(`\nSession "${session.name}" stopped.\n`);
    });
}
