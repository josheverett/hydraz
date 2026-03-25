import { loadConfig } from '../config/index.js';
import { resolveAuth, formatAuthResolution } from '../claude/resolver.js';
import { launchClaude, mapExitToSessionState, type ExecutorHandle } from '../claude/executor.js';
import { assemblePrompt } from '../prompts/builder.js';
import { createEvent, appendEvent } from '../events/index.js';
import { formatStreamEvent } from '../claude/stream-display.js';
import type { ParsedClaudeEvent } from '../claude/stream-parser.js';
import type { DisplayVerbosity, ExecutionTarget } from '../config/schema.js';
import {
  loadSession,
  saveSession,
  transitionState,
  type SessionMetadata,
} from '../sessions/index.js';
import { LocalProvider } from '../providers/local.js';
import { LocalContainerProvider } from '../providers/local-container.js';
import { CloudProvider } from '../providers/cloud.js';
import type { WorkspaceProvider, WorkspaceInfo } from '../providers/provider.js';

export interface ControllerCallbacks {
  onStateChange?: (session: SessionMetadata) => void;
  onStreamLine?: (formatted: string) => void;
  onEvent?: (type: string, message: string) => void;
  onError?: (message: string) => void;
}

export interface RunningSession {
  session: SessionMetadata;
  workspace: WorkspaceInfo;
  executor: ExecutorHandle | null;
}

const activeSessions = new Map<string, RunningSession>();

export function getProvider(target: ExecutionTarget): WorkspaceProvider {
  switch (target) {
    case 'local':
      return new LocalProvider();
    case 'local-container':
      return new LocalContainerProvider();
    case 'cloud':
      return new CloudProvider();
  }
}

function formatTs(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export async function startSession(
  sessionId: string,
  repoRoot: string,
  callbacks: ControllerCallbacks = {},
): Promise<void> {
  const config = loadConfig();
  const session = loadSession(repoRoot, sessionId);
  const verbosity: DisplayVerbosity = config.displayVerbosity ?? 'compact';

  const emitEvent = (type: Parameters<typeof createEvent>[1], message: string, extra?: Parameters<typeof createEvent>[3]) => {
    const event = createEvent(sessionId, type, message, extra);
    appendEvent(repoRoot, event);
    callbacks.onEvent?.(type, message);
    callbacks.onStreamLine?.(`${formatTs()}  ${type.padEnd(24)} ${message}`);
  };

  transitionState(repoRoot, sessionId, 'starting');
  callbacks.onStateChange?.(loadSession(repoRoot, sessionId));
  emitEvent('session.state_changed', 'Session starting');

  const auth = resolveAuth();
  emitEvent('claude.auth_resolved', `Auth: ${auth.modeDescription}`);

  if (!auth.resolved) {
    const errorMsg = auth.errors.join('; ');
    transitionState(repoRoot, sessionId, 'blocked', errorMsg);
    callbacks.onStateChange?.(loadSession(repoRoot, sessionId));
    emitEvent('session.blocked', `Auth failed: ${errorMsg}`);
    callbacks.onError?.(`Auth resolution failed:\n${formatAuthResolution(auth)}`);
    return;
  }

  const provider = getProvider(session.executionTarget);
  const providerCheck = provider.checkAvailability();
  if (!providerCheck.available) {
    const msg = providerCheck.error ?? 'Provider not available';
    transitionState(repoRoot, sessionId, 'blocked', msg);
    callbacks.onStateChange?.(loadSession(repoRoot, sessionId));
    emitEvent('session.blocked', msg);
    callbacks.onError?.(msg);
    return;
  }

  let workspace: WorkspaceInfo;
  try {
    workspace = provider.createWorkspace({ session, config });
    const updated = loadSession(repoRoot, sessionId);
    updated.workspaceDir = workspace.directory;
    saveSession(repoRoot, updated);
    emitEvent('workspace.created', `Workspace: ${workspace.directory}`);
    emitEvent('branch.created', `Branch: ${session.branchName}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    transitionState(repoRoot, sessionId, 'failed', msg);
    callbacks.onStateChange?.(loadSession(repoRoot, sessionId));
    emitEvent('session.failed', `Workspace creation failed: ${msg}`);
    callbacks.onError?.(msg);
    return;
  }

  transitionState(repoRoot, sessionId, 'planning');
  callbacks.onStateChange?.(loadSession(repoRoot, sessionId));
  emitEvent('swarm.started', 'Swarm initialized');
  emitEvent('swarm.phase_changed', 'Planning phase');

  const prompt = assemblePrompt(session);
  emitEvent('claude.ready', 'Claude Code launching');

  const containerContext = session.executionTarget === 'local-container'
    ? { workspaceName: `hydraz-${session.id}` }
    : undefined;

  const executor = launchClaude({
    workingDirectory: workspace.directory,
    prompt,
    config,
    containerContext,
    onStreamEvent: (event: ParsedClaudeEvent) => {
      const formatted = formatStreamEvent(event, verbosity);
      if (formatted) {
        callbacks.onStreamLine?.(formatted);
      }

      if (event.kind === 'tool_call') {
        appendEvent(repoRoot, createEvent(sessionId, 'swarm.phase_changed',
          `${event.toolName}: ${event.toolInput ?? ''}`,
        ));
      }
    },
  });

  activeSessions.set(sessionId, { session, workspace, executor });

  const result = await executor.waitForExit();
  activeSessions.delete(sessionId);

  const stateMapping = mapExitToSessionState(result);
  transitionState(repoRoot, sessionId, stateMapping.state, stateMapping.message);
  callbacks.onStateChange?.(loadSession(repoRoot, sessionId));

  if (stateMapping.state === 'completed') {
    emitEvent('session.completed', 'Session completed successfully');
  } else {
    emitEvent('session.failed', stateMapping.message ?? 'Session failed');
  }
}

export function stopSession(
  sessionId: string,
  repoRoot: string,
  callbacks: ControllerCallbacks = {},
): void {
  const running = activeSessions.get(sessionId);
  if (running?.executor) {
    running.executor.kill();
    activeSessions.delete(sessionId);
  }

  const session = loadSession(repoRoot, sessionId);
  if (['completed', 'stopped', 'failed'].includes(session.state)) {
    return;
  }

  transitionState(repoRoot, sessionId, 'stopped');
  callbacks.onStateChange?.(loadSession(repoRoot, sessionId));

  const event = createEvent(sessionId, 'session.stopped', 'Session stopped by user');
  appendEvent(repoRoot, event);
  callbacks.onEvent?.('session.stopped', 'Session stopped by user');
}

export async function resumeSession(
  sessionId: string,
  repoRoot: string,
  callbacks: ControllerCallbacks = {},
): Promise<void> {
  const session = loadSession(repoRoot, sessionId);

  if (['completed'].includes(session.state)) {
    callbacks.onError?.('Cannot resume a completed session.');
    return;
  }

  const event = createEvent(sessionId, 'session.attached', `Resuming session "${session.name}"`);
  appendEvent(repoRoot, event);
  callbacks.onEvent?.('session.attached', `Resuming session "${session.name}"`);

  session.state = 'created';
  session.updatedAt = new Date().toISOString();
  saveSession(repoRoot, session);

  await startSession(sessionId, repoRoot, callbacks);
}

export function isSessionRunning(sessionId: string): boolean {
  return activeSessions.has(sessionId);
}
