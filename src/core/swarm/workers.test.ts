import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveRepoDataPaths } from '../repo/paths.js';
import { initRepoState, createNewSession } from '../sessions/manager.js';
import { createDefaultConfig } from '../config/schema.js';
import { ensureSwarmDirs, writeWorkerBrief } from './artifacts.js';
import { runWorkerFanout, type FanoutOptions } from './workers.js';
import { buildWorkerPrompt } from './prompts/worker.js';
import type { TaskLedger, OwnershipMap } from './types.js';

vi.mock('../claude/executor.js', () => ({
  launchClaude: vi.fn(),
}));

vi.mock('../providers/worktree.js', () => ({
  createWorktree: vi.fn((_repoRoot: string, sessionId: string, branchName: string) => ({
    directory: `/tmp/mock-worktree-${sessionId}`,
    branchName,
  })),
  destroyWorktree: vi.fn(),
}));

import { launchClaude } from '../claude/executor.js';
import { createWorktree } from '../providers/worktree.js';

const mockLaunchClaude = vi.mocked(launchClaude);
const mockCreateWorktree = vi.mocked(createWorktree);

let repoRoot: string;
let sessionId: string;
let config: ReturnType<typeof createDefaultConfig>;

const LEDGER_3_WORKERS: TaskLedger = {
  swarmPhase: 'fanning-out',
  baseCommit: 'abc123',
  outerLoop: 0,
  consensusRound: 0,
  tasks: [
    { id: 't1', title: 'Auth', description: 'Auth work', assignedWorker: 'worker-a', ownedPaths: ['src/auth/'], acceptanceCriteria: ['works'], interfaceContracts: [], status: 'pending' },
    { id: 't2', title: 'API', description: 'API work', assignedWorker: 'worker-b', ownedPaths: ['src/api/'], acceptanceCriteria: ['works'], interfaceContracts: [], status: 'pending' },
    { id: 't3', title: 'DB', description: 'DB work', assignedWorker: 'worker-c', ownedPaths: ['src/db/'], acceptanceCriteria: ['works'], interfaceContracts: [], status: 'pending' },
  ],
  workers: {
    'worker-a': { branch: 'hydraz/test-worker-a', status: 'pending' },
    'worker-b': { branch: 'hydraz/test-worker-b', status: 'pending' },
    'worker-c': { branch: 'hydraz/test-worker-c', status: 'pending' },
  },
  stages: {},
};

const OWNERSHIP_3: OwnershipMap = {
  workers: {
    'worker-a': { paths: ['src/auth/'], exclusive: true },
    'worker-b': { paths: ['src/api/'], exclusive: true },
    'worker-c': { paths: ['src/db/'], exclusive: true },
  },
  shared: ['package.json'],
};

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'hydraz-workers-test-'));
  initRepoState(repoRoot);
  const session = createNewSession({
    name: 'test-workers',
    repoRoot,
    branchName: 'hydraz/test-workers',
    personas: ['architect', 'implementer', 'verifier'],
    executionTarget: 'local',
    task: 'Build the system',
  });
  sessionId = session.id;
  config = createDefaultConfig();
  ensureSwarmDirs(repoRoot, sessionId);
  writeWorkerBrief(repoRoot, sessionId, 'worker-a', '# Worker A\nDo auth.');
  writeWorkerBrief(repoRoot, sessionId, 'worker-b', '# Worker B\nDo API.');
  writeWorkerBrief(repoRoot, sessionId, 'worker-c', '# Worker C\nDo DB.');
});

afterEach(() => {
  vi.clearAllMocks();
  rmSync(repoRoot, { recursive: true, force: true });
  const paths = resolveRepoDataPaths(repoRoot);
  rmSync(paths.repoDataDir, { recursive: true, force: true });
});

function makeOptions(overrides: Partial<FanoutOptions> = {}): FanoutOptions {
  return {
    repoRoot,
    sessionId,
    sessionName: 'test-workers',
    task: 'Build the system',
    workingDirectory: repoRoot,
    config,
    ledger: LEDGER_3_WORKERS,
    ownership: OWNERSHIP_3,
    planContent: '# Plan\nDo all the things.',
    ...overrides,
  };
}

function mockAllWorkersSucceed() {
  mockLaunchClaude.mockReturnValue({
    process: {} as never,
    pid: 12345,
    kill: vi.fn(),
    waitForExit: vi.fn().mockResolvedValue({
      exitCode: 0,
      signal: null,
      success: true,
      cost: 0.30,
    }),
  });
}

function mockWorkerFailure(failWorkerId: string) {
  let callIndex = 0;
  const workerIds = Object.keys(LEDGER_3_WORKERS.workers);
  mockLaunchClaude.mockImplementation(() => {
    const currentWorker = workerIds[callIndex] ?? 'unknown';
    callIndex++;
    const shouldFail = currentWorker === failWorkerId;
    return {
      process: {} as never,
      pid: 12345,
      kill: vi.fn(),
      waitForExit: vi.fn().mockResolvedValue({
        exitCode: shouldFail ? 1 : 0,
        signal: null,
        success: !shouldFail,
        cost: 0.30,
      }),
    };
  });
}

describe('buildWorkerPrompt', () => {
  it('should include the task description', () => {
    const prompt = buildWorkerPrompt('Build auth', 'auth-session', '# Brief\nDo stuff.', '# Plan\nSteps.', 'worker-a');
    expect(prompt).toContain('Build auth');
  });

  it('should include the worker brief', () => {
    const prompt = buildWorkerPrompt('Build auth', 'auth-session', '# Brief\nDo auth stuff.', '# Plan\nSteps.', 'worker-a');
    expect(prompt).toContain('Do auth stuff');
  });

  it('should include the worker id', () => {
    const prompt = buildWorkerPrompt('Build auth', 'auth-session', '# Brief\nStuff.', '# Plan\nSteps.', 'worker-a');
    expect(prompt).toContain('worker-a');
  });

  it('should instruct strict TDD', () => {
    const prompt = buildWorkerPrompt('Build auth', 'auth-session', '# Brief\nStuff.', '# Plan\nSteps.', 'worker-a');
    expect(prompt.toLowerCase()).toContain('tdd');
  });

  it('should instruct writing progress.md', () => {
    const prompt = buildWorkerPrompt('Build auth', 'auth-session', '# Brief\nStuff.', '# Plan\nSteps.', 'worker-a');
    expect(prompt).toContain('progress.md');
  });

  it('should include full prove-it methodology with evidence taxonomy', () => {
    const prompt = buildWorkerPrompt('Build auth', 'auth-session', '# Brief\nStuff.', '# Plan\nSteps.', 'worker-a');
    expect(prompt).toContain('Runtime proof');
    expect(prompt).toContain('Source fact');
    expect(prompt).toContain('Hypothesis');
    expect(prompt).toContain('Unknown');
  });

  it('should include the absolute swarm directory path when provided', () => {
    const prompt = buildWorkerPrompt('Build auth', 'auth-session', '# Brief\nStuff.', '# Plan\nSteps.', 'worker-a', '/tmp/swarm');
    expect(prompt).toContain('/tmp/swarm');
  });

  it('should include the plan content', () => {
    const prompt = buildWorkerPrompt('Build auth', 'auth-session', '# Brief\nStuff.', '# Plan\nDetailed steps here.', 'worker-a');
    expect(prompt).toContain('Detailed steps here');
  });
});

describe('runWorkerFanout', () => {
  it('should create a worktree for each worker', async () => {
    mockAllWorkersSucceed();

    await runWorkerFanout(makeOptions());

    expect(mockCreateWorktree).toHaveBeenCalledTimes(3);
  });

  it('should launch claude once per worker', async () => {
    mockAllWorkersSucceed();

    await runWorkerFanout(makeOptions());

    expect(mockLaunchClaude).toHaveBeenCalledTimes(3);
  });

  it('should return success when all workers complete', async () => {
    mockAllWorkersSucceed();

    const result = await runWorkerFanout(makeOptions());

    expect(result.success).toBe(true);
    expect(result.workerResults).toHaveLength(3);
    expect(result.workerResults.every(r => r.success)).toBe(true);
  });

  it('should return failure when any worker fails', async () => {
    mockWorkerFailure('worker-b');

    const result = await runWorkerFanout(makeOptions());

    expect(result.success).toBe(false);
    expect(result.workerResults).toHaveLength(3);
    const failedWorker = result.workerResults.find(r => r.workerId === 'worker-b');
    expect(failedWorker?.success).toBe(false);
  });

  it('should include worker ids in results', async () => {
    mockAllWorkersSucceed();

    const result = await runWorkerFanout(makeOptions());

    const ids = result.workerResults.map(r => r.workerId).sort();
    expect(ids).toEqual(['worker-a', 'worker-b', 'worker-c']);
  });

  it('should pass worker-specific prompts containing each workers brief', async () => {
    mockAllWorkersSucceed();

    await runWorkerFanout(makeOptions());

    const prompts = mockLaunchClaude.mock.calls.map(c => c[0]!.prompt);
    expect(prompts.some(p => p.includes('Do auth'))).toBe(true);
    expect(prompts.some(p => p.includes('Do API'))).toBe(true);
    expect(prompts.some(p => p.includes('Do DB'))).toBe(true);
  });
});
