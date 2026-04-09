import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveRepoDataPaths } from '../repo/paths.js';
import { initRepoState, createNewSession } from '../sessions/manager.js';
import { createDefaultConfig } from '../config/schema.js';
import { ensureSwarmDirs, writeInvestigationBrief, getSwarmDir } from './artifacts.js';
import { runInvestigation } from './investigator.js';
import { buildInvestigatorPrompt } from './prompts/investigator.js';
import type { ExecutionContext } from './types.js';

vi.mock('../claude/executor.js', () => ({
  launchClaude: vi.fn(),
}));

import { launchClaude } from '../claude/executor.js';

const mockLaunchClaude = vi.mocked(launchClaude);

let repoRoot: string;
let sessionId: string;
let config: ReturnType<typeof createDefaultConfig>;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'hydraz-investigator-test-'));
  initRepoState(repoRoot);
  const session = createNewSession({
    name: 'test-investigate',
    repoRoot,
    branchName: 'hydraz/test-investigate',
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

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    repoRoot,
    sessionId,
    task: 'Build the auth system',
    sessionName: 'test-investigate',
    workingDirectory: repoRoot,
    config,
    swarmDir: getSwarmDir(repoRoot, sessionId),
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
      cost: 0.15,
      inputTokens: 5000,
      outputTokens: 2000,
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
      stderr: 'something went wrong',
    }),
  });
}

describe('buildInvestigatorPrompt', () => {
  it('should include the task description', () => {
    const prompt = buildInvestigatorPrompt('Build the auth system', 'auth-session');
    expect(prompt).toContain('Build the auth system');
  });

  it('should include the session name', () => {
    const prompt = buildInvestigatorPrompt('Build the auth system', 'auth-session');
    expect(prompt).toContain('auth-session');
  });

  it('should instruct read-only behavior', () => {
    const prompt = buildInvestigatorPrompt('Build the auth system', 'auth-session');
    expect(prompt.toLowerCase()).toMatch(/read[- ]only|do not (make|modify|create|write|edit|change)/);
  });

  it('should instruct writing investigation/brief.md', () => {
    const prompt = buildInvestigatorPrompt('Build the auth system', 'auth-session');
    expect(prompt).toContain('brief.md');
  });

  it('should include evidence discipline principles', () => {
    const prompt = buildInvestigatorPrompt('Build the auth system', 'auth-session');
    expect(prompt).toContain('Verified facts');
    expect(prompt).toContain('Assumptions');
  });

  it('should include the absolute swarm directory path when provided', () => {
    const prompt = buildInvestigatorPrompt('Build the auth system', 'auth-session', '/home/user/.hydraz/repos/test/sessions/abc/swarm');
    expect(prompt).toContain('/home/user/.hydraz/repos/test/sessions/abc/swarm');
  });
});

describe('runInvestigation', () => {
  it('should launch claude with the investigator prompt', async () => {
    mockSuccessfulClaude();
    writeInvestigationBrief(repoRoot, sessionId, '# Investigation\nFindings here.');

    await runInvestigation(makeCtx());

    expect(mockLaunchClaude).toHaveBeenCalledTimes(1);
    const callArgs = mockLaunchClaude.mock.calls[0]![0]!;
    expect(callArgs.prompt).toContain('Build the auth system');
  });

  it('should return success when claude exits cleanly and brief exists', async () => {
    mockSuccessfulClaude();
    writeInvestigationBrief(repoRoot, sessionId, '# Investigation\nFindings here.');

    const result = await runInvestigation(makeCtx());

    expect(result.success).toBe(true);
    expect(result.briefPath).toBeTruthy();
    expect(result.executorResult).toBeTruthy();
    expect(result.executorResult!.success).toBe(true);
  });

  it('should return failure when claude exits with error', async () => {
    mockFailedClaude();

    const result = await runInvestigation(makeCtx());

    expect(result.success).toBe(false);
    expect(result.executorResult).toBeTruthy();
    expect(result.executorResult!.success).toBe(false);
  });

  it('should return failure when claude succeeds but brief is missing', async () => {
    mockSuccessfulClaude();

    const result = await runInvestigation(makeCtx());

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('should pass the working directory to the executor', async () => {
    mockSuccessfulClaude();
    writeInvestigationBrief(repoRoot, sessionId, '# Investigation\nFindings.');

    await runInvestigation(makeCtx({ workingDirectory: '/tmp/custom-dir' }));

    const callArgs = mockLaunchClaude.mock.calls[0]![0]!;
    expect(callArgs.workingDirectory).toBe('/tmp/custom-dir');
  });

  it('should pass config to the executor', async () => {
    mockSuccessfulClaude();
    writeInvestigationBrief(repoRoot, sessionId, '# Investigation\nFindings.');

    await runInvestigation(makeCtx());

    const callArgs = mockLaunchClaude.mock.calls[0]![0]!;
    expect(callArgs.config).toBe(config);
  });

});
