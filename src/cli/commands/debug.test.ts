import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectRepo } from '../../core/repo/detect.js';
import {
  findSessionByName,
  getActiveSessions,
} from '../../core/sessions/index.js';
import { refreshSessionStatus } from '../../core/orchestration/index.js';
import { sshExec } from '../../core/providers/devpod.js';
import { createProgram } from '../program.js';

vi.mock('../../core/repo/detect.js', () => ({
  detectRepo: vi.fn(),
}));

vi.mock('../../core/sessions/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/sessions/index.js')>();
  return {
    ...actual,
    findSessionByName: vi.fn(),
    getActiveSessions: vi.fn(),
  };
});

vi.mock('../../core/orchestration/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/orchestration/index.js')>();
  return {
    ...actual,
    refreshSessionStatus: vi.fn(),
  };
});

vi.mock('../../core/providers/devpod.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/providers/devpod.js')>();
  return {
    ...actual,
    sshExec: vi.fn(),
  };
});

const evidence = {
  attemptId: 'attempt-current',
  version: 1 as const,
  mode: 'exec' as const,
  command: 'codex',
  args: [
    'exec',
    '--model',
    'gpt-5.6-sol',
    '-c',
    'model_reasoning_effort="ultra"',
    '-c',
    'features.fast_mode=true',
    '-c',
    'service_tier="priority"',
  ],
  promptOmitted: true as const,
  promptArgumentIndex: 9,
  requested: {
    model: 'gpt-5.6-sol',
    reasoningEffort: 'ultra' as const,
    speed: 'fast' as const,
  },
  normalized: {
    fastMode: true,
    serviceTier: 'priority' as const,
  },
  preparedAt: '2026-07-15T00:00:00.000Z',
  spawnedAt: '2026-07-15T00:00:01.000Z',
  exitedAt: '2026-07-15T00:01:00.000Z',
  spawnState: 'exited' as const,
  threadId: 'thread-proof',
  exitCode: 0,
};

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    name: 'demo',
    repoRoot: '/repo',
    branchName: 'hydraz/demo',
    executionTarget: 'cloud' as const,
    task: 'TOP_SECRET_GOAL',
    state: 'completed' as const,
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:01:00.000Z',
    codex: {
      attemptId: 'attempt-current',
      invocationEvidence: evidence,
      rolloutVerification: {
        attemptId: 'attempt-current',
        status: 'matched' as const,
        checkedAt: '2026-07-15T00:01:00.000Z',
        observed: {
          model: 'gpt-5.6-sol',
          reasoningEffort: 'ultra',
        },
        checks: {
          model: 'matched' as const,
          reasoningEffort: 'matched' as const,
          serviceTier: 'unavailable' as const,
        },
      },
    },
    ...overrides,
  };
}

function makeProgram() {
  const program = createProgram();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  return program;
}

let tempRoot: string | undefined;

describe('debug command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const session = makeSession();
    vi.mocked(detectRepo).mockReturnValue({ root: '/repo', name: 'repo' });
    vi.mocked(findSessionByName).mockReturnValue(session);
    vi.mocked(getActiveSessions).mockReturnValue([session]);
    vi.mocked(refreshSessionStatus).mockReturnValue(session);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  });

  it('prints persisted invocation and honest proof semantics', async () => {
    await expect(
      makeProgram().parseAsync(['node', 'hydraz', 'debug', 'demo']),
    ).resolves.toBeDefined();

    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('Invocation proof: proven');
    expect(output).toContain('Model:       gpt-5.6-sol');
    expect(output).toContain('Reasoning:   ultra');
    expect(output).toContain('Speed:       fast');
    expect(output).toContain('Fast mode:   true');
    expect(output).toContain('Service tier: priority');
    expect(output).toContain('Spawn state: exited');
    expect(output).toContain('Thread:      thread-proof');
    expect(output).toContain('Exit code:   0');
    expect(output).toContain('model_reasoning_effort=\\"ultra\\"');
    expect(output).toContain('Codex self-recorded: matched');
    expect(output).toContain('Service tier check: unavailable');
    expect(output).toContain('Backend routing: not externally verifiable');
    expect(output).not.toContain('TOP_SECRET_GOAL');
  });

  it('reads active local evidence from the recorded artifact path', async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'hydraz-debug-test-'));
    const invocationPath = join(tempRoot, 'invocation.json');
    writeFileSync(invocationPath, JSON.stringify(evidence));
    const session = makeSession({
      executionTarget: 'local',
      state: 'syncing',
      codex: { invocationPath },
    });
    vi.mocked(getActiveSessions).mockReturnValue([session]);
    vi.mocked(refreshSessionStatus).mockReturnValue(session);

    await expect(
      makeProgram().parseAsync(['node', 'hydraz', 'debug']),
    ).resolves.toBeDefined();

    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain(
      'Invocation proof: proven',
    );
    expect(sshExec).not.toHaveBeenCalled();
  });

  it('reads active remote evidence over the workspace connection', async () => {
    const session = makeSession({
      state: 'syncing',
      codex: { invocationPath: '/tmp/hydraz-codex/session-1/invocation.json' },
    });
    vi.mocked(findSessionByName).mockReturnValue(session);
    vi.mocked(refreshSessionStatus).mockReturnValue(session);
    vi.mocked(sshExec).mockReturnValue(JSON.stringify(evidence));

    await expect(
      makeProgram().parseAsync(['node', 'hydraz', 'debug', 'demo']),
    ).resolves.toBeDefined();

    expect(sshExec).toHaveBeenCalledWith(
      'hydraz-session-1',
      "cat '/tmp/hydraz-codex/session-1/invocation.json'",
    );
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain(
      'Invocation proof: proven',
    );
  });

  it('reports malformed evidence as unavailable without throwing', async () => {
    const session = makeSession({
      state: 'syncing',
      codex: { invocationPath: '/tmp/hydraz-codex/session-1/invocation.json' },
    });
    vi.mocked(findSessionByName).mockReturnValue(session);
    vi.mocked(refreshSessionStatus).mockReturnValue(session);
    vi.mocked(sshExec).mockReturnValue('{not-json');

    await expect(
      makeProgram().parseAsync(['node', 'hydraz', 'debug', 'demo']),
    ).resolves.toBeDefined();

    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain(
      'Invocation proof: unavailable',
    );
  });

  it('rejects persisted invocation and rollout proof from another attempt', async () => {
    const session = makeSession({
      codex: {
        attemptId: 'attempt-current',
        invocationEvidence: {
          ...evidence,
          attemptId: 'attempt-old',
        },
        rolloutVerification: {
          attemptId: 'attempt-old',
          status: 'matched',
          checkedAt: '2026-07-15T00:01:00.000Z',
          checks: {
            model: 'matched',
            reasoningEffort: 'matched',
            serviceTier: 'unavailable',
          },
        },
      },
    });
    vi.mocked(findSessionByName).mockReturnValue(session);
    vi.mocked(refreshSessionStatus).mockReturnValue(session);

    await expect(
      makeProgram().parseAsync(['node', 'hydraz', 'debug', 'demo']),
    ).resolves.toBeDefined();

    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('Invocation proof: unavailable');
    expect(output).toContain('Codex self-recorded: unavailable');
    expect(output).not.toContain('Invocation proof: proven');
  });

  it('rejects an invocation artifact from another attempt', async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'hydraz-debug-test-'));
    const invocationPath = join(tempRoot, 'invocation.json');
    writeFileSync(invocationPath, JSON.stringify({
      ...evidence,
      attemptId: 'attempt-old',
    }));
    const session = makeSession({
      executionTarget: 'local',
      state: 'syncing',
      codex: {
        attemptId: 'attempt-current',
        invocationPath,
      },
    });
    vi.mocked(findSessionByName).mockReturnValue(session);
    vi.mocked(refreshSessionStatus).mockReturnValue(session);

    await expect(
      makeProgram().parseAsync(['node', 'hydraz', 'debug', 'demo']),
    ).resolves.toBeDefined();

    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('Invocation proof: unavailable');
    expect(output).not.toContain('Invocation proof: proven');
  });
});
