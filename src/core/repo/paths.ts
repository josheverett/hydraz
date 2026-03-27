import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { isValidSessionId, SessionError } from '../sessions/schema.js';

export interface RepoDataPaths {
  hydrazHome: string;
  repoDataDir: string;
  sessionsDir: string;
  workspacesDir: string;
  repoMcpFile: string;
}

export function getHydrazHome(): string {
  return join(homedir(), '.hydraz');
}

export function repoHash(repoRoot: string): string {
  const normalized = resolve(repoRoot);
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

export function repoSlug(repoRoot: string): string {
  const name = basename(resolve(repoRoot));
  const hash = repoHash(repoRoot);
  return `${name}-${hash}`;
}

export function resolveRepoDataPaths(repoRoot: string): RepoDataPaths {
  const hydrazHome = getHydrazHome();
  const repoDataDir = join(hydrazHome, 'repos', repoSlug(repoRoot));

  return {
    hydrazHome,
    repoDataDir,
    sessionsDir: join(repoDataDir, 'sessions'),
    workspacesDir: join(repoDataDir, 'workspaces'),
    repoMcpFile: join(repoDataDir, 'mcp.json'),
  };
}

export function getSessionDir(repoRoot: string, sessionId: string): string {
  if (!isValidSessionId(sessionId)) {
    throw new SessionError(`Invalid session id: "${sessionId}"`);
  }
  return join(resolveRepoDataPaths(repoRoot).sessionsDir, sessionId);
}

export function getWorkspaceDir(repoRoot: string, sessionId: string): string {
  if (!isValidSessionId(sessionId)) {
    throw new SessionError(`Invalid session id: "${sessionId}"`);
  }
  return join(resolveRepoDataPaths(repoRoot).workspacesDir, sessionId);
}
