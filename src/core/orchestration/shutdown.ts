import type { ChildProcess } from 'node:child_process';
import type { WorkspaceProvider, WorkspaceInfo } from '../providers/provider.js';
import { isContainerExecutionTarget } from '../providers/provider.js';
import { createEvent, appendEvent } from '../events/index.js';
import {
  loadSession,
  transitionState,
  isTerminalState,
} from '../sessions/index.js';
import type { ControllerCallbacks } from './controller.js';

interface RegisteredSession {
  sessionId: string;
  repoRoot: string;
  provider: WorkspaceProvider;
  workspace: WorkspaceInfo;
  callbacks: ControllerCallbacks;
}

let activeSession: RegisteredSession | null = null;
let sshChild: ChildProcess | null = null;
let shuttingDown = false;

export function registerSession(
  sessionId: string,
  repoRoot: string,
  provider: WorkspaceProvider,
  workspace: WorkspaceInfo,
  callbacks: ControllerCallbacks,
): void {
  activeSession = { sessionId, repoRoot, provider, workspace, callbacks };
}

export function unregisterSession(sessionId: string): void {
  if (activeSession?.sessionId === sessionId) {
    activeSession = null;
  }
  sshChild = null;
}

export function registerSshChild(child: ChildProcess): void {
  sshChild = child;
}

export function gracefulShutdown(): void {
  if (shuttingDown) {
    process.exit(1);
    return;
  }

  if (!activeSession) {
    return;
  }

  shuttingDown = true;

  const { sessionId, repoRoot, provider, workspace, callbacks } = activeSession;

  if (sshChild && !sshChild.killed) {
    sshChild.kill('SIGTERM');
  }

  try {
    const session = loadSession(repoRoot, sessionId);
    if (!isTerminalState(session.state)) {
      transitionState(repoRoot, sessionId, 'stopped');
      const event = createEvent(sessionId, 'session.stopped', 'Session interrupted by signal');
      appendEvent(repoRoot, event);
      callbacks.onEvent?.('session.stopped', 'Session interrupted by signal');
    }
  } catch {
    // session may be in a corrupt or already-finalized state
  }

  if (isContainerExecutionTarget(workspace.type)) {
    try {
      provider.destroyWorkspace(repoRoot, workspace);
    } catch {
      // best-effort — VM may already be gone
    }
  }

  process.exit(130);
}

export function _resetForTesting(): void {
  activeSession = null;
  sshChild = null;
  shuttingDown = false;
}
