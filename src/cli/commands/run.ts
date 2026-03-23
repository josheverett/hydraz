import type { Command } from 'commander';

export function registerRunCommand(program: Command): void {
  program
    .command('run')
    .description('Launch a task directly (non-interactive)')
    .argument('<task>', 'Task description or issue URL')
    .option('--session <name>', 'Session name')
    .option('--branch <name>', 'Branch name')
    .option('--local', 'Run locally')
    .option('--cloud', 'Run in cloud')
    .action(async (task: string, options: Record<string, unknown>) => {
      console.log(`hydraz run is not yet implemented. Task: ${task}`);
      if (Object.keys(options).length > 0) {
        console.log('Options:', JSON.stringify(options, null, 2));
      }
    });
}
