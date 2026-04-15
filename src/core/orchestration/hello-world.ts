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
import { debug, debugExec, debugOutput, debugTiming } from '../debug.js';

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

  debug(`runHelloWorld: executionTarget=${executionTarget} repoRoot=${repoRoot}`);
  debug(`runHelloWorld: timestamp=${timestamp} fileName=${fileName} isContainer=${isContainer}`);

  if (!configExists()) {
    debug('runHelloWorld: config dir does not exist, initializing');
    initializeConfigDir();
  }
  initRepoState(repoRoot);
  const config = loadConfig();
  debug(`runHelloWorld: config loaded — authMode=${config.claudeAuth.mode} branchPrefix=${config.branchNaming.prefix}`);

  const auth = resolveAuth();
  debug(`runHelloWorld: auth resolved=${auth.resolved} mode=${auth.modeDescription}`);
  if (!auth.resolved) {
    emitStep(steps, onStep, { name: 'Auth', status: 'fail', detail: auth.errors.join('; ') });
    return { passed: false, steps, timestamp };
  }
  emitStep(steps, onStep, { name: 'Auth', status: 'ok', detail: auth.modeDescription });

  if (isContainer) {
    const containerAuth = validateContainerAuth(config);
    debug(`runHelloWorld: containerAuth valid=${containerAuth.valid}`);
    if (!containerAuth.valid) {
      emitStep(steps, onStep, { name: 'Container auth', status: 'fail', detail: containerAuth.error });
      return { passed: false, steps, timestamp };
    }

    const ghReady = getGitHubAutomationReadiness(config, repoRoot);
    debug(`runHelloWorld: githubAutomation ok=${ghReady.ok}`);
    if (!ghReady.ok) {
      emitStep(steps, onStep, { name: 'GitHub config', status: 'fail', detail: ghReady.error });
      return { passed: false, steps, timestamp };
    }
  }

  const provider = getProvider(executionTarget);
  debug(`runHelloWorld: provider type=${provider.type}`);
  const providerCheck = provider.checkAvailability();
  if (!providerCheck.available) {
    emitStep(steps, onStep, { name: 'Provider', status: 'fail', detail: providerCheck.error });
    return { passed: false, steps, timestamp };
  }

  const sessionName = `hello-world-${timestamp}`;
  const branchName = suggestBranchName(sessionName, config.branchNaming.prefix);
  debug(`runHelloWorld: sessionName=${sessionName} branchName=${branchName}`);

  const task = generateHelloWorldTask(timestamp);
  debug(`runHelloWorld: task="${task}"`);

  let workspace;
  const wsStart = Date.now();
  try {
    const session = createNewSession({
      name: sessionName,
      repoRoot,
      branchName,
      personas: config.defaultPersonas,
      executionTarget,
      task,
    });
    debug(`runHelloWorld: session created id=${session.id}`);

    workspace = provider.createWorkspace({ session, config });
    debugTiming('runHelloWorld: createWorkspace', timed(wsStart));
    emitStep(steps, onStep, {
      name: 'Workspace',
      status: 'ok',
      detail: workspace.id,
      durationMs: timed(wsStart),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    debugTiming('runHelloWorld: createWorkspace (failed)', timed(wsStart));
    emitStep(steps, onStep, { name: 'Workspace', status: 'fail', detail: msg, durationMs: timed(wsStart) });
    return { passed: false, steps, timestamp };
  }

  const workspaceName = `hydraz-${workspace.sessionId}`;
  debug(`runHelloWorld: workspaceName=${workspaceName} directory=${workspace.directory}`);
  let containerContext: ContainerContext | undefined;

  if (isContainer) {
    const distRoot = getDistRoot();
    debug(`runHelloWorld: scpToContainer localPath=${distRoot} remotePath=${CONTAINER_DIST_PATH}`);
    const scpStart = Date.now();
    try {
      scpToContainer(workspaceName, distRoot, CONTAINER_DIST_PATH);
      debugTiming('runHelloWorld: scpToContainer', timed(scpStart));
      emitStep(steps, onStep, {
        name: 'Container setup',
        status: 'ok',
        detail: `dist copied`,
        durationMs: timed(scpStart),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      debugTiming('runHelloWorld: scpToContainer (failed)', timed(scpStart));
      emitStep(steps, onStep, { name: 'Container setup', status: 'fail', detail: msg, durationMs: timed(scpStart) });
      try { provider.destroyWorkspace(repoRoot, workspace); } catch {}
      return { passed: false, steps, timestamp };
    }

    const authEnv = prepareContainerAuthEnv(config);
    debug(`runHelloWorld: containerAuthEnv keys=[${Object.keys(authEnv).join(', ')}]`);
    containerContext = {
      workspaceName,
      authEnv: Object.keys(authEnv).length > 0 ? authEnv : undefined,
      workingDirectory: workspace.directory,
    };
  }

  debug(`runHelloWorld: launching Claude in ${isContainer ? 'container' : 'local'} mode`);
  const claudeStart = Date.now();
  try {
    const handle = launchClaude({
      workingDirectory: workspace.directory,
      prompt: task,
      config,
      containerContext,
    });
    const result = await handle.waitForExit();
    debugTiming('runHelloWorld: Claude execution', timed(claudeStart));

    if (!result.success) {
      debug(`runHelloWorld: Claude failed — exit=${result.exitCode} stderr=${result.stderr?.slice(0, 500)}`);
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
    debugTiming('runHelloWorld: Claude execution (failed)', timed(claudeStart));
    emitStep(steps, onStep, { name: 'Claude', status: 'fail', detail: msg, durationMs: timed(claudeStart) });
    try { provider.destroyWorkspace(repoRoot, workspace); } catch {}
    return { passed: false, steps, timestamp };
  }

  let verifyOk = false;
  const verifyPath = `${workspace.directory}/${fileName}`;
  debug(`runHelloWorld: verifying file at ${verifyPath}`);
  if (isContainer) {
    try {
      const contents = sshExec(workspaceName, `cat ${verifyPath}`).trim();
      debugOutput('runHelloWorld: file contents', contents);
      verifyOk = contents === EXPECTED_CONTENTS;
      if (verifyOk) {
        emitStep(steps, onStep, { name: 'Verification', status: 'ok', detail: fileName });
      } else {
        emitStep(steps, onStep, { name: 'Verification', status: 'fail', detail: `contents: "${contents}"` });
      }
    } catch {
      debug(`runHelloWorld: verification failed — file not found`);
      emitStep(steps, onStep, { name: 'Verification', status: 'fail', detail: `${fileName} not found` });
    }
  } else {
    const verify = verifyLocalFile(workspace.directory, fileName);
    debug(`runHelloWorld: local verify found=${verify.found} match=${verify.contentsMatch}`);
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

      debug(`runHelloWorld: push script branch=${branchName}`);
      debugExec('ssh', [`${workspaceName}.devpod`, 'sh', '-s']);
      const pushStart = Date.now();
      execFileSync('ssh', [`${workspaceName}.devpod`, 'sh', '-s'], {
        input: pushScript,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 120_000,
        encoding: 'utf-8',
      });
      debugTiming('runHelloWorld: push', Date.now() - pushStart);
      emitStep(steps, onStep, { name: 'Push', status: 'ok', detail: branchName });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      debug(`runHelloWorld: push failed — ${msg}`);
      emitStep(steps, onStep, { name: 'Push', status: 'fail', detail: msg });
      verifyOk = false;
    }
  }

  debug('runHelloWorld: cleanup');
  try {
    provider.destroyWorkspace(repoRoot, workspace);
    emitStep(steps, onStep, { name: 'Cleanup', status: 'ok' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitStep(steps, onStep, { name: 'Cleanup', status: 'fail', detail: msg });
  }

  debug(`runHelloWorld: complete — passed=${verifyOk}`);
  return { passed: verifyOk, steps, timestamp, fileName };
}
