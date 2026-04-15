import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveRepoDataPaths } from '../repo/paths.js';
import { initRepoState, createNewSession } from '../sessions/manager.js';
import { ensureSwarmDirs, getSwarmDir } from './artifacts.js';
import { runFanIn, type FanInOptions } from './merge.js';
import type { TaskLedger } from './types.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from 'node:child_process';

const mockExecFileSync = vi.mocked(execFileSync);

let repoRoot: string;
let sessionId: string;

const LEDGER_3_WORKERS: TaskLedger = {
  swarmPhase: 'merging',
  baseCommit: 'abc123',
  outerLoop: 0,
  consensusRound: 0,
  tasks: [
    { id: 't1', title: 'Auth', description: 'Auth work', assignedWorker: 'worker-a', ownedPaths: ['src/auth/'], acceptanceCriteria: ['works'], interfaceContracts: [], status: 'completed' },
    { id: 't2', title: 'API', description: 'API work', assignedWorker: 'worker-b', ownedPaths: ['src/api/'], acceptanceCriteria: ['works'], interfaceContracts: [], status: 'completed' },
    { id: 't3', title: 'DB', description: 'DB work', assignedWorker: 'worker-c', ownedPaths: ['src/db/'], acceptanceCriteria: ['works'], interfaceContracts: [], status: 'completed' },
  ],
  workers: {
    'worker-a': { branch: 'hydraz/test-worker-a', status: 'completed' },
    'worker-b': { branch: 'hydraz/test-worker-b', status: 'completed' },
    'worker-c': { branch: 'hydraz/test-worker-c', status: 'completed' },
  },
  stages: {},
};

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'hydraz-merge-test-'));
  initRepoState(repoRoot);
  const session = createNewSession({
    name: 'test-merge',
    repoRoot,
    branchName: 'hydraz/test-merge',
    personas: ['architect', 'implementer', 'verifier'],
    executionTarget: 'local',
    task: 'Build the system',
  });
  sessionId = session.id;
  ensureSwarmDirs(repoRoot, sessionId);
});

afterEach(() => {
  vi.clearAllMocks();
  rmSync(repoRoot, { recursive: true, force: true });
  const paths = resolveRepoDataPaths(repoRoot);
  rmSync(paths.repoDataDir, { recursive: true, force: true });
});

function makeOptions(overrides: Partial<FanInOptions> = {}): FanInOptions {
  return {
    repoRoot,
    sessionId,
    sessionName: 'test-merge',
    workingDirectory: repoRoot,
    ledger: LEDGER_3_WORKERS,
    ...overrides,
  };
}

function mockAllMergesClean() {
  mockExecFileSync.mockReturnValue(Buffer.from(''));
}

function mockMergeConflict(failOnBranch: string) {
  mockExecFileSync.mockImplementation((_cmd: unknown, args?: unknown) => {
    const argArray = args as string[] | undefined;
    if (argArray && argArray[0] === 'merge' && argArray.includes(failOnBranch)) {
      throw new Error(`CONFLICT: Merge conflict in file.ts`);
    }
    return Buffer.from('');
  });
}

describe('runFanIn', () => {
  it('should return success when all merges are clean', () => {
    mockAllMergesClean();

    const result = runFanIn(makeOptions());

    expect(result.success).toBe(true);
    expect(result.workerMerges).toHaveLength(3);
    expect(result.workerMerges.every(m => m.outcome === 'clean')).toBe(true);
  });

  it('should set the integration branch name', () => {
    mockAllMergesClean();

    const result = runFanIn(makeOptions());

    expect(result.integrationBranch).toContain('test-merge');
  });

  it('should call git merge for each worker branch', () => {
    mockAllMergesClean();

    runFanIn(makeOptions());

    const mergeCalls = mockExecFileSync.mock.calls.filter(
      (call) => (call[1] as string[])?.[0] === 'merge'
    );
    expect(mergeCalls.length).toBe(3);
  });

  it('should include worker ids and branches in merge results', () => {
    mockAllMergesClean();

    const result = runFanIn(makeOptions());

    const ids = result.workerMerges.map(m => m.workerId).sort();
    expect(ids).toEqual(['worker-a', 'worker-b', 'worker-c']);
    expect(result.workerMerges.every(m => m.branch.startsWith('hydraz/'))).toBe(true);
  });

  it('should return failure when a merge has an unresolvable conflict', () => {
    mockMergeConflict('hydraz/test-worker-b');

    const result = runFanIn(makeOptions());

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('should write a merge report', () => {
    mockAllMergesClean();

    const result = runFanIn(makeOptions());

    expect(result.reportPath).toBeTruthy();
    const reportPath = join(getSwarmDir(repoRoot, sessionId), 'merge', 'report.md');
    expect(existsSync(reportPath)).toBe(true);
  });
});
