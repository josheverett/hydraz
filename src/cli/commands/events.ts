import type { Command } from 'commander';
import { detectRepo } from '../../core/repo/detect.js';
import { findSessionByName, getActiveSessions } from '../../core/sessions/index.js';
import { readEvents, formatEvent } from '../../core/events/index.js';

export function registerEventsCommand(program: Command): void {
  program
    .command('events')
    .description('Show structured framework-level event history')
    .argument('[session]', 'Session name (uses active session if not provided)')
    .action(async (sessionName?: string) => {
      const repo = detectRepo();
      if (!repo) {
        console.error('Not in a git repository.');
        return;
      }

      let sessionId: string | null = null;

      if (sessionName) {
        const session = findSessionByName(repo.root, sessionName);
        if (!session) {
          console.error(`Session "${sessionName}" not found.`);
          return;
        }
        sessionId = session.id;
      } else {
        const active = getActiveSessions(repo.root);
        if (active.length === 0) {
          console.log('\nNo active sessions.\n');
          return;
        }
        sessionId = active[0].id;
      }

      const events = readEvents(repo.root, sessionId);

      if (events.length === 0) {
        console.log('\nNo events recorded.\n');
        return;
      }

      console.log();
      for (const event of events) {
        console.log(`  ${formatEvent(event)}`);
      }
      console.log();
    });
}
