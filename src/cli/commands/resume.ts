import type { Command } from 'commander';
import { select } from '@inquirer/prompts';
import { detectRepo } from '../../core/repo/detect.js';
import { listSessions, findSessionByName } from '../../core/sessions/index.js';
import { resumeSession } from '../../core/orchestration/index.js';
import { setVerbose } from '../../core/debug.js';
import {
  CODEX_REASONING_EFFORTS,
  CODEX_SPEEDS,
  type CodexReasoningEffort,
  type CodexSpeed,
} from '../../core/config/index.js';

export function registerResumeCommand(program: Command): void {
  program
    .command('resume')
    .description('Resume a preserved Codex session with a follow-up prompt')
    .argument('[session]', 'Session name (prompted if not provided)')
    .argument('[prompt]', 'Prompt to send to codex exec resume')
    .option('--model <model>', 'Codex model override')
    .option('--reasoning-effort <effort>', 'Codex reasoning effort override')
    .option('--speed <speed>', 'Codex speed override: standard or fast')
    .option('--verbose', 'Enable diagnostic output')
    .action(async (
      sessionName: string | undefined,
      prompt: string | undefined,
      options: {
        model?: string;
        reasoningEffort?: CodexReasoningEffort;
        speed?: CodexSpeed;
        verbose?: boolean;
      },
    ) => {
      if (options.verbose) setVerbose(true);

      const repo = detectRepo();
      if (!repo) {
        console.error('Not in a git repository.');
        return;
      }

      if (!prompt?.trim()) {
        console.error('A resume prompt is required.');
        return;
      }
      if (options.model !== undefined && !options.model.trim()) {
        console.error('Invalid Codex model: expected a non-empty value.');
        return;
      }
      if (options.reasoningEffort && !CODEX_REASONING_EFFORTS.includes(options.reasoningEffort)) {
        console.error(`Invalid reasoning effort: "${options.reasoningEffort}".`);
        return;
      }
      if (options.speed && !CODEX_SPEEDS.includes(options.speed)) {
        console.error(`Invalid Codex speed: "${options.speed}". Use standard or fast.`);
        return;
      }

      if (sessionName) {
        const session = findSessionByName(repo.root, sessionName);
        if (!session) {
          console.error(`Session "${sessionName}" not found.`);
          return;
        }

        await resumeSession(session.id, repo.root, {
          onStreamLine: (line) => console.log(line),
          onError: (msg) => console.error(msg),
        }, {
          verbose: options.verbose,
          prompt,
          model: options.model?.trim(),
          reasoningEffort: options.reasoningEffort,
          speed: options.speed,
        });
        return;
      }

      const resumable = listSessions(repo.root).filter((s) => Boolean(s.codex?.threadId && s.workspaceDir));
      if (resumable.length === 0) {
        console.log('\nNo Codex sessions available to resume.\n');
        return;
      }

      const chosen = await select({
        message: 'Select session to resume',
        choices: resumable.map((s) => ({
          name: `${s.name} [${s.state}]`,
          value: s.id,
        })),
      });

      await resumeSession(chosen, repo.root, {
        onStreamLine: (line) => console.log(line),
        onError: (msg) => console.error(msg),
      }, {
        verbose: options.verbose,
        prompt,
        model: options.model?.trim(),
        reasoningEffort: options.reasoningEffort,
        speed: options.speed,
      });
    });
}
