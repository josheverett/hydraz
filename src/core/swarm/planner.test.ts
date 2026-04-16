import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveRepoDataPaths } from '../repo/paths.js';
import { initRepoState, createNewSession } from '../sessions/manager.js';
import { createDefaultConfig } from '../config/schema.js';
import { ensureSwarmDirs, writeTaskLedger, writeOwnershipMap, writeWorkerBrief, writePlan, getSwarmDir } from './artifacts.js';
import { runPlanner } from './planner.js';
import { buildPlannerPrompt } from './prompts/planner.js';
import type { TaskLedger, OwnershipMap, ExecutionContext } from './types.js';

vi.mock('../claude/executor.js', () => ({ launchClaude: vi.fn() }));
import { launchClaude } from '../claude/executor.js';
const mockLaunchClaude = vi.mocked(launchClaude);

let repoRoot: string;
let sessionId: string;
let config: ReturnType<typeof createDefaultConfig>;

const SAMPLE_BRIEF = '# Investigation\nTypeScript + Vitest project.';
const SAMPLE_DESIGN = '# Architecture\nUse middleware pattern.';

const VALID_LEDGER: TaskLedger = {
  swarmPhase: 'planning', baseCommit: 'abc123', outerLoop: 0, consensusRound: 0,
  tasks: [{ id: 'task-1', title: 'Implement auth middleware', description: 'Create JWT validation', assignedWorker: 'worker-a', ownedPaths: ['src/auth/'], acceptanceCriteria: ['JWT validated'], interfaceContracts: ['validateAuth(token: string): boolean'], status: 'pending' }],
  workers: { 'worker-a': { branch: 'hydraz/test-worker-a', status: 'pending' } },
  stages: {},
};

const VALID_OWNERSHIP: OwnershipMap = { workers: { 'worker-a': { paths: ['src/auth/'], exclusive: true } }, shared: ['package.json'] };

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'hydraz-planner-test-'));
  initRepoState(repoRoot);
  const session = createNewSession({ name: 'test-planner', repoRoot, branchName: 'hydraz/test-planner', personas: ['architect', 'implementer', 'verifier'], executionTarget: 'local', task: 'Build the auth system' });
  sessionId = session.id;
  config = createDefaultConfig();
  ensureSwarmDirs(repoRoot, sessionId);
});

afterEach(() => { vi.clearAllMocks(); rmSync(repoRoot, { recursive: true, force: true }); const paths = resolveRepoDataPaths(repoRoot); rmSync(paths.repoDataDir, { recursive: true, force: true }); });

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return { repoRoot, sessionId, task: 'Build the auth system', sessionName: 'test-planner', workingDirectory: repoRoot, config, swarmDir: getSwarmDir(repoRoot, sessionId), ...overrides };
}

function mockSuccessfulClaude() {
  mockLaunchClaude.mockReturnValue({ process: {} as never, pid: 12345, kill: vi.fn(), waitForExit: vi.fn().mockResolvedValue({ exitCode: 0, signal: null, success: true, cost: 0.35 }) });
}

function mockFailedClaude() {
  mockLaunchClaude.mockReturnValue({ process: {} as never, pid: 12345, kill: vi.fn(), waitForExit: vi.fn().mockResolvedValue({ exitCode: 1, signal: null, success: false, stderr: 'planner failed' }) });
}

function writePlannerArtifacts() {
  writePlan(repoRoot, sessionId, '# Plan\nStep 1: do the thing.');
  writeTaskLedger(repoRoot, sessionId, VALID_LEDGER);
  writeOwnershipMap(repoRoot, sessionId, VALID_OWNERSHIP);
  writeWorkerBrief(repoRoot, sessionId, 'worker-a', '# Worker A\nDo auth.');
}

describe('buildPlannerPrompt', () => {
  it('should include the task description', () => { expect(buildPlannerPrompt('Build the auth system', 'auth-session', SAMPLE_BRIEF, SAMPLE_DESIGN, 3)).toContain('Build the auth system'); });
  it('should include the session name', () => { expect(buildPlannerPrompt('Build the auth system', 'auth-session', SAMPLE_BRIEF, SAMPLE_DESIGN, 3)).toContain('auth-session'); });
  it('should include the investigation brief', () => { expect(buildPlannerPrompt('Build the auth system', 'auth-session', SAMPLE_BRIEF, SAMPLE_DESIGN, 3)).toContain('TypeScript + Vitest'); });
  it('should include the architecture design', () => { expect(buildPlannerPrompt('Build the auth system', 'auth-session', SAMPLE_BRIEF, SAMPLE_DESIGN, 3)).toContain('middleware pattern'); });
  it('should include the worker count', () => { expect(buildPlannerPrompt('Build the auth system', 'auth-session', SAMPLE_BRIEF, SAMPLE_DESIGN, 5)).toContain('5'); });
  it('should instruct writing task-ledger.json and ownership.json', () => { const p = buildPlannerPrompt('Build the auth system', 'auth-session', SAMPLE_BRIEF, SAMPLE_DESIGN, 3); expect(p).toContain('task-ledger.json'); expect(p).toContain('ownership.json'); });
  it('should include evidence discipline principles', () => { const p = buildPlannerPrompt('Build the auth system', 'auth-session', SAMPLE_BRIEF, SAMPLE_DESIGN, 3); expect(p).toContain('Verified facts'); expect(p).toContain('Assumptions'); });
  it('should include the absolute swarm directory path when provided', () => { expect(buildPlannerPrompt('Build the auth system', 'auth-session', SAMPLE_BRIEF, SAMPLE_DESIGN, 3, '/tmp/swarm')).toContain('/tmp/swarm'); });

  it('should include repo prompt content when provided', () => {
    const prompt = buildPlannerPrompt('Build the auth system', 'auth-session', SAMPLE_BRIEF, SAMPLE_DESIGN, 3, undefined, 'Always read CLAUDE.md files.');
    expect(prompt).toContain('Always read CLAUDE.md files.');
  });

  it('should not include repo-specific section when repoPromptContent is not provided', () => {
    const prompt = buildPlannerPrompt('Build the auth system', 'auth-session', SAMPLE_BRIEF, SAMPLE_DESIGN, 3);
    expect(prompt).not.toContain('Repo-Specific');
  });
});

describe('runPlanner', () => {
  it('should launch claude with the planner prompt', async () => {
    mockSuccessfulClaude(); writePlannerArtifacts();
    await runPlanner(makeCtx(), { investigationBrief: SAMPLE_BRIEF, architectureDesign: SAMPLE_DESIGN, workerCount: 3 });
    expect(mockLaunchClaude).toHaveBeenCalledTimes(1);
    const callArgs = mockLaunchClaude.mock.calls[0]![0]!;
    expect(callArgs.prompt).toContain('Build the auth system');
    expect(callArgs.prompt).toContain('middleware pattern');
  });

  it('should return success with parsed ledger and ownership when all artifacts exist', async () => {
    mockSuccessfulClaude(); writePlannerArtifacts();
    const result = await runPlanner(makeCtx(), { investigationBrief: SAMPLE_BRIEF, architectureDesign: SAMPLE_DESIGN, workerCount: 3 });
    expect(result.success).toBe(true);
    expect(result.ledger).toBeTruthy();
    expect(result.ledger!.tasks).toHaveLength(1);
    expect(result.ownership).toBeTruthy();
    expect(result.ownership!.shared).toContain('package.json');
  });

  it('should return failure when claude exits with error', async () => {
    mockFailedClaude();
    const result = await runPlanner(makeCtx(), { investigationBrief: SAMPLE_BRIEF, architectureDesign: SAMPLE_DESIGN, workerCount: 3 });
    expect(result.success).toBe(false);
    expect(result.executorResult).toBeTruthy();
    expect(result.executorResult!.success).toBe(false);
  });

  it('should return failure when task-ledger.json is missing', async () => {
    mockSuccessfulClaude();
    writePlan(repoRoot, sessionId, '# Plan\nStuff.');
    writeOwnershipMap(repoRoot, sessionId, VALID_OWNERSHIP);
    const result = await runPlanner(makeCtx(), { investigationBrief: SAMPLE_BRIEF, architectureDesign: SAMPLE_DESIGN, workerCount: 3 });
    expect(result.success).toBe(false);
    expect(result.error).toContain('task-ledger');
  });

  it('should return failure when ownership.json is missing', async () => {
    mockSuccessfulClaude();
    writePlan(repoRoot, sessionId, '# Plan\nStuff.');
    writeTaskLedger(repoRoot, sessionId, VALID_LEDGER);
    const result = await runPlanner(makeCtx(), { investigationBrief: SAMPLE_BRIEF, architectureDesign: SAMPLE_DESIGN, workerCount: 3 });
    expect(result.success).toBe(false);
    expect(result.error).toContain('ownership');
  });

  it('should pass working directory and config to the executor', async () => {
    mockSuccessfulClaude(); writePlannerArtifacts();
    await runPlanner(makeCtx({ workingDirectory: '/tmp/custom' }), { investigationBrief: SAMPLE_BRIEF, architectureDesign: SAMPLE_DESIGN, workerCount: 3 });
    const callArgs = mockLaunchClaude.mock.calls[0]![0]!;
    expect(callArgs.workingDirectory).toBe('/tmp/custom');
    expect(callArgs.config).toBe(config);
  });

  it('should include repoPromptContent in the Claude prompt when set on context', async () => {
    mockSuccessfulClaude(); writePlannerArtifacts();
    await runPlanner(makeCtx({ repoPromptContent: 'Always read CLAUDE.md files.' }), { investigationBrief: SAMPLE_BRIEF, architectureDesign: SAMPLE_DESIGN, workerCount: 3 });
    const callArgs = mockLaunchClaude.mock.calls[0]![0]!;
    expect(callArgs.prompt).toContain('Always read CLAUDE.md files.');
  });
});
