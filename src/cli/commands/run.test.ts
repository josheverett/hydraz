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
import { GoalInputError, resolveGoalInput } from '../goal-input.js';
import { registerRunCommand } from './run.js';

vi.mock('../../core/repo/detect.js', () => ({
  detectRepo: vi.fn(),
}));

vi.mock('../../core/config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/config/index.js')>();
  return {
    ...actual,
    configExists: vi.fn(),
    initializeConfigDir: vi.fn(),
    loadConfig: vi.fn(),
  };
});

vi.mock('../../core/sessions/index.js', () => ({
  createNewSession: vi.fn(),
  initRepoState: vi.fn(),
  DEFAULT_CLOUD_MAX_RUNTIME: '24h',
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

vi.mock('../goal-input.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../goal-input.js')>();
  return {
    ...actual,
    resolveGoalInput: vi.fn(),
  };
});

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
    vi.mocked(resolveGoalInput).mockImplementation((goal) => ({
      content: goal ?? '',
      source: {
        kind: 'inline',
        byteLength: Buffer.byteLength(goal ?? '', 'utf8'),
        sha256: 'inline-sha',
      },
    }));
    vi.mocked(createNewSession).mockImplementation((params: any) => ({
      id: 'session-1',
      name: params.name,
      repoRoot: params.repoRoot,
      branchName: params.branchName,
      baseBranch: params.baseBranch,
      executionTarget: params.executionTarget,
      task: params.task,
      taskSource: params.taskSource,
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

  it('pins the 24h default maximum runtime for cloud sessions', async () => {
    const program = makeProgram();

    await program.parseAsync(['node', 'hydraz', 'run', '--session', 'demo', 'Do it']);

    expect(createNewSession).toHaveBeenCalledWith(expect.objectContaining({
      executionTarget: 'cloud',
      maxRuntime: '24h',
    }));
    expect(console.log).toHaveBeenCalledWith('Max runtime: 24h');
  });

  it('stores goal-file content and provenance in the session', async () => {
    vi.mocked(resolveGoalInput).mockReturnValueOnce({
      content: '# File goal\n',
      source: {
        kind: 'file',
        label: '/tmp/my goal.md',
        byteLength: 12,
        sha256: 'file-sha',
      },
    });

    await makeProgram().parseAsync([
      'node',
      'hydraz',
      'run',
      '--goal-file',
      '/tmp/my goal.md',
      '--session',
      'demo',
    ]);

    expect(resolveGoalInput).toHaveBeenCalledWith(undefined, '/tmp/my goal.md');
    expect(createNewSession).toHaveBeenCalledWith(expect.objectContaining({
      task: '# File goal\n',
      taskSource: {
        kind: 'file',
        label: '/tmp/my goal.md',
        byteLength: 12,
        sha256: 'file-sha',
      },
    }));
    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('file /tmp/my goal.md');
    expect(output).not.toContain('# File goal');
  });

  it('keeps a concise positional goal recognizable in startup output', async () => {
    await makeProgram().parseAsync([
      'node',
      'hydraz',
      'run',
      '--session',
      'demo',
      'Do it',
    ]);

    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain(
      'Goal: Do it',
    );
  });

  it('stores stdin content and provenance in the session', async () => {
    vi.mocked(resolveGoalInput).mockReturnValueOnce({
      content: '# Stdin goal\n',
      source: {
        kind: 'stdin',
        byteLength: 13,
        sha256: 'stdin-sha',
      },
    });

    await makeProgram().parseAsync([
      'node',
      'hydraz',
      'run',
      '--goal-file',
      '-',
      '--session',
      'demo',
    ]);

    expect(resolveGoalInput).toHaveBeenCalledWith(undefined, '-');
    expect(createNewSession).toHaveBeenCalledWith(expect.objectContaining({
      task: '# Stdin goal\n',
      taskSource: expect.objectContaining({ kind: 'stdin' }),
    }));
  });

  it.each([
    {
      kind: 'file',
      goalFile: '/tmp/private-goal.md',
      source: {
        kind: 'file' as const,
        label: '/tmp/private-goal.md',
        byteLength: 20,
        sha256: 'file-sha',
      },
    },
    {
      kind: 'stdin',
      goalFile: '-',
      source: {
        kind: 'stdin' as const,
        byteLength: 21,
        sha256: 'stdin-sha',
      },
    },
  ])('uses an opaque default name for $kind goals', async ({ goalFile, source }) => {
    const content = `TOP_SECRET_${source.kind.toUpperCase()}_GOAL`;
    vi.mocked(resolveGoalInput).mockReturnValueOnce({ content, source });

    await makeProgram().parseAsync(['node', 'hydraz', 'run', '--goal-file', goalFile]);

    const params = vi.mocked(createNewSession).mock.calls[0]![0];
    expect(params.name).toMatch(/^session-[a-z0-9]{4}$/);
    expect(params.branchName).toBe(`hydraz/${params.name}`);
    expect(params.name).not.toContain('top-secret');
  });

  it('preserves content-derived default names for inline goals', async () => {
    await makeProgram().parseAsync(['node', 'hydraz', 'run', 'Keep inline recognizable']);

    const params = vi.mocked(createNewSession).mock.calls[0]![0];
    expect(params.name).toMatch(/^keep-inline-recognizable-[a-z0-9]{4}$/);
    expect(params.branchName).toBe(`hydraz/${params.name}`);
  });

  it('preserves explicit session and branch names for file goals', async () => {
    vi.mocked(resolveGoalInput).mockReturnValueOnce({
      content: 'TOP_SECRET_FILE_GOAL',
      source: {
        kind: 'file',
        label: '/tmp/private-goal.md',
        byteLength: 20,
        sha256: 'file-sha',
      },
    });

    await makeProgram().parseAsync([
      'node',
      'hydraz',
      'run',
      '--goal-file',
      '/tmp/private-goal.md',
      '--session',
      'explicit-session',
      '--branch',
      'explicit/branch',
    ]);

    expect(createNewSession).toHaveBeenCalledWith(expect.objectContaining({
      name: 'explicit-session',
      branchName: 'explicit/branch',
    }));
  });

  it.each([
    {
      label: 'neither input',
      argv: ['--session', 'demo'],
    },
    {
      label: 'both inputs',
      argv: ['--goal-file', '/tmp/goal.md', '--session', 'demo', 'Inline goal'],
    },
  ])('reports goal input errors for $label', async ({ argv }) => {
    vi.mocked(resolveGoalInput).mockImplementationOnce(() => {
      throw new GoalInputError(
        'Provide exactly one goal: a positional goal or --goal-file <path>.',
      );
    });

    await makeProgram().parseAsync(['node', 'hydraz', 'run', ...argv]);

    expect(console.error).toHaveBeenCalledWith(
      'Provide exactly one goal: a positional goal or --goal-file <path>.',
    );
    expect(createNewSession).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
  });

  it('pins an explicit maximum runtime for cloud sessions', async () => {
    const program = makeProgram();

    await program.parseAsync([
      'node',
      'hydraz',
      'run',
      '--cloud',
      '--max-runtime',
      '36h',
      '--session',
      'demo',
      'Do it',
    ]);

    expect(createNewSession).toHaveBeenCalledWith(expect.objectContaining({
      executionTarget: 'cloud',
      maxRuntime: '36h',
    }));
    expect(console.log).toHaveBeenCalledWith('Max runtime: 36h');
  });

  it('accepts a compound cloud maximum runtime', async () => {
    const program = makeProgram();

    await program.parseAsync([
      'node',
      'hydraz',
      'run',
      '--max-runtime',
      '1h30m',
      '--session',
      'demo',
      'Do it',
    ]);

    expect(createNewSession).toHaveBeenCalledWith(expect.objectContaining({
      maxRuntime: '1h30m',
    }));
  });

  it('rejects an invalid cloud maximum runtime', async () => {
    const program = makeProgram();

    await program.parseAsync([
      'node',
      'hydraz',
      'run',
      '--max-runtime',
      'forever',
      'Do it',
    ]);

    expect(console.error).toHaveBeenCalledWith(
      'Invalid maximum runtime: "forever". Use a positive duration such as 90m, 12h, or 1h30m.',
    );
    expect(createNewSession).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
  });

  it('rejects a maximum runtime outside cloud mode', async () => {
    const program = makeProgram();

    await program.parseAsync([
      'node',
      'hydraz',
      'run',
      '--local',
      '--max-runtime',
      '2h',
      'Do it',
    ]);

    expect(console.error).toHaveBeenCalledWith('--max-runtime is only supported with cloud runs.');
    expect(createNewSession).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
  });

  it('rejects invalid base branch names', async () => {
    const program = makeProgram();

    await program.parseAsync(['node', 'hydraz', 'run', '--base', 'bad branch', 'Do it']);

    expect(console.error).toHaveBeenCalledWith('Invalid base branch: "bad branch". Branch names must not contain shell metacharacters.');
    expect(createNewSession).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
    expect(initializeConfigDir).not.toHaveBeenCalled();
  });

  it('passes managed Codex overrides to the controller', async () => {
    const program = makeProgram();

    await expect(program.parseAsync([
      'node',
      'hydraz',
      'run',
      '--session',
      'demo',
      '--model',
      'gpt-5.5',
      '--reasoning-effort',
      'high',
      '--speed',
      'standard',
      'Do it',
    ])).resolves.toBeDefined();

    expect(startSession).toHaveBeenCalledWith(
      'session-1',
      '/repo',
      expect.any(Object),
      expect.objectContaining({
        model: 'gpt-5.5',
        reasoningEffort: 'high',
        speed: 'standard',
      }),
    );
  });

  it.each([
    ['--reasoning-effort', 'impossible', 'Invalid reasoning effort: "impossible".'],
    ['--speed', 'ludicrous', 'Invalid Codex speed: "ludicrous". Use standard or fast.'],
  ])('rejects an invalid %s value', async (flag, value, message) => {
    const program = makeProgram();

    await program.parseAsync(['node', 'hydraz', 'run', flag, value, 'Do it']);

    expect(console.error).toHaveBeenCalledWith(message);
    expect(startSession).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only model override', async () => {
    const program = makeProgram();

    await program.parseAsync([
      'node',
      'hydraz',
      'run',
      '--model',
      '   ',
      'Do it',
    ]);

    expect(console.error).toHaveBeenCalledWith(
      'Invalid Codex model: expected a non-empty value.',
    );
    expect(startSession).not.toHaveBeenCalled();
  });
});
