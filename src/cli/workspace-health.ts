import { devpodStatus } from '../core/providers/devpod.js';
import {
  isTerminalState,
  type SessionMetadata,
} from '../core/sessions/index.js';

export interface SessionWorkspaceHealth {
  workspaceName: string;
  status: 'Running' | 'Stopped' | 'NotFound';
}

export function getSessionWorkspaceHealth(
  session: SessionMetadata,
): SessionWorkspaceHealth | null {
  if (session.executionTarget === 'local') {
    return null;
  }

  const workspaceName = `hydraz-${session.id}`;
  return {
    workspaceName,
    status: devpodStatus(workspaceName),
  };
}

export function formatStoppedWorkspaceNotice(
  health: SessionWorkspaceHealth,
  session: SessionMetadata,
): string {
  if (isTerminalState(session.state)) {
    return `Workspace is stopped. Restart it to access remote artifacts: devpod up ${health.workspaceName}`;
  }
  return `Workspace stopped before Hydraz received a runner result. Restart it with: devpod up ${health.workspaceName}`;
}
