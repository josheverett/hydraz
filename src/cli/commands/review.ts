import type { Command } from 'commander';

export function registerReviewCommand(program: Command): void {
  program
    .command('review')
    .description('Review-ready summary of a session\'s outcome')
    .argument('[session]', 'Session name (uses active session if not provided)')
    .action(async (session?: string) => {
      console.log('hydraz review is not yet implemented.');
    });
}
