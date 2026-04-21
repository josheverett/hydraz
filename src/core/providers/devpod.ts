import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shellEscape } from '../claude/ssh.js';
import { isVerbose, debugExec, debugOutput, debugTiming } from '../debug.js';
import { spawnWithHeartbeat } from './spawn-heartbeat.js';

export interface DevPodWorkspace {
  name: string;
  sourceDir: string;
}

export interface DevPodCheckResult {
  available: boolean;
  version?: string;
  error?: string;
}

const EXEC_OPTIONS: ExecFileSyncOptions = { stdio: 'pipe', timeout: 120_000 };

export function checkDevPodAvailability(): DevPodCheckResult {
  debugExec('devpod', ['version']);
  const start = Date.now();
  try {
    const output = execFileSync('devpod', ['version'], { ...EXEC_OPTIONS, encoding: 'utf-8' });
    debugOutput('devpod version stdout', output);
    debugTiming('devpod version', Date.now() - start);
    return { available: true, version: output.trim() };
  } catch {
    debugTiming('devpod version (failed)', Date.now() - start);
    return { available: false, error: 'DevPod CLI is not available on PATH' };
  }
}

export function checkDockerAvailability(): boolean {
  debugExec('docker', ['info']);
  const start = Date.now();
  try {
    execFileSync('docker', ['info'], EXEC_OPTIONS);
    debugTiming('docker info', Date.now() - start);
    return true;
  } catch {
    debugTiming('docker info (failed)', Date.now() - start);
    return false;
  }
}

export function hasDevcontainerJson(repoDir: string): boolean {
  return existsSync(join(repoDir, '.devcontainer', 'devcontainer.json'));
}

export interface DevcontainerPlatformCheck {
  ok: boolean;
  forced?: string;
  host?: string;
  message?: string;
}

export function checkDevcontainerPlatform(repoDir: string, hostArch?: string): DevcontainerPlatformCheck {
  const devcontainerPath = join(repoDir, '.devcontainer', 'devcontainer.json');
  if (!existsSync(devcontainerPath)) {
    return { ok: true };
  }

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(readFileSync(devcontainerPath, 'utf-8'));
  } catch {
    return { ok: true };
  }

  const runArgs = config.runArgs;
  if (!Array.isArray(runArgs)) {
    return { ok: true };
  }

  const platformArg = runArgs.find(
    (arg): arg is string => typeof arg === 'string' && arg.startsWith('--platform='),
  );
  if (!platformArg) {
    return { ok: true };
  }

  const forced = platformArg.slice('--platform='.length);
  const arch = hostArch ?? process.arch;
  const host = arch === 'arm64' ? 'linux/arm64' : 'linux/amd64';

  if (forced !== host) {
    return {
      ok: false,
      forced,
      host,
      message:
        `devcontainer.json forces --platform=${forced} via runArgs, but this host is ${host}. ` +
        `DevPod builds images for the host architecture, creating a build/run platform mismatch. ` +
        `Remove "--platform=${forced}" from runArgs in .devcontainer/devcontainer.json.`,
    };
  }

  return { ok: true, forced, host };
}

export async function devpodUp(
  source: string,
  workspaceName: string,
  provider?: string,
  branch?: string,
  onHeartbeat?: (label: string, elapsedMs: number) => void,
): Promise<void> {
  const devpodSource = branch ? `${source}@${branch}` : source;
  const args = ['up', devpodSource, '--ide', 'none', '--id', workspaceName];
  if (provider) {
    args.push('--provider', provider);
  }
  if (isVerbose()) {
    args.push('--debug');
  }
  debugExec('devpod', args);
  const start = Date.now();
  await spawnWithHeartbeat('devpod', args, { timeout: 900_000 }, {
    label: 'DevPod provisioning',
    intervalMs: 15_000,
    onHeartbeat: onHeartbeat ?? (() => {}),
    onStdoutLine: isVerbose() ? (line) => debugOutput('devpod up stdout', line) : undefined,
  });
  debugTiming('devpod up', Date.now() - start);
}

export function devpodDelete(workspaceName: string, force?: boolean): void {
  const args = force
    ? ['delete', '--force', workspaceName]
    : ['delete', workspaceName];
  debugExec('devpod', args);
  const start = Date.now();
  execFileSync('devpod', args, EXEC_OPTIONS);
  debugTiming('devpod delete', Date.now() - start);
}

export interface DevPodListEntry {
  name: string;
  status: string;
}

export function devpodList(): DevPodListEntry[] {
  debugExec('devpod', ['list', '--output', 'json']);
  const start = Date.now();
  try {
    const output = execFileSync('devpod', ['list', '--output', 'json'], {
      ...EXEC_OPTIONS,
      encoding: 'utf-8',
    });
    debugTiming('devpod list', Date.now() - start);

    const parsed = JSON.parse(output);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((entry: Record<string, unknown>) => typeof entry.id === 'string')
      .map((entry: Record<string, unknown>) => ({
        name: entry.id as string,
        status: typeof entry.status === 'string' ? entry.status : 'Unknown',
      }));
  } catch {
    debugTiming('devpod list (failed)', Date.now() - start);
    return [];
  }
}

export function devpodStatus(workspaceName: string): 'Running' | 'Stopped' | 'NotFound' {
  debugExec('devpod', ['status', workspaceName]);
  const start = Date.now();
  try {
    const output = execFileSync('devpod', ['status', workspaceName], {
      ...EXEC_OPTIONS,
      encoding: 'utf-8',
    });
    debugOutput('devpod status stdout', output);
    debugTiming('devpod status', Date.now() - start);
    if (output.includes('Running')) return 'Running';
    return 'Stopped';
  } catch {
    debugTiming('devpod status (failed)', Date.now() - start);
    return 'NotFound';
  }
}

export function buildSshCommand(workspaceName: string, command: string): { cmd: string; args: string[] } {
  return {
    cmd: 'ssh',
    args: [`${workspaceName}.devpod`, command],
  };
}

export function sshExec(workspaceName: string, command: string): string {
  debugExec('ssh', [`${workspaceName}.devpod`, command]);
  const start = Date.now();
  const output = execFileSync('ssh', [`${workspaceName}.devpod`, command], {
    ...EXEC_OPTIONS,
    encoding: 'utf-8',
  });
  debugOutput('ssh stdout', output);
  debugTiming('sshExec', Date.now() - start);
  return output;
}

export function createWorktreeInContainer(
  workspaceName: string,
  containerRepoPath: string,
  branchName: string,
  sessionId: string,
): string {
  const worktreePath = `/tmp/hydraz-worktrees/${sessionId}`;
  const command = `mkdir -p /tmp/hydraz-worktrees && cd ${shellEscape(containerRepoPath)} && git worktree add -b ${shellEscape(branchName)} ${shellEscape(worktreePath)}`;
  debugExec('ssh', [`${workspaceName}.devpod`, command]);
  const start = Date.now();
  execFileSync('ssh', [`${workspaceName}.devpod`, command], EXEC_OPTIONS);
  debugTiming('createWorktreeInContainer', Date.now() - start);
  return worktreePath;
}

export function copyWorktreeIncludesInContainer(
  workspaceName: string,
  containerRepoPath: string,
  containerWorktreePath: string,
  files: string[],
): void {
  if (files.length === 0) {
    return;
  }

  const command = [`cd ${shellEscape(containerRepoPath)}`];
  for (const file of files) {
    const destDir = `${containerWorktreePath}/${posix.dirname(file)}`;
    const destFile = `${containerWorktreePath}/${file}`;
    command.push(`mkdir -p ${shellEscape(destDir)}`);
    command.push(`cp ${shellEscape(file)} ${shellEscape(destFile)}`);
  }
  const joined = command.join('\n');
  debugExec('ssh', [`${workspaceName}.devpod`, joined]);
  const start = Date.now();
  execFileSync('ssh', [`${workspaceName}.devpod`, joined], EXEC_OPTIONS);
  debugTiming('copyWorktreeIncludesInContainer', Date.now() - start);
}

export function verifyBranchPushed(
  workspaceName: string,
  worktreePath: string,
  branchName: string,
): boolean {
  const sshArgs = [
    `${workspaceName}.devpod`,
    `cd ${shellEscape(worktreePath)} && git ls-remote --heads origin ${shellEscape(branchName)}`,
  ];
  debugExec('ssh', sshArgs);
  const start = Date.now();
  try {
    const output = execFileSync('ssh', sshArgs, { ...EXEC_OPTIONS, encoding: 'utf-8' });
    debugOutput('verifyBranchPushed stdout', output);
    debugTiming('verifyBranchPushed', Date.now() - start);
    return output.trim().length > 0;
  } catch {
    debugTiming('verifyBranchPushed (failed)', Date.now() - start);
    return false;
  }
}

export function getDistRoot(): string {
  try {
    const thisFile = fileURLToPath(import.meta.url);
    return resolve(dirname(thisFile), '..', '..');
  } catch {
    throw new Error('Cannot determine dist root: import.meta.url unavailable (SEA binary does not support container mode)');
  }
}

export async function scpToContainer(
  workspaceName: string,
  localPath: string,
  remotePath: string,
  onHeartbeat?: (label: string, elapsedMs: number) => void,
): Promise<void> {
  const sshTarget = `${workspaceName}.devpod`;
  const remoteCmd = `rm -rf ${remotePath} && mkdir -p ${remotePath} && tar -C ${remotePath} -xf - && echo '{"type":"module"}' > ${remotePath}/package.json`;
  const shCmd = `tar -C ${shellEscape(localPath)} --no-xattrs -cf - . | ssh ${shellEscape(sshTarget)} ${shellEscape(remoteCmd)}`;
  debugExec('sh', ['-c', shCmd]);
  const start = Date.now();
  await spawnWithHeartbeat('sh', ['-c', shCmd], {}, {
    label: 'Copying to container',
    intervalMs: 10_000,
    onHeartbeat: onHeartbeat ?? (() => {}),
  });
  debugTiming('scpToContainer', Date.now() - start);
}

export function scpFilesToContainer(
  workspaceName: string,
  hostRepoRoot: string,
  containerRepoPath: string,
  files: string[],
): void {
  if (files.length === 0) {
    return;
  }

  const sshTarget = `${workspaceName}.devpod`;
  const escapedFiles = files.map((f) => shellEscape(f)).join(' ');
  const remoteCmd = `tar -C ${shellEscape(containerRepoPath)} -xf -`;
  const shCmd = `tar -C ${shellEscape(hostRepoRoot)} --no-xattrs -cf - ${escapedFiles} | ssh ${shellEscape(sshTarget)} ${shellEscape(remoteCmd)}`;
  debugExec('sh', ['-c', shCmd]);
  const start = Date.now();
  execFileSync('sh', ['-c', shCmd], EXEC_OPTIONS);
  debugTiming('scpFilesToContainer', Date.now() - start);
}

export function verifyClaudeInContainer(workspaceName: string): DevPodCheckResult {
  debugExec('ssh', [`${workspaceName}.devpod`, 'claude --version']);
  const start = Date.now();
  try {
    const output = execFileSync('ssh', [`${workspaceName}.devpod`, 'claude --version'], {
      ...EXEC_OPTIONS,
      encoding: 'utf-8',
    });
    debugOutput('claude --version stdout', output);
    debugTiming('verifyClaudeInContainer', Date.now() - start);
    return { available: true, version: output.trim() };
  } catch {
    debugTiming('verifyClaudeInContainer (failed)', Date.now() - start);
    return {
      available: false,
      error: 'Claude Code CLI is not available inside the container. Ensure your devcontainer includes Claude Code.',
    };
  }
}
