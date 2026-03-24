import type { Command } from 'commander';
import { select } from '@inquirer/prompts';
import { detectRepo } from '../../core/repo/detect.js';
import { getActiveSessions, findSessionByName, type SessionMetadata } from '../../core/sessions/index.js';
import { readEvents, formatEvent } from '../../core/events/index.js';

export function registerAttachCommand(program: Command): void {
  program
    .command('attach')
    .description('Attach to an existing session in the current repo')
    .argument('[session]', 'Session name (prompted if not provided)')
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
          console.log('\nNo active sessions to attach to.\n');
          return;
        }

        const chosen = await select({
          message: 'Select session to attach to',
          choices: active.map((s) => ({
            name: `${s.name} [${s.state}] → ${s.branchName}`,
            value: s.id,
          })),
        });

        session = active.find((s) => s.id === chosen)!;
      }

      renderAttachView(session, repo.root);
    });
}

function renderAttachView(session: SessionMetadata, repoRoot: string): void {
  console.log(`\n  Session:    ${session.name}`);
  console.log(`  Branch:     ${session.branchName}`);
  console.log(`  State:      ${session.state}`);
  console.log(`  Target:     ${session.executionTarget}`);
  console.log(`  Personas:   ${session.personas.join(', ')}`);
  console.log(`  Task:       ${session.task}`);

  if (session.blockerMessage) {
    console.log(`  Blocker:    ${session.blockerMessage}`);
  }

  const events = readEvents(repoRoot, session.id);
  if (events.length > 0) {
    console.log('\n  Recent events:');
    const recent = events.slice(-5);
    for (const event of recent) {
      console.log(`    ${formatEvent(event)}`);
    }
  }

  console.log();
}
