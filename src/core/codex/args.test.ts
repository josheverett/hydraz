import { describe, expect, it } from 'vitest';
import {
  buildCodexExecCommand,
  buildCodexResumeCommand,
  buildGoalPrompt,
} from './args.js';

describe('buildGoalPrompt', () => {
  it('wraps the requested work as a goal-shaped Codex task', () => {
    const prompt = buildGoalPrompt('Ship v3 and keep tests green', 'Repo note.');

    expect(prompt).toContain('Ship v3 and keep tests green');
    expect(prompt).toContain('Definition of done');
    expect(prompt).toContain('Repo note.');
  });
});

describe('buildCodexExecCommand', () => {
  it('builds the default detached exec command', () => {
    const command = buildCodexExecCommand({
      prompt: 'Do the work',
      outputLastMessagePath: '/tmp/final.md',
    });

    expect(command).toEqual({
      cmd: 'codex',
      args: [
        'exec',
        '--json',
        '--sandbox',
        'workspace-write',
        '-c',
        'web_search_mode="live"',
        '-o',
        '/tmp/final.md',
        'Do the work',
      ],
    });
  });

  it('includes model and live search config when requested', () => {
    const command = buildCodexExecCommand({
      prompt: 'Research and fix',
      outputLastMessagePath: '/tmp/final.md',
      model: 'gpt-5.5',
      search: true,
    });

    expect(command.args).toContain('--model');
    expect(command.args).toContain('gpt-5.5');
    expect(command.args).not.toContain('--search');
    expect(command.args).toContain('-c');
    expect(command.args).toContain('web_search_mode="live"');
  });

  it('omits live search config when search is false', () => {
    const command = buildCodexExecCommand({
      prompt: 'Research and fix',
      outputLastMessagePath: '/tmp/final.md',
      search: false,
    });

    expect(command.args).not.toContain('--search');
    expect(command.args).not.toContain('-c');
    expect(command.args).not.toContain('web_search_mode="live"');
  });

  it('includes skip git repo check when requested', () => {
    const command = buildCodexExecCommand({
      prompt: 'Do the work',
      outputLastMessagePath: '/tmp/final.md',
      skipGitRepoCheck: true,
    });

    expect(command.args).toContain('--skip-git-repo-check');
  });

  it('respects a custom codex command path and sandbox', () => {
    const command = buildCodexExecCommand({
      codexCommand: '/opt/bin/codex',
      prompt: 'Do the work',
      outputLastMessagePath: '/tmp/final.md',
      sandbox: 'danger-full-access',
    });

    expect(command.cmd).toBe('/opt/bin/codex');
    expect(command.args).toContain('danger-full-access');
  });
});

describe('buildCodexResumeCommand', () => {
  it('builds a resume command against a stored thread id', () => {
    const command = buildCodexResumeCommand({
      threadId: '0199a213-81c0-7800-8aa1-bbab2a035a53',
      prompt: 'Continue from there',
      outputLastMessagePath: '/tmp/final.md',
    });

    expect(command).toEqual({
      cmd: 'codex',
      args: [
        'exec',
        '--json',
        '--sandbox',
        'workspace-write',
        '-c',
        'web_search_mode="live"',
        '-o',
        '/tmp/final.md',
        'resume',
        '0199a213-81c0-7800-8aa1-bbab2a035a53',
        'Continue from there',
      ],
    });
  });
});
