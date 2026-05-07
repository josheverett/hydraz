import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveRepoDataPaths } from '../repo/paths.js';
import { initRepoState, createNewSession } from '../sessions/manager.js';
import { createDefaultConfig } from '../config/schema.js';
import { ensureSwarmDirs, writeArchitectureDesign, getSwarmDir } from './artifacts.js';
import { runArchitect } from './architect.js';
import { buildArchitectPrompt } from './prompts/architect.js';
import type { ExecutionContext } from './types.js';

vi.mock('../claude/executor.js', () => ({
  launchClaude: vi.fn(),
}));

vi.mock('../orchestration/shutdown.js', () => ({
  registerExecutorHandle: vi.fn(),
  unregisterExecutorHandle: vi.fn(),
}));

import { launchClaude } from '../claude/executor.js';
import { registerExecutorHandle, unregisterExecutorHandle } from '../orchestration/shutdown.js';

const mockLaunchClaude = vi.mocked(launchClaude);
const mockRegister = vi.mocked(registerExecutorHandle);
const mockUnregister = vi.mocked(unregisterExecutorHandle);

let repoRoot: string;
let sessionId: string;
let config: ReturnType<typeof createDefaultConfig>;


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

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    repoRoot,
    sessionId,
    task: 'Build the auth system',
    sessionName: 'test-architect',
    workingDirectory: repoRoot,
    config,
    swarmDir: getSwarmDir(repoRoot, sessionId),
    ...overrides,
  };
}

function mockSuccessfulClaude() {
  mockLaunchClaude.mockReturnValue({
    process: {} as never, pid: 12345, kill: vi.fn(),
    waitForExit: vi.fn().mockResolvedValue({ exitCode: 0, signal: null, success: true, cost: 0.25 }),
  });
}

function mockFailedClaude() {
  mockLaunchClaude.mockReturnValue({
    process: {} as never, pid: 12345, kill: vi.fn(),
    waitForExit: vi.fn().mockResolvedValue({ exitCode: 1, signal: null, success: false, stderr: 'architect failed' }),
  });
}

describe('buildArchitectPrompt', () => {
  it('should include the task description', () => {
    const prompt = buildArchitectPrompt('Build the auth system', 'auth-session');
    expect(prompt).toContain('Build the auth system');
  });

  it('should include the session name', () => {
    const prompt = buildArchitectPrompt('Build the auth system', 'auth-session');
    expect(prompt).toContain('auth-session');
  });

  it('should reference the investigation brief path instead of embedding content', () => {
    const prompt = buildArchitectPrompt('Build the auth system', 'auth-session', '/tmp/swarm');
    expect(prompt).toContain('investigation/brief.md');
  });

  it('should instruct writing architecture/design.md', () => {
    const prompt = buildArchitectPrompt('Build the auth system', 'auth-session');
    expect(prompt).toContain('design.md');
  });

  it('should include evidence discipline principles', () => {
    const prompt = buildArchitectPrompt('Build the auth system', 'auth-session');
    expect(prompt).toContain('Verified facts');
    expect(prompt).toContain('Assumptions');
  });

  it('should include the absolute swarm directory path when provided', () => {
    const prompt = buildArchitectPrompt('Build the auth system', 'auth-session', '/tmp/swarm');
    expect(prompt).toContain('/tmp/swarm');
  });

  it('should include repo prompt content when provided', () => {
    const prompt = buildArchitectPrompt('Build the auth system', 'auth-session', undefined, 'Always read CLAUDE.md files.');
    expect(prompt).toContain('Always read CLAUDE.md files.');
  });

  it('should not include repo-specific section when repoPromptContent is not provided', () => {
    const prompt = buildArchitectPrompt('Build the auth system', 'auth-session');
    expect(prompt).not.toContain('Repo-Specific');
  });

  it('should include context refresh discipline', () => {
    const prompt = buildArchitectPrompt('Build the auth system', 'auth-session');
    expect(prompt).toContain('Context Refresh');
    expect(prompt).toContain('RE-READ EVERY TURN');
  });
});

describe('runArchitect', () => {
  it('should launch claude with the architect prompt', async () => {
    mockSuccessfulClaude();
    writeArchitectureDesign(repoRoot, sessionId, '# Architecture\nDesign here.');

    await runArchitect(makeCtx());

    expect(mockLaunchClaude).toHaveBeenCalledTimes(1);
    const callArgs = mockLaunchClaude.mock.calls[0]![0]!;
    expect(callArgs.prompt).toContain('Build the auth system');
    expect(callArgs.prompt).toContain('investigation/brief.md');
  });

  it('should return success when claude exits cleanly and design exists', async () => {
    mockSuccessfulClaude();
    writeArchitectureDesign(repoRoot, sessionId, '# Architecture\nDesign here.');

    const result = await runArchitect(makeCtx());

    expect(result.success).toBe(true);
    expect(result.designPath).toBeTruthy();
  });

  it('should return failure when claude exits with error', async () => {
    mockFailedClaude();

    const result = await runArchitect(makeCtx());

    expect(result.success).toBe(false);
    expect(result.executorResult).toBeTruthy();
    expect(result.executorResult!.success).toBe(false);
  });

  it('should return failure when claude succeeds but design is missing', async () => {
    mockSuccessfulClaude();

    const result = await runArchitect(makeCtx());

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('should pass the working directory to the executor', async () => {
    mockSuccessfulClaude();
    writeArchitectureDesign(repoRoot, sessionId, '# Architecture\nDesign here.');

    await runArchitect(makeCtx({ workingDirectory: '/tmp/custom-dir' }));

    const callArgs = mockLaunchClaude.mock.calls[0]![0]!;
    expect(callArgs.workingDirectory).toBe('/tmp/custom-dir');
  });

  it('should pass config to the executor', async () => {
    mockSuccessfulClaude();
    writeArchitectureDesign(repoRoot, sessionId, '# Architecture\nDesign here.');

    await runArchitect(makeCtx());

    const callArgs = mockLaunchClaude.mock.calls[0]![0]!;
    expect(callArgs.config).toBe(config);
  });

  it('should include repoPromptContent in the Claude prompt when set on context', async () => {
    mockSuccessfulClaude();
    writeArchitectureDesign(repoRoot, sessionId, '# Architecture\nDesign here.');

    await runArchitect(makeCtx({ repoPromptContent: 'Always read CLAUDE.md files.' }));

    const callArgs = mockLaunchClaude.mock.calls[0]![0]!;
    expect(callArgs.prompt).toContain('Always read CLAUDE.md files.');
  });

  it('should register executor handle before waitForExit and unregister after', async () => {
    mockSuccessfulClaude();
    writeArchitectureDesign(repoRoot, sessionId, '# Architecture\nDesign here.');

    await runArchitect(makeCtx());

    expect(mockRegister).toHaveBeenCalledTimes(1);
    expect(mockUnregister).toHaveBeenCalledTimes(1);
    const handle = mockLaunchClaude.mock.results[0]!.value;
    expect(mockRegister).toHaveBeenCalledWith(handle);
    expect(mockUnregister).toHaveBeenCalledWith(handle);
  });
});
