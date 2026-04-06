import { listSessions, isTerminalState, type SessionState } from '../sessions/index.js';
import { devpodStatus, devpodDelete } from '../providers/devpod.js';
import { isContainerExecutionTarget } from '../providers/provider.js';

export interface OrphanedWorkspace {
  sessionId: string;
  sessionName: string;
  workspaceName: string;
  sessionState: SessionState;
  branchName: string;
  devpodStatus: 'Running' | 'Stopped';
}

export function findOrphanedWorkspaces(repoRoot: string): OrphanedWorkspace[] {
  const sessions = listSessions(repoRoot);
  const orphans: OrphanedWorkspace[] = [];

  for (const session of sessions) {
    if (!isTerminalState(session.state)) continue;
    if (!isContainerExecutionTarget(session.executionTarget)) continue;

    const workspaceName = `hydraz-${session.id}`;
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

export function destroyOrphanedWorkspace(workspaceName: string): void {
  devpodDelete(workspaceName);
}
