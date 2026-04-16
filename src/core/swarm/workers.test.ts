import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveRepoDataPaths } from '../repo/paths.js';
import { initRepoState, createNewSession } from '../sessions/manager.js';
import { createDefaultConfig } from '../config/schema.js';
import { ensureSwarmDirs, writeWorkerBrief, getSwarmDir } from './artifacts.js';
import { runWorkerFanout } from './workers.js';
import { buildWorkerPrompt } from './prompts/worker.js';
import type { TaskLedger, OwnershipMap, ExecutionContext } from './types.js';

vi.mock('../claude/executor.js', () => ({ launchClaude: vi.fn() }));
vi.mock('../providers/worktree.js', () => ({
  createWorktree: vi.fn((_repoRoot: string, sessionId: string, branchName: string) => ({
    directory: `/tmp/mock-worktree-${sessionId}`, branchName,
  })),
  destroyWorktree: vi.fn(),
}));
vi.mock('../orchestration/shutdown.js', () => ({
  registerExecutorHandle: vi.fn(),
  unregisterExecutorHandle: vi.fn(),
}));

import { launchClaude } from '../claude/executor.js';
import { createWorktree } from '../providers/worktree.js';
import { registerExecutorHandle, unregisterExecutorHandle } from '../orchestration/shutdown.js';

const mockLaunchClaude = vi.mocked(launchClaude);
const mockCreateWorktree = vi.mocked(createWorktree);
const mockRegister = vi.mocked(registerExecutorHandle);
const mockUnregister = vi.mocked(unregisterExecutorHandle);

let repoRoot: string;
let sessionId: string;
let config: ReturnType<typeof createDefaultConfig>;

const LEDGER_3_WORKERS: TaskLedger = {
  swarmPhase: 'fanning-out', baseCommit: 'abc123', outerLoop: 0, consensusRound: 0,
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
  workers: { 'worker-a': { paths: ['src/auth/'], exclusive: true }, 'worker-b': { paths: ['src/api/'], exclusive: true }, 'worker-c': { paths: ['src/db/'], exclusive: true } },
  shared: ['package.json'],
};

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'hydraz-workers-test-'));
  initRepoState(repoRoot);
  const session = createNewSession({ name: 'test-workers', repoRoot, branchName: 'hydraz/test-workers', personas: ['architect', 'implementer', 'verifier'], executionTarget: 'local', task: 'Build the system' });
  sessionId = session.id;
  config = createDefaultConfig();
  ensureSwarmDirs(repoRoot, sessionId);
  writeWorkerBrief(repoRoot, sessionId, 'worker-a', '# Worker A\nDo auth.');
  writeWorkerBrief(repoRoot, sessionId, 'worker-b', '# Worker B\nDo API.');
  writeWorkerBrief(repoRoot, sessionId, 'worker-c', '# Worker C\nDo DB.');
});

afterEach(() => { vi.clearAllMocks(); rmSync(repoRoot, { recursive: true, force: true }); const paths = resolveRepoDataPaths(repoRoot); rmSync(paths.repoDataDir, { recursive: true, force: true }); });

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return { repoRoot, sessionId, sessionName: 'test-workers', task: 'Build the system', workingDirectory: repoRoot, config, swarmDir: getSwarmDir(repoRoot, sessionId), ...overrides };
}

function mockAllWorkersSucceed() {
  mockLaunchClaude.mockReturnValue({ process: {} as never, pid: 12345, kill: vi.fn(), waitForExit: vi.fn().mockResolvedValue({ exitCode: 0, signal: null, success: true, cost: 0.30 }) });
}

function mockWorkerFailure(failWorkerId: string) {
  let callIndex = 0;
  const workerIds = Object.keys(LEDGER_3_WORKERS.workers);
  mockLaunchClaude.mockImplementation(() => {
    const currentWorker = workerIds[callIndex] ?? 'unknown';
    callIndex++;
    const shouldFail = currentWorker === failWorkerId;
    return { process: {} as never, pid: 12345, kill: vi.fn(), waitForExit: vi.fn().mockResolvedValue({ exitCode: shouldFail ? 1 : 0, signal: null, success: !shouldFail, cost: 0.30 }) };
  });
}

describe('buildWorkerPrompt', () => {
  it('should include the task description', () => { expect(buildWorkerPrompt('Build auth', 'auth-session', '# Brief\nDo stuff.', '# Plan\nSteps.', 'worker-a')).toContain('Build auth'); });
  it('should include the worker brief', () => { expect(buildWorkerPrompt('Build auth', 'auth-session', '# Brief\nDo auth stuff.', '# Plan\nSteps.', 'worker-a')).toContain('Do auth stuff'); });
  it('should include the worker id', () => { expect(buildWorkerPrompt('Build auth', 'auth-session', '# Brief\nStuff.', '# Plan\nSteps.', 'worker-a')).toContain('worker-a'); });
  it('should instruct strict TDD', () => { expect(buildWorkerPrompt('Build auth', 'auth-session', '# Brief\nStuff.', '# Plan\nSteps.', 'worker-a').toLowerCase()).toContain('tdd'); });
  it('should instruct writing progress.md', () => { expect(buildWorkerPrompt('Build auth', 'auth-session', '# Brief\nStuff.', '# Plan\nSteps.', 'worker-a')).toContain('progress.md'); });
  it('should include full prove-it methodology with evidence taxonomy', () => {
    const p = buildWorkerPrompt('Build auth', 'auth-session', '# Brief\nStuff.', '# Plan\nSteps.', 'worker-a');
    expect(p).toContain('Runtime proof'); expect(p).toContain('Source fact'); expect(p).toContain('Hypothesis'); expect(p).toContain('Unknown');
  });
  it('should include the absolute swarm directory path when provided', () => { expect(buildWorkerPrompt('Build auth', 'auth-session', '# Brief\nStuff.', '# Plan\nSteps.', 'worker-a', '/tmp/swarm')).toContain('/tmp/swarm'); });
  it('should include the plan content', () => { expect(buildWorkerPrompt('Build auth', 'auth-session', '# Brief\nStuff.', '# Plan\nDetailed steps here.', 'worker-a')).toContain('Detailed steps here'); });

  it('should include repo prompt content when provided', () => {
    const prompt = buildWorkerPrompt('Build auth', 'auth-session', '# Brief\nStuff.', '# Plan\nSteps.', 'worker-a', undefined, 'Always read CLAUDE.md files.');
    expect(prompt).toContain('Always read CLAUDE.md files.');
  });

  it('should not include repo-specific section when repoPromptContent is not provided', () => {
    const prompt = buildWorkerPrompt('Build auth', 'auth-session', '# Brief\nStuff.', '# Plan\nSteps.', 'worker-a');
    expect(prompt).not.toContain('Repo-Specific');
  });
});

describe('runWorkerFanout', () => {
  it('should create a worktree for each worker', async () => {
    mockAllWorkersSucceed();
    await runWorkerFanout(makeCtx(), { ledger: LEDGER_3_WORKERS, ownership: OWNERSHIP_3, planContent: '# Plan\nDo all the things.' });
    expect(mockCreateWorktree).toHaveBeenCalledTimes(3);
  });

  it('should launch claude once per worker', async () => {
    mockAllWorkersSucceed();
    await runWorkerFanout(makeCtx(), { ledger: LEDGER_3_WORKERS, ownership: OWNERSHIP_3, planContent: '# Plan\nDo all the things.' });
    expect(mockLaunchClaude).toHaveBeenCalledTimes(3);
  });

  it('should return success when all workers complete', async () => {
    mockAllWorkersSucceed();
    const result = await runWorkerFanout(makeCtx(), { ledger: LEDGER_3_WORKERS, ownership: OWNERSHIP_3, planContent: '# Plan\nDo all the things.' });
    expect(result.success).toBe(true);
    expect(result.workerResults).toHaveLength(3);
    expect(result.workerResults.every(r => r.success)).toBe(true);
  });

  it('should return failure when any worker fails', async () => {
    mockWorkerFailure('worker-b');
    const result = await runWorkerFanout(makeCtx(), { ledger: LEDGER_3_WORKERS, ownership: OWNERSHIP_3, planContent: '# Plan\nDo all the things.' });
    expect(result.success).toBe(false);
    expect(result.workerResults).toHaveLength(3);
    const failedWorker = result.workerResults.find(r => r.workerId === 'worker-b');
    expect(failedWorker?.success).toBe(false);
  });

  it('should include worker ids in results', async () => {
    mockAllWorkersSucceed();
    const result = await runWorkerFanout(makeCtx(), { ledger: LEDGER_3_WORKERS, ownership: OWNERSHIP_3, planContent: '# Plan\nDo all the things.' });
    const ids = result.workerResults.map(r => r.workerId).sort();
    expect(ids).toEqual(['worker-a', 'worker-b', 'worker-c']);
  });

  it('should pass worker-specific prompts containing each workers brief', async () => {
    mockAllWorkersSucceed();
    await runWorkerFanout(makeCtx(), { ledger: LEDGER_3_WORKERS, ownership: OWNERSHIP_3, planContent: '# Plan\nDo all the things.' });
    const prompts = mockLaunchClaude.mock.calls.map(c => c[0]!.prompt);
    expect(prompts.some(p => p.includes('Do auth'))).toBe(true);
    expect(prompts.some(p => p.includes('Do API'))).toBe(true);
    expect(prompts.some(p => p.includes('Do DB'))).toBe(true);
  });

  it('should not create worktrees when existingWorktrees is provided', async () => {
    mockAllWorkersSucceed();
    await runWorkerFanout(makeCtx(), { ledger: LEDGER_3_WORKERS, ownership: OWNERSHIP_3, planContent: '# Plan', existingWorktrees: { 'worker-a': '/tmp/a', 'worker-b': '/tmp/b', 'worker-c': '/tmp/c' } });
    expect(mockCreateWorktree).not.toHaveBeenCalled();
  });

  it('should use existing worktree paths as working directories when provided', async () => {
    mockAllWorkersSucceed();
    await runWorkerFanout(makeCtx(), { ledger: LEDGER_3_WORKERS, ownership: OWNERSHIP_3, planContent: '# Plan', existingWorktrees: { 'worker-a': '/tmp/existing-a', 'worker-b': '/tmp/existing-b', 'worker-c': '/tmp/existing-c' } });
    const workDirs = mockLaunchClaude.mock.calls.map(c => c[0]!.workingDirectory);
    expect(workDirs).toContain('/tmp/existing-a');
    expect(workDirs).toContain('/tmp/existing-b');
    expect(workDirs).toContain('/tmp/existing-c');
  });

  it('should still launch claude for all workers when using existing worktrees', async () => {
    mockAllWorkersSucceed();
    await runWorkerFanout(makeCtx(), { ledger: LEDGER_3_WORKERS, ownership: OWNERSHIP_3, planContent: '# Plan', existingWorktrees: { 'worker-a': '/tmp/a', 'worker-b': '/tmp/b', 'worker-c': '/tmp/c' } });
    expect(mockLaunchClaude).toHaveBeenCalledTimes(3);
  });

  it('should run workers sequentially by default', async () => {
    const callOrder: string[] = [];
    let callIndex = 0;
    const workerIds = Object.keys(LEDGER_3_WORKERS.workers);
    mockLaunchClaude.mockImplementation(() => {
      const wid = workerIds[callIndex++] ?? 'unknown';
      callOrder.push(`launch:${wid}`);
      return {
        process: {} as never, pid: 12345, kill: vi.fn(),
        waitForExit: vi.fn().mockImplementation(async () => {
          callOrder.push(`exit:${wid}`);
          return { exitCode: 0, signal: null, success: true, cost: 0.30 };
        }),
      };
    });

    await runWorkerFanout(makeCtx(), { ledger: LEDGER_3_WORKERS, ownership: OWNERSHIP_3, planContent: '# Plan' });

    expect(callOrder).toEqual([
      'launch:worker-a', 'exit:worker-a',
      'launch:worker-b', 'exit:worker-b',
      'launch:worker-c', 'exit:worker-c',
    ]);
  });

  it('should pass previous workers branch as startPoint in serial mode', async () => {
    mockAllWorkersSucceed();
    await runWorkerFanout(makeCtx(), { ledger: LEDGER_3_WORKERS, ownership: OWNERSHIP_3, planContent: '# Plan' });

    const calls = mockCreateWorktree.mock.calls;
    expect(calls[0]![3]).toBeUndefined();
    expect(calls[1]![3]).toBe('hydraz/test-worker-a');
    expect(calls[2]![3]).toBe('hydraz/test-worker-b');
  });

  it('should run workers concurrently when parallel is true', async () => {
    const callOrder: string[] = [];
    let callIndex = 0;
    const resolvers: Array<() => void> = [];
    const workerIds = Object.keys(LEDGER_3_WORKERS.workers);
    mockLaunchClaude.mockImplementation(() => {
      const wid = workerIds[callIndex++] ?? 'unknown';
      callOrder.push(`launch:${wid}`);
      return {
        process: {} as never, pid: 12345, kill: vi.fn(),
        waitForExit: vi.fn().mockImplementation(() => new Promise((resolve) => {
          resolvers.push(() => {
            callOrder.push(`exit:${wid}`);
            resolve({ exitCode: 0, signal: null, success: true, cost: 0.30 });
          });
        })),
      };
    });

    const fanoutPromise = runWorkerFanout(makeCtx(), { ledger: LEDGER_3_WORKERS, ownership: OWNERSHIP_3, planContent: '# Plan', parallel: true });

    await vi.waitFor(() => expect(resolvers).toHaveLength(3));
    expect(callOrder).toEqual(['launch:worker-a', 'launch:worker-b', 'launch:worker-c']);

    resolvers.forEach(r => r());
    await fanoutPromise;
  });

  it('should not pass startPoint in parallel mode', async () => {
    mockAllWorkersSucceed();
    await runWorkerFanout(makeCtx(), { ledger: LEDGER_3_WORKERS, ownership: OWNERSHIP_3, planContent: '# Plan', parallel: true });

    const calls = mockCreateWorktree.mock.calls;
    for (const call of calls) {
      expect(call[3]).toBeUndefined();
    }
  });

  it('should include repoPromptContent in worker prompts when set on context', async () => {
    mockAllWorkersSucceed();
    await runWorkerFanout(makeCtx({ repoPromptContent: 'Always read CLAUDE.md files.' }), { ledger: LEDGER_3_WORKERS, ownership: OWNERSHIP_3, planContent: '# Plan' });
    const prompts = mockLaunchClaude.mock.calls.map(c => c[0]!.prompt);
    expect(prompts.every(p => p.includes('Always read CLAUDE.md files.'))).toBe(true);
  });

  it('should register and unregister executor handles for all workers', async () => {
    mockAllWorkersSucceed();
    await runWorkerFanout(makeCtx(), { ledger: LEDGER_3_WORKERS, ownership: OWNERSHIP_3, planContent: '# Plan' });

    expect(mockRegister).toHaveBeenCalledTimes(3);
    expect(mockUnregister).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 3; i++) {
      const handle = mockLaunchClaude.mock.results[i]!.value;
      expect(mockRegister).toHaveBeenCalledWith(handle);
      expect(mockUnregister).toHaveBeenCalledWith(handle);
    }
  });

  it('should register all handles in parallel mode', async () => {
    mockAllWorkersSucceed();
    await runWorkerFanout(makeCtx(), { ledger: LEDGER_3_WORKERS, ownership: OWNERSHIP_3, planContent: '# Plan', parallel: true });

    expect(mockRegister).toHaveBeenCalledTimes(3);
    expect(mockUnregister).toHaveBeenCalledTimes(3);
  });
});
