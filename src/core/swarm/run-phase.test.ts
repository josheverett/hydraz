import { describe, it, expect, vi, afterEach } from 'vitest';
import { runClaudePhase } from './run-phase.js';
import { createDefaultConfig } from '../config/schema.js';
import type { ExecutionContext } from './types.js';

vi.mock('../claude/executor.js', () => ({
  launchClaude: vi.fn(),
}));

import { launchClaude } from '../claude/executor.js';

const mockLaunchClaude = vi.mocked(launchClaude);

afterEach(() => { vi.clearAllMocks(); });

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    repoRoot: '/tmp/repo',
    sessionId: 'test-session',
    sessionName: 'test',
    task: 'Do stuff',
    workingDirectory: '/tmp/workspace',
    config: createDefaultConfig(),
    swarmDir: '/tmp/swarm',
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
      cost: 0.10,
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
    }),
  });
}

describe('runClaudePhase', () => {
  it('should call launchClaude with the prompt and context', async () => {
    mockSuccessfulClaude();

    await runClaudePhase(makeCtx(), 'Do the thing');

    expect(mockLaunchClaude).toHaveBeenCalledTimes(1);
    const callArgs = mockLaunchClaude.mock.calls[0]![0]!;
    expect(callArgs.prompt).toBe('Do the thing');
    expect(callArgs.workingDirectory).toBe('/tmp/workspace');
    expect(callArgs.config).toBeDefined();
  });

  it('should return success when claude exits cleanly', async () => {
    mockSuccessfulClaude();

    const result = await runClaudePhase(makeCtx(), 'Do the thing');

    expect(result.success).toBe(true);
    expect(result.executorResult.success).toBe(true);
  });

  it('should return failure when claude exits with error', async () => {
    mockFailedClaude();

    const result = await runClaudePhase(makeCtx(), 'Do the thing');

    expect(result.success).toBe(false);
    expect(result.executorResult.success).toBe(false);
  });

  it('should pass containerContext when present', async () => {
    mockSuccessfulClaude();
    const containerContext = { workspaceName: 'test-container', authEnv: { TOKEN: 'abc' } };

    await runClaudePhase(makeCtx({ containerContext }), 'Do the thing');

    const callArgs = mockLaunchClaude.mock.calls[0]![0]!;
    expect(callArgs.containerContext).toEqual(containerContext);
  });

  it('should use workingDirectoryOverride when provided', async () => {
    mockSuccessfulClaude();

    await runClaudePhase(makeCtx(), 'Do the thing', '/tmp/override');

    const callArgs = mockLaunchClaude.mock.calls[0]![0]!;
    expect(callArgs.workingDirectory).toBe('/tmp/override');
  });
});
