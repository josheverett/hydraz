import { listSessions, isTerminalState, type SessionState } from '../sessions/index.js';
import { devpodStatus, devpodDelete, devpodList } from '../providers/devpod.js';
import { isContainerExecutionTarget } from '../providers/provider.js';

export interface OrphanedWorkspace {
  sessionId: string;
  sessionName: string;
  workspaceName: string;
  sessionState: SessionState;
  branchName: string;
  devpodStatus: 'Running' | 'Stopped';
}

export interface UnknownOrphanedWorkspace {
  workspaceName: string;
  devpodStatus: string;
}

export interface AllOrphanedWorkspaces {
  known: OrphanedWorkspace[];
  unknown: UnknownOrphanedWorkspace[];
  total: number;
}

const HYDRAZ_PREFIX = 'hydraz-';

export function findOrphanedWorkspaces(repoRoot: string): OrphanedWorkspace[] {
  const sessions = listSessions(repoRoot);
  const orphans: OrphanedWorkspace[] = [];

  for (const session of sessions) {
    if (!isTerminalState(session.state)) continue;
    if (!isContainerExecutionTarget(session.executionTarget)) continue;

    const workspaceName = `${HYDRAZ_PREFIX}${session.id}`;
    const status = devpodStatus(workspaceName);

    if (status !== 'NotFound') {
      orphans.push({
        sessionId: session.id,
        sessionName: session.name,
        workspaceName,
        sessionState: session.state,
        branchName: session.branchName,
        devpodStatus: status,
      });
    }
  }

  return orphans;
}

export function findUnknownOrphanedWorkspaces(repoRoot: string): UnknownOrphanedWorkspace[] {
  const entries = devpodList();
  const hydrazEntries = entries.filter(e => e.name.startsWith(HYDRAZ_PREFIX));
  if (hydrazEntries.length === 0) return [];

  const sessions = listSessions(repoRoot);
  const activeSessionIds = new Set(
    sessions
      .filter(s => !isTerminalState(s.state))
      .map(s => s.id),
  );

  return hydrazEntries
    .filter(e => {
      const sessionId = e.name.slice(HYDRAZ_PREFIX.length);
      return !activeSessionIds.has(sessionId);
    })
    .map(e => ({
      workspaceName: e.name,
      devpodStatus: e.status,
    }));
}

export function findAllOrphanedWorkspaces(repoRoot: string): AllOrphanedWorkspaces {
  const known = findOrphanedWorkspaces(repoRoot);
  const knownNames = new Set(known.map(o => o.workspaceName));

  const allUnknown = findUnknownOrphanedWorkspaces(repoRoot);
  const unknown = allUnknown.filter(o => !knownNames.has(o.workspaceName));

  return {
    known,
    unknown,
    total: known.length + unknown.length,
  };
}

export function destroyOrphanedWorkspace(workspaceName: string): void {
  devpodDelete(workspaceName, true);
}
