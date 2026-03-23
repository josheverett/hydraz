import { select } from '@inquirer/prompts';
import { detectRepo } from '../core/repo/detect.js';

export async function runInteractive(): Promise<void> {
  const repo = detectRepo();

  if (!repo) {
    console.error('Not in a git repository. Run hydraz from a repository root.');
    process.exit(1);
    return;
  }

  console.log(`\nHydraz — ${repo.name}\n`);

  const choice = await select({
    message: 'What would you like to do?',
    choices: [
      { name: 'Start new session', value: 'new' },
      { name: 'Attach to existing session', value: 'attach' },
      { name: 'Review completed session', value: 'review' },
      { name: 'Config', value: 'config' },
    ],
  });

  console.log(`\n${choice} is not yet implemented.\n`);
}
