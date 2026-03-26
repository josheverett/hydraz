import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../providers/devpod.js', () => ({
  sshExec: vi.fn(),
  verifyBranchPushed: vi.fn(),
}));

import { verifyBranchPushed } from '../providers/devpod.js';
import { cleanupContainerWorkspace } from './controller.js';
import type { WorkspaceInfo, WorkspaceProvider } from '../providers/provider.js';

const mockVerifyBranchPushed = vi.mocked(verifyBranchPushed);

function makeWorkspace(sessionId: string = 'session-123'): WorkspaceInfo {
  return {
    id: sessionId,
    type: 'local-container',
    directory: `/tmp/hydraz-worktrees/${sessionId}`,
    branchName: 'hydraz/test-branch',
    sessionId,
  };
}

function makeProvider(): WorkspaceProvider {
  return {
    type: 'local-container',
    createWorkspace: vi.fn(),
    destroyWorkspace: vi.fn(),
    checkAvailability: vi.fn(() => ({ available: true })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cleanupContainerWorkspace', () => {
  it('destroys workspace when branch is pushed to remote', () => {
    mockVerifyBranchPushed.mockReturnValue(true);
    const provider = makeProvider();
    const workspace = makeWorkspace();

    const result = cleanupContainerWorkspace(
      'session-123', workspace, 'hydraz/test-branch', '/fake/repo', provider,
    );

    expect(result.action).toBe('destroyed');
    expect(provider.destroyWorkspace).toHaveBeenCalledWith('/fake/repo', workspace);
  });

  it('preserves workspace when branch is not pushed to remote', () => {
    mockVerifyBranchPushed.mockReturnValue(false);
    const provider = makeProvider();
    const workspace = makeWorkspace();

    const result = cleanupContainerWorkspace(
      'session-123', workspace, 'hydraz/test-branch', '/fake/repo', provider,
    );

    expect(result.action).toBe('preserved');
    expect(provider.destroyWorkspace).not.toHaveBeenCalled();
  });

  it('includes recovery instructions in preserved message', () => {
    mockVerifyBranchPushed.mockReturnValue(false);
    const provider = makeProvider();
    const workspace = makeWorkspace();

    const result = cleanupContainerWorkspace(
      'session-123', workspace, 'hydraz/test-branch', '/fake/repo', provider,
    );

    expect(result.message).toContain('devpod ssh hydraz-session-123');
    expect(result.message).toContain('hydraz/test-branch');
  });

  it('verifies push using the correct workspace name, worktree path, and branch', () => {
    mockVerifyBranchPushed.mockReturnValue(true);
    const provider = makeProvider();
    const workspace = makeWorkspace('sess-abc');

    cleanupContainerWorkspace(
      'sess-abc', workspace, 'hydraz/my-feature', '/fake/repo', provider,
    );

    expect(mockVerifyBranchPushed).toHaveBeenCalledWith(
      'hydraz-sess-abc',
      '/tmp/hydraz-worktrees/sess-abc',
      'hydraz/my-feature',
    );
  });

  it('uses hydraz-prefixed workspace name for DevPod', () => {
    mockVerifyBranchPushed.mockReturnValue(false);
    const provider = makeProvider();
    const workspace = makeWorkspace('my-session');

    const result = cleanupContainerWorkspace(
      'my-session', workspace, 'hydraz/branch', '/fake/repo', provider,
    );

    expect(result.message).toContain('hydraz-my-session');
  });

  it('returns destroyed message on successful cleanup', () => {
    mockVerifyBranchPushed.mockReturnValue(true);
    const provider = makeProvider();
    const workspace = makeWorkspace();

    const result = cleanupContainerWorkspace(
      'session-123', workspace, 'hydraz/test-branch', '/fake/repo', provider,
    );

    expect(result.message).toContain('verified push');
  });
});
