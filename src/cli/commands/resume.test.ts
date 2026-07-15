import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectRepo } from '../../core/repo/detect.js';
import { findSessionByName } from '../../core/sessions/index.js';
import { resumeSession } from '../../core/orchestration/index.js';
import { registerResumeCommand } from './resume.js';

vi.mock('../../core/repo/detect.js', () => ({
  detectRepo: vi.fn(),
}));

vi.mock('../../core/sessions/index.js', () => ({
  findSessionByName: vi.fn(),
  listSessions: vi.fn(() => []),
}));

vi.mock('../../core/orchestration/index.js', () => ({
  resumeSession: vi.fn(async () => {}),
}));

vi.mock('../../core/debug.js', () => ({
  setVerbose: vi.fn(),
}));

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  registerResumeCommand(program);
  return program;
}

describe('resume command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(detectRepo).mockReturnValue({ root: '/repo', name: 'repo' });
    vi.mocked(findSessionByName).mockReturnValue({
      id: 'session-1',
      name: 'demo',
      repoRoot: '/repo',
      branchName: 'hydraz/demo',
      executionTarget: 'cloud',
      task: 'Do it',
      state: 'failed',
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes managed Codex overrides to the controller', async () => {
    const program = makeProgram();

    await expect(program.parseAsync([
      'node',
      'hydraz',
      'resume',
      'demo',
      'Continue',
      '--model',
      'gpt-5.5',
      '--reasoning-effort',
      'low',
      '--speed',
      'standard',
    ])).resolves.toBeDefined();

    expect(resumeSession).toHaveBeenCalledWith(
      'session-1',
      '/repo',
      expect.any(Object),
      expect.objectContaining({
        prompt: 'Continue',
        model: 'gpt-5.5',
        reasoningEffort: 'low',
        speed: 'standard',
      }),
    );
  });

  it.each([
    ['--reasoning-effort', 'impossible', 'Invalid reasoning effort: "impossible".'],
    ['--speed', 'ludicrous', 'Invalid Codex speed: "ludicrous". Use standard or fast.'],
  ])('rejects an invalid %s value', async (flag, value, message) => {
    const program = makeProgram();

    await program.parseAsync(['node', 'hydraz', 'resume', 'demo', 'Continue', flag, value]);

    expect(console.error).toHaveBeenCalledWith(message);
    expect(resumeSession).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only model override', async () => {
    const program = makeProgram();

    await program.parseAsync([
      'node',
      'hydraz',
      'resume',
      'demo',
      'Continue',
      '--model',
      '   ',
    ]);

    expect(console.error).toHaveBeenCalledWith(
      'Invalid Codex model: expected a non-empty value.',
    );
    expect(resumeSession).not.toHaveBeenCalled();
  });
});
