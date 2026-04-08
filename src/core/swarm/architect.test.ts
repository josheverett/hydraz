import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveRepoDataPaths } from '../repo/paths.js';
import { initRepoState, createNewSession } from '../sessions/manager.js';
import { createDefaultConfig } from '../config/schema.js';
import { ensureSwarmDirs, writeArchitectureDesign } from './artifacts.js';
import { runArchitect, type ArchitectOptions } from './architect.js';
import { buildArchitectPrompt } from './prompts/architect.js';

vi.mock('../claude/executor.js', () => ({
  launchClaude: vi.fn(),
}));

import { launchClaude } from '../claude/executor.js';

const mockLaunchClaude = vi.mocked(launchClaude);

let repoRoot: string;
let sessionId: string;
let config: ReturnType<typeof createDefaultConfig>;

const SAMPLE_BRIEF = '# Investigation Brief\n\nThe repo uses TypeScript and Vitest.';

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'hydraz-architect-test-'));
  initRepoState(repoRoot);
  const session = createNewSession({
    name: 'test-architect',
    repoRoot,
    branchName: 'hydraz/test-architect',
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

function makeOptions(overrides: Partial<ArchitectOptions> = {}): ArchitectOptions {
  return {
    repoRoot,
    sessionId,
    task: 'Build the auth system',
    sessionName: 'test-architect',
    workingDirectory: repoRoot,
    config,
    investigationBrief: SAMPLE_BRIEF,
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
      cost: 0.25,
      inputTokens: 8000,
      outputTokens: 4000,
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
      stderr: 'architect failed',
    }),
  });
}

describe('buildArchitectPrompt', () => {
  it('should include the task description', () => {
    const prompt = buildArchitectPrompt('Build the auth system', 'auth-session', SAMPLE_BRIEF);
    expect(prompt).toContain('Build the auth system');
  });

  it('should include the session name', () => {
    const prompt = buildArchitectPrompt('Build the auth system', 'auth-session', SAMPLE_BRIEF);
    expect(prompt).toContain('auth-session');
  });

  it('should include the investigation brief', () => {
    const prompt = buildArchitectPrompt('Build the auth system', 'auth-session', SAMPLE_BRIEF);
    expect(prompt).toContain('TypeScript and Vitest');
  });

  it('should instruct writing architecture/design.md', () => {
    const prompt = buildArchitectPrompt('Build the auth system', 'auth-session', SAMPLE_BRIEF);
    expect(prompt).toContain('design.md');
  });

  it('should include evidence discipline principles', () => {
    const prompt = buildArchitectPrompt('Build the auth system', 'auth-session', SAMPLE_BRIEF);
    expect(prompt).toContain('Verified facts');
    expect(prompt).toContain('Assumptions');
  });

  it('should include the absolute swarm directory path when provided', () => {
    const prompt = buildArchitectPrompt('Build the auth system', 'auth-session', SAMPLE_BRIEF, '/tmp/swarm');
    expect(prompt).toContain('/tmp/swarm');
  });
});

describe('runArchitect', () => {
  it('should launch claude with the architect prompt containing the investigation brief', async () => {
    mockSuccessfulClaude();
    writeArchitectureDesign(repoRoot, sessionId, '# Architecture\nDesign here.');

    await runArchitect(makeOptions());

    expect(mockLaunchClaude).toHaveBeenCalledTimes(1);
    const callArgs = mockLaunchClaude.mock.calls[0]![0]!;
    expect(callArgs.prompt).toContain('Build the auth system');
    expect(callArgs.prompt).toContain('TypeScript and Vitest');
  });

  it('should return success when claude exits cleanly and design exists', async () => {
    mockSuccessfulClaude();
    writeArchitectureDesign(repoRoot, sessionId, '# Architecture\nDesign here.');

    const result = await runArchitect(makeOptions());

    expect(result.success).toBe(true);
    expect(result.designPath).toBeTruthy();
    expect(result.executorResult).toBeTruthy();
    expect(result.executorResult!.success).toBe(true);
  });

  it('should return failure when claude exits with error', async () => {
    mockFailedClaude();

    const result = await runArchitect(makeOptions());

    expect(result.success).toBe(false);
    expect(result.executorResult).toBeTruthy();
    expect(result.executorResult!.success).toBe(false);
  });

  it('should return failure when claude succeeds but design is missing', async () => {
    mockSuccessfulClaude();

    const result = await runArchitect(makeOptions());

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('should pass the working directory to the executor', async () => {
    mockSuccessfulClaude();
    writeArchitectureDesign(repoRoot, sessionId, '# Architecture\nDesign here.');

    await runArchitect(makeOptions({ workingDirectory: '/tmp/custom-dir' }));

    const callArgs = mockLaunchClaude.mock.calls[0]![0]!;
    expect(callArgs.workingDirectory).toBe('/tmp/custom-dir');
  });

  it('should pass config to the executor', async () => {
    mockSuccessfulClaude();
    writeArchitectureDesign(repoRoot, sessionId, '# Architecture\nDesign here.');

    await runArchitect(makeOptions());

    const callArgs = mockLaunchClaude.mock.calls[0]![0]!;
    expect(callArgs.config).toBe(config);
  });
});
