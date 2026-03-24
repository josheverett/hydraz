import type { Command } from 'commander';
import { detectRepo } from '../../core/repo/detect.js';
import {
  findSessionByName,
  getActiveSessions,
  type SessionMetadata,
} from '../../core/sessions/index.js';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show a human-readable summary of session state')
    .argument('[session]', 'Session name (uses active session if not provided)')
    .action(async (sessionName?: string) => {
      const repo = detectRepo();
      if (!repo) {
        console.error('Not in a git repository.');
        return;
      }

      let session: SessionMetadata | null = null;

      if (sessionName) {
        session = findSessionByName(repo.root, sessionName);
        if (!session) {
          console.error(`Session "${sessionName}" not found.`);
          return;
        }
      } else {
        const active = getActiveSessions(repo.root);
        if (active.length === 0) {
          console.log('\nNo active sessions.\n');
          return;
        }
        session = active[0];
      }

      renderStatus(session);
    });
}

function renderStatus(session: SessionMetadata): void {
  console.log(`\n  Session:    ${session.name}`);
  console.log(`  Branch:     ${session.branchName}`);
  console.log(`  State:      ${session.state}`);
  console.log(`  Target:     ${session.executionTarget}`);
  console.log(`  Personas:   ${session.personas.join(', ')}`);
  console.log(`  Task:       ${truncate(session.task, 80)}`);
  console.log(`  Created:    ${session.createdAt}`);
  console.log(`  Updated:    ${session.updatedAt}`);

  if (session.blockerMessage) {
    console.log(`  Blocker:    ${session.blockerMessage}`);
  }
  if (session.failureMessage) {
    console.log(`  Failure:    ${session.failureMessage}`);
  }
  console.log();
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}
