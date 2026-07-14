import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { loadConfig } from '../config/index.js';
import { createEvent, appendEvent } from '../events/index.js';
import type { ExecutionTarget } from '../config/schema.js';
import {
  loadSession,
  saveSession,
  transitionState,
  isTerminalState,
  type SessionMetadata,
} from '../sessions/index.js';
import { getSessionDir } from '../sessions/manager.js';
import { LocalProvider } from '../providers/local.js';
import { LocalContainerProvider } from '../providers/local-container.js';
import { CloudProvider } from '../providers/cloud.js';
import {
  isContainerExecutionTarget,
  type WorkspaceProvider,
  type WorkspaceInfo,
} from '../providers/provider.js';
import {
  scpToContainer,
  stageCodexContainerImport,
  getDistRoot,
  sshExec,
  getContainerHome,
} from '../providers/devpod.js';
import { ensurePlaywrightContainerRuntime } from '../providers/playwright-container.js';
import { resolvePlaywrightRuntimeArchive } from '../providers/playwright-runtime.js';
import { processHydrazIncludes } from '../codex/repo-config.js';
import { buildCodexContainerImportPlan } from '../codex/container-import.js';
import { findAllOrphanedWorkspaces } from './cleanup.js';
import {
  CODEX_EVENTS_FILE,
  CODEX_FINAL_FILE,
  CODEX_RESULT_FILE,
  CODEX_STDERR_FILE,
  type CodexRunnerOptions,
  type CodexRunnerResult,
} from '../codex/runner.js';

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

export interface SwarmOptions {
  model?: string;
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  search?: boolean;
  verbose?: boolean;
  baseBranch?: string;
  skipClone?: boolean;
  noPush?: boolean;
  noPr?: boolean;
  keepWorkspace?: boolean;
}

const CONTAINER_DIST_PATH = '/tmp/hydraz-dist';
const CONTAINER_RUNNER_SCRIPT = `${CONTAINER_DIST_PATH}/core/codex/runner.js`;
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

function emit(
  repoRoot: string,
  sessionId: string,
  callbacks: ControllerCallbacks,
  type: Parameters<typeof createEvent>[1],
  message: string,
  metadata?: Record<string, unknown>,
): void {
  const event = createEvent(sessionId, type, message, metadata ? { metadata } : undefined);
  appendEvent(repoRoot, event);
  callbacks.onEvent?.(type, message);
  callbacks.onStreamLine?.(`${formatTs()}  ${type.padEnd(24)} ${message}`);
}

export async function startSession(
  sessionId: string,
  repoRoot: string,
  callbacks: ControllerCallbacks = {},
  options: SwarmOptions = {},
): Promise<void> {
  const config = loadConfig();
  const session = loadSession(repoRoot, sessionId);

  transitionState(repoRoot, sessionId, 'starting');
  callbacks.onStateChange?.(loadSession(repoRoot, sessionId));
  emit(repoRoot, sessionId, callbacks, 'session.state_changed', 'Session starting');

  const provider = getProvider(session.executionTarget);
  const providerCheck = provider.checkAvailability();
  if (!providerCheck.available) {
    const msg = providerCheck.error ?? 'Provider not available';
    transitionState(repoRoot, sessionId, 'blocked', msg);
    callbacks.onStateChange?.(loadSession(repoRoot, sessionId));
    emit(repoRoot, sessionId, callbacks, 'session.blocked', msg);
    callbacks.onError?.(msg);
    return;
  }

  warnForOrphans(repoRoot, sessionId, callbacks);

  let workspace: WorkspaceInfo;
  try {
    workspace = await provider.createWorkspace({
      session,
      config,
      branchOverride: options.baseBranch ?? session.baseBranch,
      skipClone: options.skipClone,
      onHeartbeat: (label, elapsedMs) => {
        emit(repoRoot, sessionId, callbacks, 'workspace.heartbeat', `${label}... (${Math.round(elapsedMs / 1000)}s)`);
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    transitionState(repoRoot, sessionId, 'failed', msg);
    callbacks.onStateChange?.(loadSession(repoRoot, sessionId));
    emit(repoRoot, sessionId, callbacks, 'session.failed', `Workspace creation failed: ${msg}`);
    callbacks.onError?.(msg);
    return;
  }

  const updated = loadSession(repoRoot, sessionId);
  updated.workspaceDir = workspace.directory;
  saveSession(repoRoot, updated);
  emit(repoRoot, sessionId, callbacks, 'workspace.created', `Workspace: ${workspace.directory}`);
  emit(repoRoot, sessionId, callbacks, 'branch.created', `Branch: ${session.branchName}`);

  try {
    const runner = await startCodexRunner(repoRoot, loadSession(repoRoot, sessionId), workspace, options, callbacks);
    const running = loadSession(repoRoot, sessionId);
    running.codex = runner;
    saveSession(repoRoot, running);
    transitionState(repoRoot, sessionId, 'syncing');
    callbacks.onStateChange?.(loadSession(repoRoot, sessionId));
    activeSessions.set(sessionId, { session: loadSession(repoRoot, sessionId), workspace });
    emit(repoRoot, sessionId, callbacks, 'codex.runner_started', `Codex runner started (pid ${runner.remotePid ?? 'local'})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    transitionState(repoRoot, sessionId, 'failed', msg);
    callbacks.onStateChange?.(loadSession(repoRoot, sessionId));
    emit(repoRoot, sessionId, callbacks, 'session.failed', msg);
    callbacks.onError?.(msg);
  } finally {
    activeSessions.delete(sessionId);
  }
}

async function startCodexRunner(
  repoRoot: string,
  session: SessionMetadata,
  workspace: WorkspaceInfo,
  options: SwarmOptions & { resumeThreadId?: string; resumePrompt?: string },
  callbacks: ControllerCallbacks,
): Promise<NonNullable<SessionMetadata['codex']>> {
  if (isContainerExecutionTarget(session.executionTarget)) {
    const workspaceName = `hydraz-${session.id}`;
    const distRoot = getDistRoot();
    if (session.executionTarget === 'local-container') {
      resolvePlaywrightRuntimeArchive(distRoot);
    }
    emit(repoRoot, session.id, callbacks, 'codex.container_setup', 'Copying Hydraz into container');
    await scpToContainer(workspaceName, distRoot, CONTAINER_DIST_PATH, (label, elapsedMs) => {
      emit(repoRoot, session.id, callbacks, 'workspace.heartbeat', `${label}... (${Math.round(elapsedMs / 1000)}s)`);
    });

    let containerHome: string | undefined;
    try {
      containerHome = getContainerHome(workspaceName);
      await processHydrazIncludes(
        repoRoot,
        workspaceName,
        scpToContainer,
        (msg) => emit(repoRoot, session.id, callbacks, 'codex.container_setup', msg),
        containerHome,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit(repoRoot, session.id, callbacks, 'session.warning', `hydrazincludes failed: ${msg}`);
    }

    containerHome ??= getContainerHome(workspaceName);
    const codexHome = posix.join(containerHome, '.hydraz', 'codex-homes', session.id);
    let playwrightRuntime: Awaited<ReturnType<typeof ensurePlaywrightContainerRuntime>> | undefined;
    if (session.executionTarget === 'local-container') {
      emit(repoRoot, session.id, callbacks, 'codex.container_setup', 'Provisioning direct Playwright runtime');
      playwrightRuntime = await ensurePlaywrightContainerRuntime(
        workspaceName,
        containerHome,
        (label, elapsedMs) => {
          emit(repoRoot, session.id, callbacks, 'workspace.heartbeat', `${label}... (${Math.round(elapsedMs / 1000)}s)`);
        },
      );
    }
    const importPlan = buildCodexContainerImportPlan(repoRoot);
    emit(repoRoot, session.id, callbacks, 'codex.container_setup', 'Importing portable Codex configuration');
    await stageCodexContainerImport(
      workspaceName,
      codexHome,
      importPlan,
      (label, elapsedMs) => {
        emit(repoRoot, session.id, callbacks, 'workspace.heartbeat', `${label}... (${Math.round(elapsedMs / 1000)}s)`);
      },
    );

    const codexDir = `/tmp/hydraz-codex/${session.id}`;
    const runnerOptions = buildRunnerOptions(repoRoot, session, workspace, codexDir, options, codexHome);
    const resultPath = `${codexDir}/${CODEX_RESULT_FILE}`;
    const runnerOutPath = `${codexDir}/runner.out`;
    const runnerErrPath = `${codexDir}/runner.err`;
    const envJson = shellEscape(JSON.stringify(runnerOptions));
    const launchRunnerCommand = [
      ...(playwrightRuntime === undefined
        ? []
        : [
            `PATH=${shellEscape(playwrightRuntime.binDir)}:$PATH`,
            `PLAYWRIGHT_BROWSERS_PATH=${shellEscape(playwrightRuntime.browsersPath)}`,
          ]),
      ...(codexHome === undefined ? [] : [`CODEX_HOME=${shellEscape(codexHome)}`]),
      `HYDRAZ_CODEX_RUNNER_OPTIONS=${envJson}`,
      `nohup node ${shellEscape(CONTAINER_RUNNER_SCRIPT)}`,
      `> ${shellEscape(runnerOutPath)}`,
      `2> ${shellEscape(runnerErrPath)}`,
      '< /dev/null',
      '& echo $!',
    ].join(' ');
    const command = [
      `mkdir -p ${shellEscape(codexDir)}`,
      `(${launchRunnerCommand})`,
    ].join(' && ');
    const pidText = sshExec(workspaceName, command).trim();
    const pid = Number.parseInt(pidText, 10);
    if (!Number.isFinite(pid)) {
      throw new Error(`Codex runner did not return a pid: ${pidText}`);
    }

    return {
      remotePid: pid,
      codexDir,
      eventsPath: `${codexDir}/${CODEX_EVENTS_FILE}`,
      stderrPath: `${codexDir}/${CODEX_STDERR_FILE}`,
      finalPath: `${codexDir}/${CODEX_FINAL_FILE}`,
      resultPath,
      runnerOutPath,
      runnerErrPath,
    };
  }

  const codexDir = join(getSessionDir(repoRoot, session.id), 'codex');
  const runnerOptions = buildRunnerOptions(repoRoot, session, workspace, codexDir, options);
  const runnerScript = join(getDistRoot(), 'core', 'codex', 'runner.js');
  const child = spawn(process.execPath, [runnerScript], {
    cwd: workspace.directory,
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      HYDRAZ_CODEX_RUNNER_OPTIONS: JSON.stringify(runnerOptions),
    },
  });
  child.unref();

  return {
    remotePid: child.pid,
    codexDir,
    eventsPath: join(codexDir, CODEX_EVENTS_FILE),
    stderrPath: join(codexDir, CODEX_STDERR_FILE),
    finalPath: join(codexDir, CODEX_FINAL_FILE),
    resultPath: join(codexDir, CODEX_RESULT_FILE),
  };
}

function buildRunnerOptions(
  repoRoot: string,
  session: SessionMetadata,
  workspace: WorkspaceInfo,
  codexDir: string,
  options: SwarmOptions & { resumeThreadId?: string; resumePrompt?: string },
  codexHome?: string,
): CodexRunnerOptions {
  const loadedConfig = loadConfig();
  const config = {
    ...loadedConfig,
    executionTarget: session.executionTarget,
    ...(isContainerExecutionTarget(session.executionTarget)
      ? {
          codex: {
            ...loadedConfig.codex,
            command: 'codex',
          },
        }
      : {}),
  };
  const sandbox = options.sandbox ?? (
    isContainerExecutionTarget(session.executionTarget)
      ? 'danger-full-access'
      : undefined
  );

  return {
    repoRoot: workspace.directory,
    sessionId: session.id,
    sessionName: session.name,
    branchName: session.branchName,
    baseBranch: options.baseBranch ?? session.baseBranch,
    goal: session.task,
    workingDirectory: workspace.directory,
    codexDir,
    ...(codexHome === undefined ? {} : { codexHome }),
    config,
    model: options.model,
    sandbox,
    search: options.search ?? true,
    skipGitRepoCheck: isContainerExecutionTarget(session.executionTarget),
    gitIdentity: workspace.gitIdentity,
    resumeThreadId: options.resumeThreadId,
    resumePrompt: options.resumePrompt,
    delivery: {
      enabled: !options.noPush,
      createPullRequest: !options.noPr,
      keepWorkspace: options.keepWorkspace ?? false,
    },
  };
}

export function refreshSessionStatus(
  sessionId: string,
  repoRoot: string,
  callbacks: ControllerCallbacks = {},
): SessionMetadata {
  const session = loadSession(repoRoot, sessionId);
  if (!session.codex?.resultPath || !session.workspaceDir || isTerminalState(session.state)) {
    return session;
  }

  let raw: string | null = null;
  try {
    if (isContainerExecutionTarget(session.executionTarget)) {
      raw = sshExec(`hydraz-${session.id}`, `cat ${shellEscape(session.codex.resultPath)}`);
    } else if (existsSync(session.codex.resultPath)) {
      raw = readFileSync(session.codex.resultPath, 'utf8');
    }
  } catch {
    return session;
  }

  if (!raw) return session;

  let result: CodexRunnerResult;
  try {
    result = JSON.parse(raw) as CodexRunnerResult;
  } catch {
    return session;
  }

  session.codex.threadId = result.threadId;
  session.codex.exitCode = result.exitCode;
  session.codex.delivery = result.delivery;
  saveSession(repoRoot, session);

  if (result.threadId) {
    emit(repoRoot, sessionId, callbacks, 'codex.thread_started', `Codex thread: ${result.threadId}`);
  }

  if (result.success) {
    if (result.delivery?.error) {
      transitionState(repoRoot, sessionId, 'failed', result.delivery.error);
      emit(repoRoot, sessionId, callbacks, 'codex.delivery_failed', result.delivery.error);
      return loadSession(repoRoot, sessionId);
    }

    transitionState(repoRoot, sessionId, 'delivering');
    if (result.delivery?.action === 'destroyed' && session.workspaceDir) {
      try {
        getProvider(session.executionTarget).destroyWorkspace(repoRoot, {
          id: session.id,
          type: session.executionTarget,
          directory: session.workspaceDir,
          branchName: session.branchName,
          sessionId: session.id,
        });
        emit(repoRoot, sessionId, callbacks, 'workspace.destroyed', 'Workspace cleaned up after delivery');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emit(repoRoot, sessionId, callbacks, 'workspace.preserved', `Workspace cleanup failed: ${message}`);
      }
    }
    transitionState(repoRoot, sessionId, 'completed');
    emit(repoRoot, sessionId, callbacks, 'session.completed', 'Codex run completed');
  } else {
    transitionState(repoRoot, sessionId, 'failed', result.error ?? 'Codex run failed');
    emit(repoRoot, sessionId, callbacks, 'codex.runner_failed', result.error ?? 'Codex run failed');
  }

  return loadSession(repoRoot, sessionId);
}

export async function resumeSession(
  sessionId: string,
  repoRoot: string,
  callbacks: ControllerCallbacks = {},
  options: SwarmOptions & { prompt?: string } = {},
): Promise<void> {
  if (isSessionRunning(sessionId)) {
    callbacks.onError?.('Cannot resume: session is currently running.');
    return;
  }

  const session = loadSession(repoRoot, sessionId);
  if (!session.codex?.threadId) {
    callbacks.onError?.('Cannot resume: no Codex thread id recorded for this session.');
    return;
  }
  if (!session.workspaceDir) {
    callbacks.onError?.('Cannot resume: workspace has already been cleaned up.');
    return;
  }
  if (!options.prompt?.trim()) {
    callbacks.onError?.('Cannot resume: prompt is required.');
    return;
  }
  if (session.state !== 'failed' && session.state !== 'stopped' && session.state !== 'blocked') {
    callbacks.onError?.(`Cannot resume a session in "${session.state}" state.`);
    return;
  }

  transitionState(repoRoot, sessionId, 'created');
  transitionState(repoRoot, sessionId, 'starting');
  const workspace: WorkspaceInfo = {
    id: session.id,
    type: session.executionTarget,
    directory: session.workspaceDir,
    branchName: session.branchName,
    sessionId: session.id,
  };
  const codex = await startCodexRunner(repoRoot, loadSession(repoRoot, sessionId), workspace, {
    ...options,
    resumeThreadId: session.codex.threadId,
    resumePrompt: options.prompt,
  }, callbacks);
  const updated = loadSession(repoRoot, sessionId);
  updated.codex = { ...updated.codex, ...codex, threadId: session.codex.threadId };
  saveSession(repoRoot, updated);
  transitionState(repoRoot, sessionId, 'syncing');
  emit(repoRoot, sessionId, callbacks, 'codex.runner_started', `Codex resume runner started (pid ${codex.remotePid ?? 'local'})`);
}

export function stopSession(
  sessionId: string,
  repoRoot: string,
  callbacks: ControllerCallbacks = {},
): void {
  const session = loadSession(repoRoot, sessionId);
  if (isTerminalState(session.state)) return;

  if (session.codex?.remotePid) {
    try {
      if (isContainerExecutionTarget(session.executionTarget)) {
        sshExec(`hydraz-${session.id}`, `kill ${session.codex.remotePid}`);
      } else {
        process.kill(session.codex.remotePid, 'SIGTERM');
      }
    } catch {
      // Best effort; state still records the user's stop request.
    }
  }

  transitionState(repoRoot, sessionId, 'stopped');
  callbacks.onStateChange?.(loadSession(repoRoot, sessionId));
  emit(repoRoot, sessionId, callbacks, 'session.stopped', 'Session stopped by user');
}

export function isSessionRunning(sessionId: string): boolean {
  return activeSessions.has(sessionId);
}

function warnForOrphans(repoRoot: string, sessionId: string, callbacks: ControllerCallbacks): void {
  try {
    const orphans = findAllOrphanedWorkspaces(repoRoot);
    if (orphans.total > 0) {
      const msg = `Warning: ${orphans.total} orphaned DevPod workspace(s) detected. Run 'hydraz clean' to remove them.`;
      emit(repoRoot, sessionId, callbacks, 'session.warning', msg);
      callbacks.onError?.(msg);
    }
  } catch {
    // non-fatal
  }
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
