import type { ChildProcess } from 'node:child_process';
import type { ExecutorHandle } from '../claude/executor.js';
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
const executorHandles = new Set<ExecutorHandle>();
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
  executorHandles.clear();
}

export function registerSshChild(child: ChildProcess): void {
  sshChild = child;
}

export function registerExecutorHandle(handle: ExecutorHandle): void {
  executorHandles.add(handle);
}

export function unregisterExecutorHandle(handle: ExecutorHandle): void {
  executorHandles.delete(handle);
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

  for (const handle of executorHandles) {
    handle.kill();
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
  executorHandles.clear();
  shuttingDown = false;
}
