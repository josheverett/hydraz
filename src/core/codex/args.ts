import type { CodexReasoningEffort, CodexSpeed } from '../config/schema.js';

export type CodexSandbox = 'read-only' | 'workspace-write' | 'danger-full-access';

export interface CodexExecCommandOptions {
  codexCommand?: string;
  prompt: string;
  sandbox?: CodexSandbox;
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  speed?: CodexSpeed;
  search?: boolean;
  webSearchMode?: 'disabled' | 'cached' | 'live';
  skipGitRepoCheck?: boolean;
  outputLastMessagePath: string;
}

export interface CodexResumeCommandOptions extends CodexExecCommandOptions {
  threadId: string;
}

export interface BuiltCommand {
  cmd: string;
  args: string[];
}

export function buildGoalPrompt(goal: string, repoPromptContent?: string | null): string {
  const parts = [
    '# Hydraz Goal',
    '',
    'Work on this task as a persistent Codex goal. Continue until the definition of done is satisfied or a concrete blocker is reached.',
    '',
    '## Goal',
    '',
    goal.trim(),
    '',
    '## Definition of done',
    '',
    '- The requested work is implemented.',
    '- Relevant tests, type checks, and builds have been run where available.',
    '- Changes are committed on the current branch when implementation work is complete.',
    '- Any remaining blocker is documented with evidence.',
  ];

  if (repoPromptContent?.trim()) {
    parts.push('', '## Repo-Specific Hydraz Instructions', '', repoPromptContent.trim());
  }

  return parts.join('\n');
}

function baseArgs(options: CodexExecCommandOptions): string[] {
  const args = ['--json', '--sandbox', options.sandbox ?? 'workspace-write'];
  if (options.skipGitRepoCheck) {
    args.push('--skip-git-repo-check');
  }
  if (options.model) {
    args.push('--model', options.model);
  }
  if (options.reasoningEffort) {
    args.push('-c', `model_reasoning_effort=${JSON.stringify(options.reasoningEffort)}`);
  }
  if (options.speed) {
    const fast = options.speed === 'fast';
    args.push('-c', `features.fast_mode=${fast}`);
    args.push('-c', `service_tier=${JSON.stringify(fast ? 'priority' : 'default')}`);
  }
  if (options.search !== false) {
    args.push('-c', `web_search_mode=${JSON.stringify(options.webSearchMode ?? 'live')}`);
  }
  args.push('-o', options.outputLastMessagePath);
  return args;
}

export function buildCodexExecCommand(options: CodexExecCommandOptions): BuiltCommand {
  return {
    cmd: options.codexCommand ?? 'codex',
    args: ['exec', ...baseArgs(options), options.prompt],
  };
}

export function buildCodexResumeCommand(options: CodexResumeCommandOptions): BuiltCommand {
  return {
    cmd: options.codexCommand ?? 'codex',
    args: ['exec', ...baseArgs(options), 'resume', options.threadId, options.prompt],
  };
}
