import type { Command } from 'commander';
import { select } from '@inquirer/prompts';
import { detectRepo } from '../../core/repo/detect.js';
import { listSessions, findSessionByName, isTerminalState } from '../../core/sessions/index.js';
import { resumeSession } from '../../core/orchestration/index.js';

export function registerResumeCommand(program: Command): void {
  program
    .command('resume')
    .description('Resume a paused, interrupted, or blocked session')
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

        console.log(`\nResuming session "${sessionName}"...\n`);
        await resumeSession(session.id, repo.root, {
          onStreamLine: (line) => console.log(line),
          onError: (msg) => console.error(msg),
        });
        return;
      }

      const resumable = listSessions(repo.root).filter(
        (s) => s.state !== 'completed' && (isTerminalState(s.state) || s.state !== 'created'),
      );

      if (resumable.length === 0) {
        console.log('\nNo sessions available to resume.\n');
        return;
      }

      const chosen = await select({
        message: 'Select session to resume',
        choices: resumable.map((s) => ({
          name: `${s.name} [${s.state}]${s.blockerMessage ? ` — ${s.blockerMessage}` : ''}`,
          value: s.id,
        })),
      });

      const session = resumable.find((s) => s.id === chosen)!;
      console.log(`\nResuming session "${session.name}"...\n`);
      await resumeSession(chosen, repo.root, {
        onStreamLine: (line) => console.log(line),
        onError: (msg) => console.error(msg),
      });
    });
}
