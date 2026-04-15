import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionMetadata, SessionState } from '../sessions/schema.js';
import type { ExecutionTarget } from '../config/schema.js';

vi.mock('../sessions/index.js', () => ({
  listSessions: vi.fn(() => []),
  isTerminalState: vi.fn((state: string) =>
    ['completed', 'stopped', 'failed', 'blocked'].includes(state),
  ),
}));

vi.mock('../providers/devpod.js', () => ({
  devpodStatus: vi.fn(() => 'NotFound' as const),
  devpodDelete: vi.fn(),
}));

import { listSessions } from '../sessions/index.js';
import { devpodStatus, devpodDelete } from '../providers/devpod.js';
import { findOrphanedWorkspaces, destroyOrphanedWorkspace } from './cleanup.js';

const mockListSessions = vi.mocked(listSessions);
const mockDevpodStatus = vi.mocked(devpodStatus);
const mockDevpodDelete = vi.mocked(devpodDelete);

function makeSession(overrides: {
  id?: string;
  name?: string;
  state?: SessionState;
  executionTarget?: ExecutionTarget;
  branchName?: string;
} = {}): SessionMetadata {
  return {
    id: overrides.id ?? 'sess-001',
    name: overrides.name ?? 'test-session',
    repoRoot: '/fake/repo',
    branchName: overrides.branchName ?? 'hydraz/test-session',
    personas: ['architect', 'implementer', 'verifier'],
    executionTarget: overrides.executionTarget ?? 'local-container',
    task: 'Fix it',
    state: overrides.state ?? 'completed',
    createdAt: '2026-03-26T00:00:00Z',
    updatedAt: '2026-03-26T01:00:00Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDevpodStatus.mockReturnValue('NotFound');
});

describe('findOrphanedWorkspaces', () => {
  it('finds workspaces for terminal container sessions that still exist in DevPod', () => {
    mockListSessions.mockReturnValue([
      makeSession({ id: 'sess-001', name: 'done-session', state: 'completed' }),
    ]);
    mockDevpodStatus.mockReturnValue('Running');

    const orphans = findOrphanedWorkspaces('/fake/repo');

    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.workspaceName).toBe('hydraz-sess-001');
    expect(orphans[0]!.sessionName).toBe('done-session');
    expect(orphans[0]!.devpodStatus).toBe('Running');
  });

  it('ignores active sessions', () => {
    mockListSessions.mockReturnValue([
      makeSession({ state: 'planning' }),
      makeSession({ id: 'sess-002', state: 'syncing' }),
    ]);
    mockDevpodStatus.mockReturnValue('Running');

    const orphans = findOrphanedWorkspaces('/fake/repo');

    expect(orphans).toHaveLength(0);
  });

  it('ignores local bare-metal sessions', () => {
    mockListSessions.mockReturnValue([
      makeSession({ state: 'completed', executionTarget: 'local' }),
    ]);
    mockDevpodStatus.mockReturnValue('Running');

    const orphans = findOrphanedWorkspaces('/fake/repo');

    expect(orphans).toHaveLength(0);
    expect(mockDevpodStatus).not.toHaveBeenCalled();
  });

  it('ignores sessions where DevPod workspace is already gone', () => {
    mockListSessions.mockReturnValue([
      makeSession({ state: 'completed' }),
    ]);
    mockDevpodStatus.mockReturnValue('NotFound');

    const orphans = findOrphanedWorkspaces('/fake/repo');

    expect(orphans).toHaveLength(0);
  });

  it('returns empty array when no sessions exist', () => {
    mockListSessions.mockReturnValue([]);

    const orphans = findOrphanedWorkspaces('/fake/repo');

    expect(orphans).toHaveLength(0);
  });

  it('includes stopped workspaces', () => {
    mockListSessions.mockReturnValue([
      makeSession({ state: 'failed' }),
    ]);
    mockDevpodStatus.mockReturnValue('Stopped');

    const orphans = findOrphanedWorkspaces('/fake/repo');

    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.devpodStatus).toBe('Stopped');
  });

  it('includes cloud sessions in the DevPod orphan scan', () => {
    mockListSessions.mockReturnValue([
      makeSession({ id: 'cloud-001', state: 'completed', executionTarget: 'cloud' }),
    ]);
    mockDevpodStatus.mockReturnValue('Running');

    const orphans = findOrphanedWorkspaces('/fake/repo');

    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.workspaceName).toBe('hydraz-cloud-001');
  });

  it('checks all terminal states: completed, stopped, failed, blocked', () => {
    const sessions = [
      makeSession({ id: 's1', state: 'completed' }),
      makeSession({ id: 's2', state: 'stopped' }),
      makeSession({ id: 's3', state: 'failed' }),
      makeSession({ id: 's4', state: 'blocked' }),
    ];
    mockListSessions.mockReturnValue(sessions);
    mockDevpodStatus.mockReturnValue('Running');

    const orphans = findOrphanedWorkspaces('/fake/repo');

    expect(orphans).toHaveLength(4);
  });

  it('preserves branch name in orphan info', () => {
    mockListSessions.mockReturnValue([
      makeSession({ state: 'completed', branchName: 'hydraz/my-feature' }),
    ]);
    mockDevpodStatus.mockReturnValue('Running');

    const orphans = findOrphanedWorkspaces('/fake/repo');

    expect(orphans[0]!.branchName).toBe('hydraz/my-feature');
  });
});

describe('destroyOrphanedWorkspace', () => {
  it('calls devpodDelete with the workspace name', () => {
    destroyOrphanedWorkspace('hydraz-sess-001');

    expect(mockDevpodDelete).toHaveBeenCalledWith('hydraz-sess-001');
  });

  it('propagates errors from devpodDelete', () => {
    mockDevpodDelete.mockImplementation(() => { throw new Error('delete failed'); });

    expect(() => destroyOrphanedWorkspace('hydraz-sess-001')).toThrow('delete failed');
  });
});
