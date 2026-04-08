import { loadConfig } from '../config/index.js';
import { resolveAuth, formatAuthResolution } from '../claude/resolver.js';
import { createEvent, appendEvent } from '../events/index.js';
import type { ExecutionTarget } from '../config/schema.js';
import {
  loadSession,
  saveSession,
  transitionState,
  isTerminalState,
  RESUMABLE_STATES,
  type SessionMetadata,
} from '../sessions/index.js';
import { LocalProvider } from '../providers/local.js';
import { LocalContainerProvider } from '../providers/local-container.js';
import { CloudProvider } from '../providers/cloud.js';
import { finalizeGitHubContainerDelivery } from '../github/delivery.js';
import { prepareContainerAuthEnv, validateContainerAuth } from '../providers/container-auth.js';
import { getGitHubAutomationReadiness } from '../github/requirements.js';
import {
  isContainerExecutionTarget,
  type WorkspaceProvider,
  type WorkspaceInfo,
} from '../providers/provider.js';
import { runSwarmPipeline } from '../swarm/pipeline.js';
import { ensureSwarmDirs } from '../swarm/artifacts.js';
import { DEFAULT_SWARM_CONFIG } from '../swarm/types.js';

export interface ControllerCallbacks {
  onStateChange?: (session: SessionMetadata) => void;
  onStreamLine?: (formatted: string) => void;
  onEvent?: (type: string, message: string) => void;
  onError?: (message: string) => void;
}

export interface RunningSession {
  session: SessionMetadata;
  workspace: WorkspaceInfo;
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

export interface SwarmOptions {
  workerCount?: number;
  reviewerNames?: string[];
}

export async function startSession(
  sessionId: string,
  repoRoot: string,
  callbacks: ControllerCallbacks = {},
  swarmOptions: SwarmOptions = {},
): Promise<void> {
  const config = loadConfig();
  const session = loadSession(repoRoot, sessionId);

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

  if (isContainerExecutionTarget(session.executionTarget)) {
    const containerAuth = validateContainerAuth(config);
    if (!containerAuth.valid) {
      const msg = containerAuth.error ?? 'Container auth not configured';
      transitionState(repoRoot, sessionId, 'blocked', msg);
      callbacks.onStateChange?.(loadSession(repoRoot, sessionId));
      emitEvent('session.blocked', msg);
      callbacks.onError?.(msg);
      return;
    }

    const gitHubAutomation = getGitHubAutomationReadiness(config, repoRoot);
    if (!gitHubAutomation.ok) {
      const msg = gitHubAutomation.error ?? 'GitHub automation is not configured';
      transitionState(repoRoot, sessionId, 'blocked', msg);
      callbacks.onStateChange?.(loadSession(repoRoot, sessionId));
      emitEvent('session.blocked', msg);
      callbacks.onError?.(msg);
      return;
    }
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

  ensureSwarmDirs(repoRoot, sessionId);
  emitEvent('swarm.started', 'Swarm pipeline initialized');

  activeSessions.set(sessionId, { session, workspace });

  const workerCount = swarmOptions.workerCount ?? DEFAULT_SWARM_CONFIG.defaultWorkerCount;
  const reviewerNames = swarmOptions.reviewerNames ?? DEFAULT_SWARM_CONFIG.defaultReviewers;

  let containerContext: { workspaceName: string; authEnv?: Record<string, string>; workingDirectory?: string } | undefined;
  if (isContainerExecutionTarget(session.executionTarget)) {
    const workspaceName = `hydraz-${session.id}`;
    const authEnv = prepareContainerAuthEnv(config);
    containerContext = {
      workspaceName,
      authEnv: Object.keys(authEnv).length > 0 ? authEnv : undefined,
      workingDirectory: workspace.directory,
    };
  }

  const pipelineResult = await runSwarmPipeline({
    repoRoot,
    sessionId,
    sessionName: session.name,
    task: session.task,
    workingDirectory: workspace.directory,
    config,
    workerCount,
    reviewerPersonas: reviewerNames.map(name => ({
      name,
      persona: `You are ${name}. Review the code with your characteristic engineering perspective.`,
    })),
    maxOuterLoops: DEFAULT_SWARM_CONFIG.outerLoopMaxIterations,
    maxConsensusRounds: DEFAULT_SWARM_CONFIG.consensusMaxRounds,
    containerContext,
    callbacks: {
      onPhaseChange: (phase) => {
        try {
          transitionState(repoRoot, sessionId, phase);
          callbacks.onStateChange?.(loadSession(repoRoot, sessionId));
        } catch {
          // phase transition may fail if already in a terminal state
        }
      },
      onEvent: (type, message) => {
        callbacks.onEvent?.(type, message);
        callbacks.onStreamLine?.(`${formatTs()}  ${type.padEnd(24)} ${message}`);
      },
      onError: (message) => {
        callbacks.onError?.(message);
      },
    },
  });

  activeSessions.delete(sessionId);

  const currentSession = loadSession(repoRoot, sessionId);
  if (!isTerminalState(currentSession.state)) {
    if (pipelineResult.success && pipelineResult.approved) {
      transitionState(repoRoot, sessionId, 'delivering');
      emitEvent('swarm.delivery_started', 'Delivery starting');

      if (isContainerExecutionTarget(session.executionTarget) && config.github.token) {
        try {
          const containerDelivery = await finalizeGitHubContainerDelivery({
            session,
            workspace,
            repoRoot,
            provider,
            token: config.github.token,
            createPullRequest: true,
          });

          if (containerDelivery.prUrl) {
            emitEvent('pull_request.created', `Pull request: ${containerDelivery.prUrl}`);
          }

          if (containerDelivery.action === 'destroyed') {
            emitEvent('workspace.destroyed', containerDelivery.message);
          } else {
            emitEvent('workspace.preserved', containerDelivery.message);
            callbacks.onError?.(
              `${containerDelivery.message}\n` +
              `To access and manually recover: devpod ssh hydraz-${session.id}`);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          emitEvent('workspace.preserved', `Workspace preserved after delivery failure: ${message}`);
        }
      }

      transitionState(repoRoot, sessionId, 'completed');
      callbacks.onStateChange?.(loadSession(repoRoot, sessionId));
      emitEvent('session.completed', 'Session completed successfully');
      emitEvent('swarm.delivery_completed', 'Delivery complete');
    } else {
      const failMsg = pipelineResult.error ?? 'Pipeline did not produce an approved result';
      transitionState(repoRoot, sessionId, 'failed', failMsg);
      callbacks.onStateChange?.(loadSession(repoRoot, sessionId));
      emitEvent('session.failed', failMsg);
    }
  }
}

export function stopSession(
  sessionId: string,
  repoRoot: string,
  callbacks: ControllerCallbacks = {},
): void {
  activeSessions.delete(sessionId);

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
  if (isSessionRunning(sessionId)) {
    callbacks.onError?.('Cannot resume: session is currently running.');
    return;
  }

  const session = loadSession(repoRoot, sessionId);

  if (!(RESUMABLE_STATES as readonly string[]).includes(session.state)) {
    callbacks.onError?.(`Cannot resume a session in "${session.state}" state.`);
    return;
  }

  const event = createEvent(sessionId, 'session.attached', `Resuming session "${session.name}"`);
  appendEvent(repoRoot, event);
  callbacks.onEvent?.('session.attached', `Resuming session "${session.name}"`);

  transitionState(repoRoot, sessionId, 'created');

  await startSession(sessionId, repoRoot, callbacks);
}

export function isSessionRunning(sessionId: string): boolean {
  return activeSessions.has(sessionId);
}
