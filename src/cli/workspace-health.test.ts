import { beforeEach, describe, expect, it, vi } from 'vitest';
import { devpodStatus } from '../core/providers/devpod.js';
import type { SessionMetadata } from '../core/sessions/index.js';
import {
  formatStoppedWorkspaceNotice,
  getSessionWorkspaceHealth,
} from './workspace-health.js';

vi.mock('../core/providers/devpod.js', () => ({
  devpodStatus: vi.fn(),
}));

function makeSession(executionTarget: SessionMetadata['executionTarget']): SessionMetadata {
  return {
    id: 'session-1',
    name: 'demo',
    repoRoot: '/repo',
    branchName: 'hydraz/demo',
    executionTarget,
    task: 'Do it',
    state: 'syncing',
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  };
}

describe('session workspace health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not query DevPod for local sessions', () => {
    expect(getSessionWorkspaceHealth(makeSession('local'))).toBeNull();
    expect(devpodStatus).not.toHaveBeenCalled();
  });

  it('returns the DevPod status for container sessions', () => {
    vi.mocked(devpodStatus).mockReturnValue('Stopped');

    expect(getSessionWorkspaceHealth(makeSession('cloud'))).toEqual({
      workspaceName: 'hydraz-session-1',
      status: 'Stopped',
    });
    expect(devpodStatus).toHaveBeenCalledWith('hydraz-session-1');
  });

  it('formats an actionable stopped-workspace notice', () => {
    expect(formatStoppedWorkspaceNotice({
      workspaceName: 'hydraz-session-1',
      status: 'Stopped',
    })).toBe(
      'Workspace stopped before Hydraz received a runner result. Restart it with: devpod up hydraz-session-1',
    );
  });
});
