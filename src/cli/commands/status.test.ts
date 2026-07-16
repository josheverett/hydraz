import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectRepo } from '../../core/repo/detect.js';
import { findSessionByName } from '../../core/sessions/index.js';
import { refreshSessionStatus } from '../../core/orchestration/index.js';
import {
  formatStoppedWorkspaceNotice,
  getSessionWorkspaceHealth,
} from '../workspace-health.js';
import { registerStatusCommand } from './status.js';

vi.mock('../../core/repo/detect.js', () => ({
  detectRepo: vi.fn(),
}));

vi.mock('../../core/sessions/index.js', () => ({
  findSessionByName: vi.fn(),
  getActiveSessions: vi.fn(() => []),
  isTerminalState: vi.fn(() => false),
}));

vi.mock('../../core/orchestration/index.js', () => ({
  refreshSessionStatus: vi.fn(),
}));

vi.mock('../workspace-health.js', () => ({
  getSessionWorkspaceHealth: vi.fn(),
  formatStoppedWorkspaceNotice: vi.fn(),
}));

const session = {
  id: 'session-1',
  name: 'demo',
  repoRoot: '/repo',
  branchName: 'hydraz/demo',
  executionTarget: 'cloud' as const,
  maxRuntime: '24h',
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
    invocationPath: '/tmp/hydraz-codex/session-1/invocation.json',
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
    vi.mocked(getSessionWorkspaceHealth).mockReturnValue({
      workspaceName: 'hydraz-session-1',
      status: 'Running',
    });
    vi.mocked(formatStoppedWorkspaceNotice).mockReturnValue('');
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
    expect(output).toContain('Max runtime: 24h');
    expect(output).toContain(
      'Invocation:  /tmp/hydraz-codex/session-1/invocation.json',
    );
    expect(output).toContain('Rollout:     matched');
    expect(output).toContain('Model check: matched');
    expect(output).toContain('Effort check: matched');
    expect(output).toContain('Tier check:  unavailable');
  });

  it('reports a stopped workspace without changing the session state', async () => {
    vi.mocked(getSessionWorkspaceHealth).mockReturnValue({
      workspaceName: 'hydraz-session-1',
      status: 'Stopped',
    });
    vi.mocked(formatStoppedWorkspaceNotice).mockReturnValue(
      'Workspace stopped before Hydraz received a runner result. Restart it with: devpod up hydraz-session-1',
    );
    const program = new Command();
    program.exitOverride();
    registerStatusCommand(program);

    await program.parseAsync(['node', 'hydraz', 'status', 'demo']);

    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('State:      syncing');
    expect(output).toContain('Workspace:  stopped');
    expect(output).toContain('devpod up hydraz-session-1');
    expect(refreshSessionStatus).not.toHaveBeenCalled();
  });
});
