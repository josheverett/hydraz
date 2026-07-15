import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectRepo } from '../../core/repo/detect.js';
import { findSessionByName } from '../../core/sessions/index.js';
import { refreshSessionStatus } from '../../core/orchestration/index.js';
import { registerStatusCommand } from './status.js';

vi.mock('../../core/repo/detect.js', () => ({
  detectRepo: vi.fn(),
}));

vi.mock('../../core/sessions/index.js', () => ({
  findSessionByName: vi.fn(),
  getActiveSessions: vi.fn(() => []),
}));

vi.mock('../../core/orchestration/index.js', () => ({
  refreshSessionStatus: vi.fn(),
}));

const session = {
  id: 'session-1',
  name: 'demo',
  repoRoot: '/repo',
  branchName: 'hydraz/demo',
  executionTarget: 'cloud' as const,
  task: 'Do it',
  state: 'syncing' as const,
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  codex: {
    requestedConfig: {
      model: 'gpt-5.6-sol',
      reasoningEffort: 'ultra' as const,
      speed: 'fast' as const,
    },
    invocationPath: '/tmp/hydraz-codex/session-1/codex-invocation.json',
    rolloutVerification: {
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
};

describe('status command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(detectRepo).mockReturnValue({ root: '/repo', name: 'repo' });
    vi.mocked(findSessionByName).mockReturnValue(session);
    vi.mocked(refreshSessionStatus).mockReturnValue(session);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows managed Codex settings and invocation evidence path', async () => {
    const program = new Command();
    program.exitOverride();
    registerStatusCommand(program);

    await program.parseAsync(['node', 'hydraz', 'status', 'demo']);

    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('Codex model: gpt-5.6-sol');
    expect(output).toContain('Reasoning:   ultra');
    expect(output).toContain('Speed:       fast');
    expect(output).toContain(
      'Invocation:  /tmp/hydraz-codex/session-1/codex-invocation.json',
    );
    expect(output).toContain('Rollout:     matched');
    expect(output).toContain('Model check: matched');
    expect(output).toContain('Effort check: matched');
    expect(output).toContain('Tier check:  unavailable');
  });
});
