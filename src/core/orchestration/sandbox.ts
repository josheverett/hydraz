import { loadConfig, configExists } from '../config/index.js';
import { resolveAuth } from '../claude/resolver.js';
import { validateContainerAuth } from '../providers/container-auth.js';
import { getGitHubAutomationReadiness } from '../github/requirements.js';
import { getProvider } from './controller.js';
import { createNewSession, initRepoState } from '../sessions/index.js';
import { suggestBranchName } from '../branches/index.js';
import { scpToContainer, getDistRoot, devpodSsh, devpodDelete } from '../providers/devpod.js';
import { CONTAINER_DIST_PATH } from '../swarm/pipeline-runner.js';
import { processHydrazIncludes } from '../swarm/repo-config.js';
import { debug, debugTiming } from '../debug.js';
import type { ExecutionTarget } from '../config/schema.js';

export interface SandboxStep {
  name: string;
  status: 'ok' | 'fail' | 'skip';
  detail?: string;
  durationMs?: number;
}

export interface SandboxResult {
  entered: boolean;
  steps: SandboxStep[];
  workspaceName?: string;
}

export interface SandboxOptions {
  executionTarget: ExecutionTarget;
  repoRoot: string;
  cleanup: boolean;
  branchOverride?: string;
  skipClone?: boolean;
  onStep?: (step: SandboxStep) => void;
}

function emitStep(
  steps: SandboxStep[],
  onStep: SandboxOptions['onStep'],
  step: SandboxStep,
): void {
  steps.push(step);
  onStep?.(step);
}

function timed(startMs: number): number {
  return Date.now() - startMs;
}

export async function runSandbox(options: SandboxOptions): Promise<SandboxResult> {
  const { executionTarget, repoRoot, onStep } = options;
  const steps: SandboxStep[] = [];

  debug(`runSandbox: executionTarget=${executionTarget} repoRoot=${repoRoot}`);

  initRepoState(repoRoot);
  const config = loadConfig();
  debug(`runSandbox: config loaded — authMode=${config.claudeAuth.mode}`);

  const auth = resolveAuth();
  debug(`runSandbox: auth resolved=${auth.resolved} mode=${auth.modeDescription}`);
  if (!auth.resolved) {
    emitStep(steps, onStep, { name: 'Auth', status: 'fail', detail: auth.errors.join('; ') });
    return { entered: false, steps };
  }
  emitStep(steps, onStep, { name: 'Auth', status: 'ok', detail: auth.modeDescription });

  const containerAuth = validateContainerAuth(config);
  debug(`runSandbox: containerAuth valid=${containerAuth.valid}`);
  if (!containerAuth.valid) {
    emitStep(steps, onStep, { name: 'Container auth', status: 'fail', detail: containerAuth.error });
    return { entered: false, steps };
  }
  emitStep(steps, onStep, { name: 'Container auth', status: 'ok' });

  if (!options.skipClone) {
    const ghReady = getGitHubAutomationReadiness(config, repoRoot);
    debug(`runSandbox: githubAutomation ok=${ghReady.ok}`);
    if (!ghReady.ok) {
      emitStep(steps, onStep, { name: 'GitHub config', status: 'fail', detail: ghReady.error });
      return { entered: false, steps };
    }
    emitStep(steps, onStep, { name: 'GitHub config', status: 'ok' });
  }

  const provider = getProvider(executionTarget);
  debug(`runSandbox: provider type=${provider.type}`);
  const providerCheck = provider.checkAvailability();
  if (!providerCheck.available) {
    emitStep(steps, onStep, { name: 'Provider', status: 'fail', detail: providerCheck.error });
    return { entered: false, steps };
  }
  emitStep(steps, onStep, { name: 'Provider', status: 'ok' });

  const timestamp = Math.floor(Date.now() / 1000);
  const sessionName = `sandbox-${timestamp}`;
  const branchName = suggestBranchName(sessionName, config.branchNaming.prefix);
  debug(`runSandbox: sessionName=${sessionName} branchName=${branchName}`);

  const session = createNewSession({
    name: sessionName,
    repoRoot,
    branchName,
    personas: config.defaultPersonas,
    executionTarget,
    task: 'sandbox',
  });
  debug(`runSandbox: session created id=${session.id}`);

  const workspaceName = `hydraz-${session.id}`;

  const wsStart = Date.now();
  let workspace;
  try {
    workspace = await provider.createWorkspace({ session, config, branchOverride: options.branchOverride, skipClone: options.skipClone });
    debugTiming('runSandbox: createWorkspace', timed(wsStart));
    emitStep(steps, onStep, {
      name: 'Workspace',
      status: 'ok',
      detail: workspaceName,
      durationMs: timed(wsStart),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    debugTiming('runSandbox: createWorkspace (failed)', timed(wsStart));
    emitStep(steps, onStep, { name: 'Workspace', status: 'fail', detail: msg, durationMs: timed(wsStart) });
    return { entered: false, steps };
  }

  const distRoot = getDistRoot();
  debug(`runSandbox: scpToContainer localPath=${distRoot} remotePath=${CONTAINER_DIST_PATH}`);
  const scpStart = Date.now();
  try {
    await scpToContainer(workspaceName, distRoot, CONTAINER_DIST_PATH);
    debugTiming('runSandbox: scpToContainer', timed(scpStart));
    emitStep(steps, onStep, {
      name: 'Container setup',
      status: 'ok',
      detail: 'dist copied',
      durationMs: timed(scpStart),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    debugTiming('runSandbox: scpToContainer (failed)', timed(scpStart));
    emitStep(steps, onStep, { name: 'Container setup', status: 'fail', detail: msg, durationMs: timed(scpStart) });
    try { devpodDelete(workspaceName); } catch { /* best-effort cleanup */ }
    return { entered: false, steps };
  }

  try {
    await processHydrazIncludes(
      repoRoot,
      workspaceName,
      scpToContainer,
      (msg) => emitStep(steps, onStep, { name: 'Includes', status: 'ok', detail: msg }),
    );
  } catch {
    // non-fatal, matches controller.ts behavior
  }

  debug(`runSandbox: entering interactive shell in ${workspaceName}`);
  await devpodSsh(workspaceName);

  if (options.cleanup) {
    debug(`runSandbox: cleaning up workspace ${workspaceName}`);
    try {
      devpodDelete(workspaceName);
      emitStep(steps, onStep, { name: 'Cleanup', status: 'ok' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emitStep(steps, onStep, { name: 'Cleanup', status: 'fail', detail: msg });
    }
  }

  debug('runSandbox: complete');
  return { entered: true, steps, workspaceName };
}
