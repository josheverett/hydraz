import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  resolveRepoDataPaths,
  getSessionDir as resolveSessionDir,
} from '../repo/paths.js';
import type { ExecutionTarget } from '../config/schema.js';
import {
  type SessionMetadata,
  type SessionState,
  createSession,
  isValidTransition,
  isActiveState,
  isValidSessionId,
  SessionError,
  ARTIFACT_FILES,
} from './schema.js';

export function getHydrazDir(repoRoot: string): string {
  return resolveRepoDataPaths(repoRoot).repoDataDir;
}

export function getSessionsDir(repoRoot: string): string {
  return resolveRepoDataPaths(repoRoot).sessionsDir;
}

export function getSessionDir(repoRoot: string, sessionId: string): string {
  return resolveSessionDir(repoRoot, sessionId);
}

function parseStoredSession(
  raw: unknown,
  repoRoot: string,
  expectedSessionId: string,
): SessionMetadata {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SessionError(`Session "${expectedSessionId}" is invalid`);
  }

  const data = raw as Record<string, unknown>;
  if (typeof data['id'] !== 'string' || data['id'] !== expectedSessionId || !isValidSessionId(data['id'])) {
    throw new SessionError(`Session "${expectedSessionId}" failed integrity validation`);
  }
  if (typeof data['repoRoot'] !== 'string' || resolve(data['repoRoot']) !== resolve(repoRoot)) {
    throw new SessionError(`Session "${expectedSessionId}" does not belong to this repo`);
  }

  return data as unknown as SessionMetadata;
}

function assertSessionWriteContext(repoRoot: string, session: SessionMetadata): void {
  if (typeof session.id !== 'string' || !isValidSessionId(session.id)) {
    throw new SessionError(`Invalid session id: "${session.id}"`);
  }
  if (typeof session.repoRoot !== 'string' || resolve(session.repoRoot) !== resolve(repoRoot)) {
    throw new SessionError(`Refusing to save session "${session.id}" under a different repo`);
  }
}

export function initRepoState(repoRoot: string): void {
  const paths = resolveRepoDataPaths(repoRoot);
  mkdirSync(paths.sessionsDir, { recursive: true, mode: 0o700 });
  mkdirSync(paths.workspacesDir, { recursive: true, mode: 0o700 });
}

export function createNewSession(params: {
  name: string;
  repoRoot: string;
  branchName: string;
  personas: [string, string, string];
  executionTarget: ExecutionTarget;
  task: string;
}): SessionMetadata {
  const existing = listSessions(params.repoRoot);
  if (existing.some((s) => s.name === params.name)) {
    throw new SessionError(`Session "${params.name}" already exists in this repo`);
  }

  const session = createSession(params);
  const sessionDir = getSessionDir(params.repoRoot, session.id);
  mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
  mkdirSync(join(sessionDir, 'artifacts'), { recursive: true, mode: 0o700 });
  writeFileSync(join(sessionDir, 'session.json'), JSON.stringify(session, null, 2) + '\n', {
    mode: 0o600,
  });
  writeFileSync(join(sessionDir, 'events.jsonl'), '', { mode: 0o600 });

  return session;
}

export function loadSession(repoRoot: string, sessionId: string): SessionMetadata {
  const sessionFile = join(getSessionDir(repoRoot, sessionId), 'session.json');

  if (!existsSync(sessionFile)) {
    throw new SessionError(`Session "${sessionId}" not found`);
  }

  return parseStoredSession(JSON.parse(readFileSync(sessionFile, 'utf-8')), repoRoot, sessionId);
}

export function saveSession(repoRoot: string, session: SessionMetadata): void {
  assertSessionWriteContext(repoRoot, session);
  const sessionFile = join(getSessionDir(repoRoot, session.id), 'session.json');
  writeFileSync(sessionFile, JSON.stringify(session, null, 2) + '\n', { mode: 0o600 });
}

export function transitionState(
  repoRoot: string,
  sessionId: string,
  newState: SessionState,
  message?: string,
): SessionMetadata {
  const session = loadSession(repoRoot, sessionId);

  if (!isValidTransition(session.state, newState)) {
    throw new SessionError(
      `Invalid state transition: ${session.state} → ${newState}`,
    );
  }

  session.state = newState;
  session.updatedAt = new Date().toISOString();

  if (newState === 'blocked' && message) {
    session.blockerMessage = message;
  }
  if (newState === 'failed' && message) {
    session.failureMessage = message;
  }

  saveSession(repoRoot, session);
  return session;
}

export function listSessions(repoRoot: string): SessionMetadata[] {
  const sessionsDir = getSessionsDir(repoRoot);

  if (!existsSync(sessionsDir)) {
    return [];
  }

  const entries = readdirSync(sessionsDir, { withFileTypes: true });
  const sessions: SessionMetadata[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!isValidSessionId(entry.name)) continue;
    const sessionFile = join(sessionsDir, entry.name, 'session.json');
    if (!existsSync(sessionFile)) continue;

    try {
      const data = parseStoredSession(
        JSON.parse(readFileSync(sessionFile, 'utf-8')),
        repoRoot,
        entry.name,
      );
      sessions.push(data);
    } catch {
      // skip corrupt session files
    }
  }

  return sessions.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export function findSessionByName(repoRoot: string, name: string): SessionMetadata | null {
  const sessions = listSessions(repoRoot);
  return sessions.find((s) => s.name === name) ?? null;
}

export function getActiveSessions(repoRoot: string): SessionMetadata[] {
  return listSessions(repoRoot).filter((s) => isActiveState(s.state));
}

export function getArtifactPath(repoRoot: string, sessionId: string, artifact: string): string {
  return join(getSessionDir(repoRoot, sessionId), 'artifacts', artifact);
}
