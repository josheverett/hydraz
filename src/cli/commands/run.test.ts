import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectRepo } from '../../core/repo/detect.js';
import {
  configExists,
  initializeConfigDir,
  loadConfig,
} from '../../core/config/index.js';
import {
  createNewSession,
  initRepoState,
} from '../../core/sessions/index.js';
import { appendEvent, createEvent } from '../../core/events/index.js';
import { startSession } from '../../core/orchestration/index.js';
import { registerRunCommand } from './run.js';

vi.mock('../../core/repo/detect.js', () => ({
  detectRepo: vi.fn(),
}));

vi.mock('../../core/config/index.js', () => ({
  configExists: vi.fn(),
  initializeConfigDir: vi.fn(),
  loadConfig: vi.fn(),
}));

vi.mock('../../core/sessions/index.js', () => ({
  createNewSession: vi.fn(),
  initRepoState: vi.fn(),
  SessionError: class SessionError extends Error {},
}));

vi.mock('../../core/events/index.js', () => ({
  appendEvent: vi.fn(),
  createEvent: vi.fn(() => ({ type: 'session.created' })),
}));

vi.mock('../../core/orchestration/index.js', () => ({
  startSession: vi.fn(async () => {}),
}));

vi.mock('../../core/debug.js', () => ({
  setVerbose: vi.fn(),
}));

const testConfig = {
  executionTarget: 'cloud' as const,
  branchNaming: { prefix: 'hydraz/' },
  github: {},
  codex: {
    command: 'codex',
    model: 'gpt-5.6-sol',
    reasoningEffort: 'ultra' as const,
    speed: 'fast' as const,
    sandbox: 'workspace-write' as const,
    search: false,
  },
  retention: { keepTranscripts: false, keepTestLogs: false },
  displayVerbosity: 'compact' as const,
};

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  registerRunCommand(program);
  return program;
}

describe('run command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(detectRepo).mockReturnValue({ root: '/repo', name: 'repo' });
    vi.mocked(configExists).mockReturnValue(true);
    vi.mocked(loadConfig).mockReturnValue(testConfig);
    vi.mocked(createNewSession).mockImplementation((params: any) => ({
      id: 'session-1',
      name: params.name,
      repoRoot: params.repoRoot,
      branchName: params.branchName,
      baseBranch: params.baseBranch,
      executionTarget: params.executionTarget,
      task: params.task,
      state: 'created',
      createdAt: '2026-07-08T00:00:00.000Z',
      updatedAt: '2026-07-08T00:00:00.000Z',
    }));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stores and starts with the configured base branch', async () => {
    const program = makeProgram();

    await program.parseAsync(['node', 'hydraz', 'run', '--base', 'staging', '--session', 'demo', 'Do it']);

    expect(createNewSession).toHaveBeenCalledWith(expect.objectContaining({
      baseBranch: 'staging',
      branchName: 'hydraz/demo',
    }));
    expect(startSession).toHaveBeenCalledWith(
      'session-1',
      '/repo',
      expect.any(Object),
      expect.objectContaining({ baseBranch: 'staging' }),
    );
    expect(console.log).toHaveBeenCalledWith('Base: staging');
    expect(initRepoState).toHaveBeenCalledWith('/repo');
    expect(createEvent).toHaveBeenCalled();
    expect(appendEvent).toHaveBeenCalled();
  });

  it('rejects invalid base branch names', async () => {
    const program = makeProgram();

    await program.parseAsync(['node', 'hydraz', 'run', '--base', 'bad branch', 'Do it']);

    expect(console.error).toHaveBeenCalledWith('Invalid base branch: "bad branch". Branch names must not contain shell metacharacters.');
    expect(createNewSession).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
    expect(initializeConfigDir).not.toHaveBeenCalled();
  });
});
