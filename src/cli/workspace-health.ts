import { devpodStatus } from '../core/providers/devpod.js';
import type { SessionMetadata } from '../core/sessions/index.js';

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
): string {
  return `Workspace stopped before Hydraz received a runner result. Restart it with: devpod up ${health.workspaceName}`;
}
