import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveRepoDataPaths } from '../repo/paths.js';
import { initRepoState, createNewSession } from '../sessions/manager.js';
import { createDefaultConfig } from '../config/schema.js';
import {
  ensureSwarmDirs,
  writeTaskLedger,
  writeOwnershipMap,
  writeWorkerBrief,
  writePlan,
} from './artifacts.js';
import { runPlanner, type PlannerOptions } from './planner.js';
import { buildPlannerPrompt } from './prompts/planner.js';
import type { TaskLedger, OwnershipMap } from './types.js';

vi.mock('../claude/executor.js', () => ({
  launchClaude: vi.fn(),
}));

import { launchClaude } from '../claude/executor.js';

const mockLaunchClaude = vi.mocked(launchClaude);

let repoRoot: string;
let sessionId: string;
let config: ReturnType<typeof createDefaultConfig>;

const SAMPLE_BRIEF = '# Investigation\nTypeScript + Vitest project.';
const SAMPLE_DESIGN = '# Architecture\nUse middleware pattern.';

const VALID_LEDGER: TaskLedger = {
  swarmPhase: 'planning',
  baseCommit: 'abc123',
  outerLoop: 0,
  consensusRound: 0,
  tasks: [
    {
      id: 'task-1',
      title: 'Implement auth middleware',
      description: 'Create JWT validation',
      assignedWorker: 'worker-a',
      ownedPaths: ['src/auth/'],
      acceptanceCriteria: ['JWT validated'],
      interfaceContracts: ['validateAuth(token: string): boolean'],
      status: 'pending',
    },
  ],
  workers: {
    'worker-a': { branch: 'hydraz/test-worker-a', status: 'pending' },
  },
  stages: {},
};

const VALID_OWNERSHIP: OwnershipMap = {
  workers: {
    'worker-a': { paths: ['src/auth/'], exclusive: true },
  },
  shared: ['package.json'],
};

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'hydraz-planner-test-'));
  initRepoState(repoRoot);
  const session = createNewSession({
    name: 'test-planner',
    repoRoot,
    branchName: 'hydraz/test-planner',
    personas: ['architect', 'implementer', 'verifier'],
    executionTarget: 'local',
    task: 'Build the auth system',
  });
  sessionId = session.id;
  config = createDefaultConfig();
  ensureSwarmDirs(repoRoot, sessionId);
});

afterEach(() => {
  vi.clearAllMocks();
  rmSync(repoRoot, { recursive: true, force: true });
  const paths = resolveRepoDataPaths(repoRoot);
  rmSync(paths.repoDataDir, { recursive: true, force: true });
});

function makeOptions(overrides: Partial<PlannerOptions> = {}): PlannerOptions {
  return {
    repoRoot,
    sessionId,
    task: 'Build the auth system',
    sessionName: 'test-planner',
    workingDirectory: repoRoot,
    config,
    investigationBrief: SAMPLE_BRIEF,
    architectureDesign: SAMPLE_DESIGN,
    workerCount: 3,
    ...overrides,
  };
}

function mockSuccessfulClaude() {
  mockLaunchClaude.mockReturnValue({
    process: {} as never,
    pid: 12345,
    kill: vi.fn(),
    waitForExit: vi.fn().mockResolvedValue({
      exitCode: 0,
      signal: null,
      success: true,
      cost: 0.35,
      inputTokens: 10000,
      outputTokens: 5000,
    }),
  });
}

function mockFailedClaude() {
  mockLaunchClaude.mockReturnValue({
    process: {} as never,
    pid: 12345,
    kill: vi.fn(),
    waitForExit: vi.fn().mockResolvedValue({
      exitCode: 1,
      signal: null,
      success: false,
      stderr: 'planner failed',
    }),
  });
}

function writePlannerArtifacts() {
  writePlan(repoRoot, sessionId, '# Plan\nStep 1: do the thing.');
  writeTaskLedger(repoRoot, sessionId, VALID_LEDGER);
  writeOwnershipMap(repoRoot, sessionId, VALID_OWNERSHIP);
  writeWorkerBrief(repoRoot, sessionId, 'worker-a', '# Worker A\nDo auth.');
}

describe('buildPlannerPrompt', () => {
  it('should include the task description', () => {
    const prompt = buildPlannerPrompt('Build the auth system', 'auth-session', SAMPLE_BRIEF, SAMPLE_DESIGN, 3);
    expect(prompt).toContain('Build the auth system');
  });

  it('should include the session name', () => {
    const prompt = buildPlannerPrompt('Build the auth system', 'auth-session', SAMPLE_BRIEF, SAMPLE_DESIGN, 3);
    expect(prompt).toContain('auth-session');
  });

  it('should include the investigation brief', () => {
    const prompt = buildPlannerPrompt('Build the auth system', 'auth-session', SAMPLE_BRIEF, SAMPLE_DESIGN, 3);
    expect(prompt).toContain('TypeScript + Vitest');
  });

  it('should include the architecture design', () => {
    const prompt = buildPlannerPrompt('Build the auth system', 'auth-session', SAMPLE_BRIEF, SAMPLE_DESIGN, 3);
    expect(prompt).toContain('middleware pattern');
  });

  it('should include the worker count', () => {
    const prompt = buildPlannerPrompt('Build the auth system', 'auth-session', SAMPLE_BRIEF, SAMPLE_DESIGN, 5);
    expect(prompt).toContain('5');
  });

  it('should instruct writing task-ledger.json and ownership.json', () => {
    const prompt = buildPlannerPrompt('Build the auth system', 'auth-session', SAMPLE_BRIEF, SAMPLE_DESIGN, 3);
    expect(prompt).toContain('task-ledger.json');
    expect(prompt).toContain('ownership.json');
  });
});

describe('runPlanner', () => {
  it('should launch claude with the planner prompt', async () => {
    mockSuccessfulClaude();
    writePlannerArtifacts();

    await runPlanner(makeOptions());

    expect(mockLaunchClaude).toHaveBeenCalledTimes(1);
    const callArgs = mockLaunchClaude.mock.calls[0]![0]!;
    expect(callArgs.prompt).toContain('Build the auth system');
    expect(callArgs.prompt).toContain('middleware pattern');
  });

  it('should return success with parsed ledger and ownership when all artifacts exist', async () => {
    mockSuccessfulClaude();
    writePlannerArtifacts();

    const result = await runPlanner(makeOptions());

    expect(result.success).toBe(true);
    expect(result.ledger).toBeTruthy();
    expect(result.ledger!.tasks).toHaveLength(1);
    expect(result.ownership).toBeTruthy();
    expect(result.ownership!.shared).toContain('package.json');
  });

  it('should return failure when claude exits with error', async () => {
    mockFailedClaude();

    const result = await runPlanner(makeOptions());

    expect(result.success).toBe(false);
    expect(result.executorResult).toBeTruthy();
    expect(result.executorResult!.success).toBe(false);
  });

  it('should return failure when task-ledger.json is missing', async () => {
    mockSuccessfulClaude();
    writePlan(repoRoot, sessionId, '# Plan\nStuff.');
    writeOwnershipMap(repoRoot, sessionId, VALID_OWNERSHIP);

    const result = await runPlanner(makeOptions());

    expect(result.success).toBe(false);
    expect(result.error).toContain('task-ledger');
  });

  it('should return failure when ownership.json is missing', async () => {
    mockSuccessfulClaude();
    writePlan(repoRoot, sessionId, '# Plan\nStuff.');
    writeTaskLedger(repoRoot, sessionId, VALID_LEDGER);

    const result = await runPlanner(makeOptions());

    expect(result.success).toBe(false);
    expect(result.error).toContain('ownership');
  });

  it('should pass working directory and config to the executor', async () => {
    mockSuccessfulClaude();
    writePlannerArtifacts();

    await runPlanner(makeOptions({ workingDirectory: '/tmp/custom' }));

    const callArgs = mockLaunchClaude.mock.calls[0]![0]!;
    expect(callArgs.workingDirectory).toBe('/tmp/custom');
    expect(callArgs.config).toBe(config);
  });
});
