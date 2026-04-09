import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shellEscape } from '../claude/ssh.js';

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
  try {
    const output = execFileSync('devpod', ['version'], { ...EXEC_OPTIONS, encoding: 'utf-8' });
    return { available: true, version: output.trim() };
  } catch {
    return { available: false, error: 'DevPod CLI is not available on PATH' };
  }
}

export function checkDockerAvailability(): boolean {
  try {
    execFileSync('docker', ['info'], EXEC_OPTIONS);
    return true;
  } catch {
    return false;
  }
}

export function hasDevcontainerJson(repoDir: string): boolean {
  return existsSync(join(repoDir, '.devcontainer', 'devcontainer.json'));
}

export function devpodUp(sourceDir: string, workspaceName: string): void {
  execFileSync('devpod', ['up', sourceDir, '--ide', 'none', '--id', workspaceName], {
    ...EXEC_OPTIONS,
    timeout: 300_000,
  });
}

export function devpodDelete(workspaceName: string): void {
  execFileSync('devpod', ['delete', workspaceName], EXEC_OPTIONS);
}

export function devpodStatus(workspaceName: string): 'Running' | 'Stopped' | 'NotFound' {
  try {
    const output = execFileSync('devpod', ['status', workspaceName], {
      ...EXEC_OPTIONS,
      encoding: 'utf-8',
    });
    if (output.includes('Running')) return 'Running';
    return 'Stopped';
  } catch {
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
  return execFileSync('ssh', [`${workspaceName}.devpod`, command], {
    ...EXEC_OPTIONS,
    encoding: 'utf-8',
  });
}

export function createWorktreeInContainer(
  workspaceName: string,
  containerRepoPath: string,
  branchName: string,
  sessionId: string,
): string {
  const worktreePath = `/tmp/hydraz-worktrees/${sessionId}`;
  const command = `mkdir -p /tmp/hydraz-worktrees && cd ${shellEscape(containerRepoPath)} && git worktree add -b ${shellEscape(branchName)} ${shellEscape(worktreePath)}`;
  execFileSync('ssh', [`${workspaceName}.devpod`, command], EXEC_OPTIONS);
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
  execFileSync('ssh', [`${workspaceName}.devpod`, command.join('\n')], EXEC_OPTIONS);
}

export function verifyBranchPushed(
  workspaceName: string,
  worktreePath: string,
  branchName: string,
): boolean {
  try {
    const output = execFileSync('ssh', [
      `${workspaceName}.devpod`,
      `cd ${shellEscape(worktreePath)} && git ls-remote --heads origin ${shellEscape(branchName)}`,
    ], { ...EXEC_OPTIONS, encoding: 'utf-8' });
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

export function getDistRoot(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return resolve(dirname(thisFile), '..', '..', '..');
}

export function scpToContainer(
  workspaceName: string,
  localPath: string,
  remotePath: string,
): void {
  execFileSync('scp', ['-r', localPath, `${workspaceName}.devpod:${remotePath}`], {
    ...EXEC_OPTIONS,
    timeout: 300_000,
  });
}

export function verifyClaudeInContainer(workspaceName: string): DevPodCheckResult {
  try {
    const output = execFileSync('ssh', [`${workspaceName}.devpod`, 'claude --version'], {
      ...EXEC_OPTIONS,
      encoding: 'utf-8',
    });
    return { available: true, version: output.trim() };
  } catch {
    return {
      available: false,
      error: 'Claude Code CLI is not available inside the container. Ensure your devcontainer includes Claude Code.',
    };
  }
}
