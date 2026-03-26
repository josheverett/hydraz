import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

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
  const command = `mkdir -p /tmp/hydraz-worktrees && cd ${containerRepoPath} && git worktree add -b ${branchName} ${worktreePath}`;
  execFileSync('ssh', [`${workspaceName}.devpod`, command], EXEC_OPTIONS);
  return worktreePath;
}

export function copyWorktreeIncludesInContainer(
  workspaceName: string,
  containerRepoPath: string,
  containerWorktreePath: string,
): void {
  const command = [
    `cd ${containerRepoPath}`,
    `if [ -f .worktreeinclude ]; then`,
    `  while IFS= read -r line || [ -n "$line" ]; do`,
    `    line=$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')`,
    `    [ -z "$line" ] && continue`,
    `    echo "$line" | grep -q '^#' && continue`,
    `    if [ -f "$line" ]; then`,
    `      mkdir -p "${containerWorktreePath}/$(dirname "$line")"`,
    `      cp "$line" "${containerWorktreePath}/$line"`,
    `    fi`,
    `  done < .worktreeinclude`,
    `fi`,
  ].join('\n');
  execFileSync('ssh', [`${workspaceName}.devpod`, command], EXEC_OPTIONS);
}

export function setupContainerGitSsh(workspaceName: string): void {
  try {
    execFileSync('ssh', [`${workspaceName}.devpod`,
      'mkdir -p ~/.ssh && ssh-keyscan -t ed25519,rsa github.com >> ~/.ssh/known_hosts 2>/dev/null',
    ], EXEC_OPTIONS);
  } catch {
    // Non-fatal — push may still work via HTTPS or the repo may not use GitHub
  }
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
