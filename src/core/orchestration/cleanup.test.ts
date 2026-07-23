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
  devpodList: vi.fn(() => []),
  composeProjectName: vi.fn((workspaceName: string) => workspaceName.toLowerCase()),
  removeComposeProjectVolumes: vi.fn(),
}));

import { listSessions } from '../sessions/index.js';
import {
  composeProjectName,
  devpodStatus,
  devpodDelete,
  devpodList,
  removeComposeProjectVolumes,
} from '../providers/devpod.js';
import {
  findOrphanedWorkspaces,
  findUnknownOrphanedWorkspaces,
  findAllOrphanedWorkspaces,
  destroyOrphanedWorkspace,
} from './cleanup.js';

const mockListSessions = vi.mocked(listSessions);
const mockDevpodStatus = vi.mocked(devpodStatus);
const mockDevpodDelete = vi.mocked(devpodDelete);
const mockDevpodList = vi.mocked(devpodList);
const mockComposeProjectName = vi.mocked(composeProjectName);
const mockRemoveComposeProjectVolumes = vi.mocked(removeComposeProjectVolumes);

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
  mockDevpodList.mockReturnValue([]);
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
      makeSession({ state: 'syncing' }),
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

  it('finds stale workspaces for active sessions with a stopped DevPod workspace', () => {
    mockListSessions.mockReturnValue([
      makeSession({ id: 'stale-001', name: 'stale-session', state: 'syncing' }),
    ]);
    mockDevpodStatus.mockReturnValue('Stopped');

    const orphans = findOrphanedWorkspaces('/fake/repo');

    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.workspaceName).toBe('hydraz-stale-001');
    expect(orphans[0]!.sessionState).toBe('syncing');
    expect(orphans[0]!.devpodStatus).toBe('Stopped');
  });

  it('does not flag active sessions whose DevPod workspace is still running', () => {
    mockListSessions.mockReturnValue([
      makeSession({ id: 'active-001', state: 'syncing' }),
    ]);
    mockDevpodStatus.mockReturnValue('Running');

    const orphans = findOrphanedWorkspaces('/fake/repo');

    expect(orphans).toHaveLength(0);
  });
});

describe('destroyOrphanedWorkspace', () => {
  it('calls devpodDelete with force by default', () => {
    destroyOrphanedWorkspace('hydraz-sess-001');

    expect(mockDevpodDelete).toHaveBeenCalledWith('hydraz-sess-001', true);
  });

  it('removes Compose volumes for the orphaned workspace project', () => {
    destroyOrphanedWorkspace('hydraz-sess-001');

    expect(mockComposeProjectName).toHaveBeenCalledWith('hydraz-sess-001');
    expect(mockRemoveComposeProjectVolumes).toHaveBeenCalledWith('hydraz-sess-001');
  });

  it('propagates errors from devpodDelete', () => {
    mockDevpodDelete.mockImplementation(() => { throw new Error('delete failed'); });

    expect(() => destroyOrphanedWorkspace('hydraz-sess-001')).toThrow('delete failed');
  });
});

describe('findUnknownOrphanedWorkspaces', () => {
  it('finds hydraz-* workspaces from devpod list with no matching session', () => {
    mockDevpodList.mockReturnValue([
      { name: 'hydraz-unknown-uuid', status: 'Running' },
    ]);
    mockListSessions.mockReturnValue([]);

    const orphans = findUnknownOrphanedWorkspaces('/fake/repo');

    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.workspaceName).toBe('hydraz-unknown-uuid');
    expect(orphans[0]!.devpodStatus).toBe('Running');
  });

  it('ignores non-hydraz workspaces', () => {
    mockDevpodList.mockReturnValue([
      { name: 'other-workspace', status: 'Running' },
      { name: 'my-app', status: 'Stopped' },
    ]);
    mockListSessions.mockReturnValue([]);

    const orphans = findUnknownOrphanedWorkspaces('/fake/repo');

    expect(orphans).toHaveLength(0);
  });

  it('excludes workspaces that match an active (non-terminal) session', () => {
    mockDevpodList.mockReturnValue([
      { name: 'hydraz-active-sess', status: 'Running' },
    ]);
    mockListSessions.mockReturnValue([
      makeSession({ id: 'active-sess', state: 'syncing' }),
    ]);

    const orphans = findUnknownOrphanedWorkspaces('/fake/repo');

    expect(orphans).toHaveLength(0);
  });

  it('includes workspaces that match a terminal-state session', () => {
    mockDevpodList.mockReturnValue([
      { name: 'hydraz-done-sess', status: 'Running' },
    ]);
    mockListSessions.mockReturnValue([
      makeSession({ id: 'done-sess', state: 'completed' }),
    ]);

    const orphans = findUnknownOrphanedWorkspaces('/fake/repo');

    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.workspaceName).toBe('hydraz-done-sess');
  });

  it('returns empty array when devpod list returns no workspaces', () => {
    mockDevpodList.mockReturnValue([]);
    mockListSessions.mockReturnValue([
      makeSession({ id: 'sess-001', state: 'completed' }),
    ]);

    const orphans = findUnknownOrphanedWorkspaces('/fake/repo');

    expect(orphans).toHaveLength(0);
  });

  it('extracts session ID from workspace name by stripping hydraz- prefix', () => {
    mockDevpodList.mockReturnValue([
      { name: 'hydraz-abc-def-123', status: 'Stopped' },
    ]);
    mockListSessions.mockReturnValue([
      makeSession({ id: 'abc-def-123', state: 'syncing' }),
    ]);

    const orphans = findUnknownOrphanedWorkspaces('/fake/repo');

    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.workspaceName).toBe('hydraz-abc-def-123');
  });

  it('handles mix of known-active, known-terminal, and unknown workspaces', () => {
    mockDevpodList.mockReturnValue([
      { name: 'hydraz-active', status: 'Running' },
      { name: 'hydraz-done', status: 'Running' },
      { name: 'hydraz-unknown', status: 'Stopped' },
      { name: 'other-ws', status: 'Running' },
    ]);
    mockListSessions.mockReturnValue([
      makeSession({ id: 'active', state: 'syncing' }),
      makeSession({ id: 'done', state: 'completed' }),
    ]);

    const orphans = findUnknownOrphanedWorkspaces('/fake/repo');

    expect(orphans).toHaveLength(2);
    const names = orphans.map(o => o.workspaceName);
    expect(names).toContain('hydraz-done');
    expect(names).toContain('hydraz-unknown');
  });

  it('excludes workspaces matching local-only sessions', () => {
    mockDevpodList.mockReturnValue([
      { name: 'hydraz-local-sess', status: 'Running' },
    ]);
    mockListSessions.mockReturnValue([
      makeSession({ id: 'local-sess', state: 'syncing', executionTarget: 'local' }),
    ]);

    const orphans = findUnknownOrphanedWorkspaces('/fake/repo');

    expect(orphans).toHaveLength(0);
  });

  it('includes stopped workspaces even when matching an active session', () => {
    mockDevpodList.mockReturnValue([
      { name: 'hydraz-zombie-sess', status: 'Stopped' },
    ]);
    mockListSessions.mockReturnValue([
      makeSession({ id: 'zombie-sess', state: 'syncing' }),
    ]);

    const orphans = findUnknownOrphanedWorkspaces('/fake/repo');

    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.workspaceName).toBe('hydraz-zombie-sess');
  });

  it('still excludes running workspaces matching active sessions', () => {
    mockDevpodList.mockReturnValue([
      { name: 'hydraz-active-sess', status: 'Running' },
    ]);
    mockListSessions.mockReturnValue([
      makeSession({ id: 'active-sess', state: 'syncing' }),
    ]);

    const orphans = findUnknownOrphanedWorkspaces('/fake/repo');

    expect(orphans).toHaveLength(0);
  });
});

describe('findAllOrphanedWorkspaces', () => {
  it('returns both known and unknown orphans', () => {
    mockListSessions.mockReturnValue([
      makeSession({ id: 'known-orphan', name: 'known', state: 'completed' }),
    ]);
    mockDevpodStatus.mockReturnValue('Running');
    mockDevpodList.mockReturnValue([
      { name: 'hydraz-known-orphan', status: 'Running' },
      { name: 'hydraz-truly-unknown', status: 'Stopped' },
    ]);

    const result = findAllOrphanedWorkspaces('/fake/repo');

    expect(result.known).toHaveLength(1);
    expect(result.known[0]!.workspaceName).toBe('hydraz-known-orphan');
    expect(result.unknown).toHaveLength(1);
    expect(result.unknown[0]!.workspaceName).toBe('hydraz-truly-unknown');
  });

  it('returns empty arrays when no orphans exist', () => {
    mockListSessions.mockReturnValue([]);
    mockDevpodList.mockReturnValue([]);

    const result = findAllOrphanedWorkspaces('/fake/repo');

    expect(result.known).toHaveLength(0);
    expect(result.unknown).toHaveLength(0);
  });

  it('deduplicates: known orphans are not repeated in unknown list', () => {
    mockListSessions.mockReturnValue([
      makeSession({ id: 'sess-001', state: 'completed' }),
    ]);
    mockDevpodStatus.mockReturnValue('Running');
    mockDevpodList.mockReturnValue([
      { name: 'hydraz-sess-001', status: 'Running' },
    ]);

    const result = findAllOrphanedWorkspaces('/fake/repo');

    expect(result.known).toHaveLength(1);
    expect(result.unknown).toHaveLength(0);
  });

  it('provides total count across both categories', () => {
    mockListSessions.mockReturnValue([
      makeSession({ id: 'k1', state: 'failed' }),
      makeSession({ id: 'k2', state: 'completed' }),
    ]);
    mockDevpodStatus.mockReturnValue('Running');
    mockDevpodList.mockReturnValue([
      { name: 'hydraz-k1', status: 'Running' },
      { name: 'hydraz-k2', status: 'Running' },
      { name: 'hydraz-unknown-1', status: 'Running' },
    ]);

    const result = findAllOrphanedWorkspaces('/fake/repo');

    expect(result.total).toBe(3);
  });

  it('includes stale active sessions in the total', () => {
    mockListSessions.mockReturnValue([
      makeSession({ id: 'terminal-001', name: 'done', state: 'completed' }),
      makeSession({ id: 'stale-001', name: 'zombie', state: 'syncing' }),
      makeSession({ id: 'active-001', name: 'running', state: 'syncing' }),
    ]);
    mockDevpodStatus.mockImplementation((name: string) => {
      if (name === 'hydraz-terminal-001') return 'Running';
      if (name === 'hydraz-stale-001') return 'Stopped';
      if (name === 'hydraz-active-001') return 'Running';
      return 'NotFound';
    });
    mockDevpodList.mockReturnValue([
      { name: 'hydraz-terminal-001', status: 'Running' },
      { name: 'hydraz-stale-001', status: 'Stopped' },
      { name: 'hydraz-active-001', status: 'Running' },
    ]);

    const result = findAllOrphanedWorkspaces('/fake/repo');

    expect(result.total).toBe(2);
  });
});
