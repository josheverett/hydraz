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
