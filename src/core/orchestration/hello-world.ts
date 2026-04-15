import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { ExecutionTarget } from '../config/schema.js';
import { loadConfig, configExists, initializeConfigDir } from '../config/index.js';
import { resolveAuth, formatAuthResolution } from '../claude/resolver.js';
import { validateContainerAuth, prepareContainerAuthEnv } from '../providers/container-auth.js';
import { getGitHubAutomationReadiness } from '../github/requirements.js';
import { isContainerExecutionTarget } from '../providers/provider.js';
import { getProvider } from './controller.js';
import { createNewSession, initRepoState } from '../sessions/index.js';
import { suggestBranchName } from '../branches/index.js';
import { scpToContainer, getDistRoot, sshExec } from '../providers/devpod.js';
import { shellEscape } from '../claude/ssh.js';
import { launchClaude, type ContainerContext } from '../claude/executor.js';
import { CONTAINER_DIST_PATH } from '../swarm/pipeline-runner.js';

export interface HelloWorldStep {
  name: string;
  status: 'ok' | 'fail' | 'skip';
  detail?: string;
  durationMs?: number;
}

export interface HelloWorldResult {
  passed: boolean;
  steps: HelloWorldStep[];
  timestamp: number;
  fileName?: string;
}

export interface VerifyResult {
  found: boolean;
  contentsMatch: boolean;
  actualContents?: string;
}

export interface HelloWorldOptions {
  executionTarget: ExecutionTarget;
  repoRoot: string;
  onStep?: (step: HelloWorldStep) => void;
}

const EXPECTED_CONTENTS = 'hello world';

export function generateHelloWorldTask(timestamp: number): string {
  return `Create a file called hello-world-${timestamp}.txt with the exact contents "hello world". Do not add a trailing newline. Do not create any other files.`;
}

export function expectedFileName(timestamp: number): string {
  return `hello-world-${timestamp}.txt`;
}

export function verifyLocalFile(workspaceDir: string, fileName: string): VerifyResult {
  const filePath = join(workspaceDir, fileName);
  if (!existsSync(filePath)) {
    return { found: false, contentsMatch: false };
  }
  const contents = readFileSync(filePath, 'utf-8').trim();
  if (contents === EXPECTED_CONTENTS) {
    return { found: true, contentsMatch: true };
  }
  return { found: true, contentsMatch: false, actualContents: contents };
}

export function formatHelloWorldReport(result: HelloWorldResult): string {
  const lines = ['Hydraz Hello World'];
  for (const step of result.steps) {
    const detail = step.detail ? ` (${step.detail})` : '';
    lines.push(`  ${step.name.padEnd(17)}${step.status}${detail}`);
  }
  lines.push('');
  lines.push(`  Result: ${result.passed ? 'PASS' : 'FAIL'}`);
  return lines.join('\n');
}

function emitStep(
  steps: HelloWorldStep[],
  onStep: HelloWorldOptions['onStep'],
  step: HelloWorldStep,
): void {
  steps.push(step);
  onStep?.(step);
}

function timed(startMs: number): number {
  return Date.now() - startMs;
}

export async function runHelloWorld(options: HelloWorldOptions): Promise<HelloWorldResult> {
  const { executionTarget, repoRoot, onStep } = options;
  const timestamp = Math.floor(Date.now() / 1000);
  const fileName = expectedFileName(timestamp);
  const steps: HelloWorldStep[] = [];
  const isContainer = isContainerExecutionTarget(executionTarget);

  if (!configExists()) {
    initializeConfigDir();
  }
  initRepoState(repoRoot);
  const config = loadConfig();

  const auth = resolveAuth();
  if (!auth.resolved) {
    emitStep(steps, onStep, { name: 'Auth', status: 'fail', detail: auth.errors.join('; ') });
    return { passed: false, steps, timestamp };
  }
  emitStep(steps, onStep, { name: 'Auth', status: 'ok', detail: auth.modeDescription });

  if (isContainer) {
    const containerAuth = validateContainerAuth(config);
    if (!containerAuth.valid) {
      emitStep(steps, onStep, { name: 'Container auth', status: 'fail', detail: containerAuth.error });
      return { passed: false, steps, timestamp };
    }

    const ghReady = getGitHubAutomationReadiness(config, repoRoot);
    if (!ghReady.ok) {
      emitStep(steps, onStep, { name: 'GitHub config', status: 'fail', detail: ghReady.error });
      return { passed: false, steps, timestamp };
    }
  }

  const provider = getProvider(executionTarget);
  const providerCheck = provider.checkAvailability();
  if (!providerCheck.available) {
    emitStep(steps, onStep, { name: 'Provider', status: 'fail', detail: providerCheck.error });
    return { passed: false, steps, timestamp };
  }

  const sessionName = `hello-world-${timestamp}`;
  const branchName = suggestBranchName(sessionName, config.branchNaming.prefix);

  let workspace;
  const wsStart = Date.now();
  try {
    const session = createNewSession({
      name: sessionName,
      repoRoot,
      branchName,
      personas: config.defaultPersonas,
      executionTarget,
      task: generateHelloWorldTask(timestamp),
    });

    workspace = provider.createWorkspace({ session, config });
    emitStep(steps, onStep, {
      name: 'Workspace',
      status: 'ok',
      detail: workspace.id,
      durationMs: timed(wsStart),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitStep(steps, onStep, { name: 'Workspace', status: 'fail', detail: msg, durationMs: timed(wsStart) });
    return { passed: false, steps, timestamp };
  }

  const workspaceName = `hydraz-${workspace.sessionId}`;
  let containerContext: ContainerContext | undefined;

  if (isContainer) {
    const scpStart = Date.now();
    try {
      scpToContainer(workspaceName, getDistRoot(), CONTAINER_DIST_PATH);
      emitStep(steps, onStep, {
        name: 'Container setup',
        status: 'ok',
        detail: `dist copied`,
        durationMs: timed(scpStart),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emitStep(steps, onStep, { name: 'Container setup', status: 'fail', detail: msg, durationMs: timed(scpStart) });
      try { provider.destroyWorkspace(repoRoot, workspace); } catch {}
      return { passed: false, steps, timestamp };
    }

    const authEnv = prepareContainerAuthEnv(config);
    containerContext = {
      workspaceName,
      authEnv: Object.keys(authEnv).length > 0 ? authEnv : undefined,
      workingDirectory: workspace.directory,
    };
  }

  const claudeStart = Date.now();
  try {
    const handle = launchClaude({
      workingDirectory: workspace.directory,
      prompt: generateHelloWorldTask(timestamp),
      config,
      containerContext,
    });
    const result = await handle.waitForExit();

    if (!result.success) {
      emitStep(steps, onStep, {
        name: 'Claude',
        status: 'fail',
        detail: `exit ${result.exitCode}${result.stderr ? ': ' + result.stderr.slice(0, 200) : ''}`,
        durationMs: timed(claudeStart),
      });
      try { provider.destroyWorkspace(repoRoot, workspace); } catch {}
      return { passed: false, steps, timestamp };
    }
    emitStep(steps, onStep, {
      name: 'Claude',
      status: 'ok',
      detail: `exit 0, ${Math.round(timed(claudeStart) / 1000)}s`,
      durationMs: timed(claudeStart),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitStep(steps, onStep, { name: 'Claude', status: 'fail', detail: msg, durationMs: timed(claudeStart) });
    try { provider.destroyWorkspace(repoRoot, workspace); } catch {}
    return { passed: false, steps, timestamp };
  }

  let verifyOk = false;
  if (isContainer) {
    try {
      const contents = sshExec(workspaceName, `cat ${workspace.directory}/${fileName}`).trim();
      verifyOk = contents === EXPECTED_CONTENTS;
      if (verifyOk) {
        emitStep(steps, onStep, { name: 'Verification', status: 'ok', detail: fileName });
      } else {
        emitStep(steps, onStep, { name: 'Verification', status: 'fail', detail: `contents: "${contents}"` });
      }
    } catch {
      emitStep(steps, onStep, { name: 'Verification', status: 'fail', detail: `${fileName} not found` });
    }
  } else {
    const verify = verifyLocalFile(workspace.directory, fileName);
    if (verify.found && verify.contentsMatch) {
      verifyOk = true;
      emitStep(steps, onStep, { name: 'Verification', status: 'ok', detail: fileName });
    } else if (verify.found) {
      emitStep(steps, onStep, { name: 'Verification', status: 'fail', detail: `contents: "${verify.actualContents}"` });
    } else {
      emitStep(steps, onStep, { name: 'Verification', status: 'fail', detail: `${fileName} not found` });
    }
  }

  if (isContainer && verifyOk) {
    try {
      const gitAuthEnv = prepareContainerAuthEnv(config);
      const pushScript = [
        'set -eu',
        ...Object.entries(gitAuthEnv).map(([k, v]) => `export ${k}=${shellEscape(v)}`),
        `cd ${shellEscape(workspace.directory)}`,
        'git add -A',
        "git commit -m 'hello-world'",
        `git push origin ${shellEscape(branchName)}`,
      ].join('\n') + '\n';

      execFileSync('ssh', [`${workspaceName}.devpod`, 'sh', '-s'], {
        input: pushScript,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 120_000,
        encoding: 'utf-8',
      });
      emitStep(steps, onStep, { name: 'Push', status: 'ok', detail: branchName });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emitStep(steps, onStep, { name: 'Push', status: 'fail', detail: msg });
      verifyOk = false;
    }
  }

  try {
    provider.destroyWorkspace(repoRoot, workspace);
    emitStep(steps, onStep, { name: 'Cleanup', status: 'ok' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitStep(steps, onStep, { name: 'Cleanup', status: 'fail', detail: msg });
  }

  return { passed: verifyOk, steps, timestamp, fileName };
}
