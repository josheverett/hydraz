import { spawn, execFileSync } from 'node:child_process';
import { loadConfig } from '../config/index.js';
import { resolveAuth, formatAuthResolution } from '../claude/resolver.js';
import { buildSshNodeCommand, shellEscape } from '../claude/ssh.js';
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
import { scpToContainer, getDistRoot, sshExec } from '../providers/devpod.js';
import { runSwarmPipeline, type PipelineResult } from '../swarm/pipeline.js';
import { ensureSwarmDirs, DEFAULT_SWARM_CONFIG } from '../swarm/index.js';
import { RESULT_PATH, CONTAINER_DIST_PATH, CONTAINER_RUNNER_SCRIPT } from '../swarm/pipeline-runner.js';
import { processHydrazIncludes } from '../swarm/repo-config.js';
import { registerSession, unregisterSession, registerSshChild } from './shutdown.js';
import { findAllOrphanedWorkspaces } from './cleanup.js';

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
  parallel?: boolean;
  verbose?: boolean;
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

  try {
    const orphans = findAllOrphanedWorkspaces(repoRoot);
    if (orphans.total > 0) {
      const msg = `Warning: ${orphans.total} orphaned DevPod workspace(s) detected. Run 'hydraz clean' to remove them.`;
      emitEvent('session.warning', msg);
      callbacks.onError?.(msg);
    }
  } catch {
    // non-fatal — don't block session start if orphan detection fails
  }

  let workspace: WorkspaceInfo;
  try {
    workspace = await provider.createWorkspace({
      session,
      config,
      onHeartbeat: (label, elapsedMs) => {
        emitEvent('workspace.heartbeat', `${label}... (${Math.round(elapsedMs / 1000)}s)`);
      },
    });
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
  registerSession(sessionId, repoRoot, provider, workspace, callbacks);

  const workerCount = swarmOptions.workerCount ?? DEFAULT_SWARM_CONFIG.defaultWorkerCount;
  const parallel = swarmOptions.parallel ?? false;
  const verbose = swarmOptions.verbose ?? false;
  const reviewerNames = swarmOptions.reviewerNames ?? DEFAULT_SWARM_CONFIG.defaultReviewers;
  const reviewerPersonas = reviewerNames.map(name => ({
    name,
    persona: `Review the code for correctness, completeness, and serious defects.`,
  }));

  let pipelineResult: PipelineResult;

  if (isContainerExecutionTarget(session.executionTarget)) {
    const workspaceName = `hydraz-${session.id}`;
    const authEnv = prepareContainerAuthEnv(config);

    try {
      emitEvent('swarm.container_setup', 'Copying Hydraz into container');
      await scpToContainer(workspaceName, getDistRoot(), CONTAINER_DIST_PATH, (label, elapsedMs) => {
        emitEvent('swarm.heartbeat', `${label}... (${Math.round(elapsedMs / 1000)}s)`);
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      transitionState(repoRoot, sessionId, 'failed', msg);
      callbacks.onStateChange?.(loadSession(repoRoot, sessionId));
      emitEvent('session.failed', `Container setup failed: ${msg}`);
      callbacks.onError?.(msg);
      try {
        provider.destroyWorkspace(repoRoot, workspace);
      } catch {
        // best-effort cleanup
      }
      unregisterSession(sessionId);
      activeSessions.delete(sessionId);
      return;
    }

    try {
      await processHydrazIncludes(
        repoRoot,
        workspaceName,
        scpToContainer,
        (msg) => emitEvent('swarm.container_setup', msg),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emitEvent('swarm.container_setup', `hydrazincludes SCP failed (non-fatal): ${msg}`);
      callbacks.onError?.(`hydrazincludes SCP failed: ${msg}`);
    }

    const optionsJson = JSON.stringify({
      repoRoot: workspace.directory,
      sessionId,
      sessionName: session.name,
      task: session.task,
      workingDirectory: workspace.directory,
      config,
      workerCount,
      reviewerPersonas,
      maxOuterLoops: DEFAULT_SWARM_CONFIG.outerLoopMaxIterations,
      maxConsensusRounds: DEFAULT_SWARM_CONFIG.consensusMaxRounds,
      parallel,
      verbose,
    });

    const ssh = buildSshNodeCommand(
      workspaceName,
      CONTAINER_RUNNER_SCRIPT,
      [],
      Object.keys(authEnv).length > 0 ? authEnv : undefined,
      undefined,
      optionsJson,
    );

    const SSH_HEARTBEAT_INTERVAL_MS = 30_000;
    const sshExitCode = await new Promise<number | null>((resolve) => {
      const child = spawn(ssh.cmd, ssh.args, { stdio: ['pipe', 'pipe', 'pipe'] });
      registerSshChild(child);
      if (ssh.stdinScript) {
        child.stdin?.write(ssh.stdinScript);
      }
      child.stdin?.end();

      const sshStartTime = Date.now();
      const heartbeatInterval = setInterval(() => {
        const elapsed = Math.round((Date.now() - sshStartTime) / 1000);
        emitEvent('swarm.heartbeat', `Pipeline running... (${elapsed}s)`);
      }, SSH_HEARTBEAT_INTERVAL_MS);

      let buffer = '';
      child.stdout?.on('data', (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'phase') {
              try {
                transitionState(repoRoot, sessionId, parsed.phase);
                callbacks.onStateChange?.(loadSession(repoRoot, sessionId));
              } catch {
                // phase transition may fail if already in a terminal state
              }
            } else if (parsed.type === 'event') {
              emitEvent(parsed.eventType as Parameters<typeof createEvent>[1], parsed.message);
            }
          } catch {
            callbacks.onStreamLine?.(line);
          }
        }
      });

      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString().trim();
        if (text) callbacks.onError?.(text);
      });

      child.on('close', (code) => {
        clearInterval(heartbeatInterval);
        resolve(code);
      });
      child.on('error', (err) => {
        clearInterval(heartbeatInterval);
        callbacks.onError?.(`SSH error: ${err.message}`);
        resolve(1);
      });
    });

    try {
      const resultJson = sshExec(workspaceName, `cat ${RESULT_PATH}`);
      pipelineResult = JSON.parse(resultJson);
    } catch {
      pipelineResult = {
        success: false,
        phase: 'failed',
        outerLoopsUsed: 0,
        consensusRoundsUsed: 0,
        approved: false,
        error: `Container pipeline exited with code ${sshExitCode} and result could not be read`,
      };
    }
  } else {
    pipelineResult = await runSwarmPipeline({
      repoRoot,
      sessionId,
      sessionName: session.name,
      task: session.task,
      workingDirectory: workspace.directory,
      config,
      workerCount,
      reviewerPersonas,
      maxOuterLoops: DEFAULT_SWARM_CONFIG.outerLoopMaxIterations,
      maxConsensusRounds: DEFAULT_SWARM_CONFIG.consensusMaxRounds,
      parallel,
      verbose,
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
          emitEvent(type as Parameters<typeof createEvent>[1], message);
        },
        onError: (message) => {
          callbacks.onError?.(message);
        },
      },
    });
  }

  unregisterSession(sessionId);
  activeSessions.delete(sessionId);

  const currentSession = loadSession(repoRoot, sessionId);
  if (!isTerminalState(currentSession.state)) {
    if (pipelineResult.success && pipelineResult.approved) {
      transitionState(repoRoot, sessionId, 'delivering');
      emitEvent('swarm.delivery_started', 'Delivery starting');

      if (isContainerExecutionTarget(session.executionTarget) && config.github.token) {
        const deliveryWorkspaceName = `hydraz-${session.id}`;
        try {
          const pushAuthEnv = prepareContainerAuthEnv(config);
          const pushScript = [
            'set -eu',
            ...Object.entries(pushAuthEnv).map(([k, v]) => `export ${k}=${shellEscape(v)}`),
            `cd ${shellEscape(workspace.directory)}`,
            `git push origin ${shellEscape(session.branchName)}`,
          ].join('\n') + '\n';

          execFileSync('ssh', [`${deliveryWorkspaceName}.devpod`, 'sh', '-s'], {
            input: pushScript,
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 120_000,
            encoding: 'utf-8',
          });
          emitEvent('branch.pushed', `Branch pushed: ${session.branchName}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          callbacks.onError?.(`Branch push failed: ${msg}`);
        }

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
      if (isContainerExecutionTarget(session.executionTarget)) {
        callbacks.onError?.(
          `Workspace preserved for inspection: devpod ssh hydraz-${session.id}`);
      }
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
  swarmOptions: SwarmOptions = {},
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

  await startSession(sessionId, repoRoot, callbacks, swarmOptions);
}

export function isSessionRunning(sessionId: string): boolean {
  return activeSessions.has(sessionId);
}
