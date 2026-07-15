import { describe, expect, it } from 'vitest';
import {
  buildCodexExecCommand,
  buildCodexResumeCommand,
  buildGoalPrompt,
} from './args.js';

const MANAGED_MODEL = {
  model: 'gpt-5.6-sol',
  reasoningEffort: 'ultra' as const,
  speed: 'fast' as const,
};

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
      ...MANAGED_MODEL,
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
        '--model',
        'gpt-5.6-sol',
        '-c',
        'model_reasoning_effort="ultra"',
        '-c',
        'features.fast_mode=true',
        '-c',
        'service_tier="priority"',
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
      reasoningEffort: 'high',
      speed: 'fast',
      search: true,
    });

    expect(command.args).toContain('--model');
    expect(command.args).toContain('gpt-5.5');
    expect(command.args).toContain('model_reasoning_effort="high"');
    expect(command.args).toContain('features.fast_mode=true');
    expect(command.args).toContain('service_tier="priority"');
    expect(command.args).not.toContain('--search');
    expect(command.args).toContain('-c');
    expect(command.args).toContain('web_search_mode="live"');
  });

  it('maps standard speed to explicit non-Fast overrides', () => {
    const command = buildCodexExecCommand({
      ...MANAGED_MODEL,
      prompt: 'Research and fix',
      outputLastMessagePath: '/tmp/final.md',
      speed: 'standard',
      search: false,
    });

    expect(command.args).not.toContain('--search');
    expect(command.args).not.toContain('web_search_mode="live"');
    expect(command.args).toContain('features.fast_mode=false');
    expect(command.args).toContain('service_tier="default"');
  });

  it('includes skip git repo check when requested', () => {
    const command = buildCodexExecCommand({
      ...MANAGED_MODEL,
      prompt: 'Do the work',
      outputLastMessagePath: '/tmp/final.md',
      skipGitRepoCheck: true,
    });

    expect(command.args).toContain('--skip-git-repo-check');
  });

  it('respects a custom codex command path and sandbox', () => {
    const command = buildCodexExecCommand({
      ...MANAGED_MODEL,
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
      ...MANAGED_MODEL,
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
        '--model',
        'gpt-5.6-sol',
        '-c',
        'model_reasoning_effort="ultra"',
        '-c',
        'features.fast_mode=true',
        '-c',
        'service_tier="priority"',
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
