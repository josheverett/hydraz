import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type SessionMetadata,
  type SessionState,
  createSession,
  isValidTransition,
  isActiveState,
  SessionError,
  ARTIFACT_FILES,
} from './schema.js';

export function getHydrazDir(repoRoot: string): string {
  return join(repoRoot, '.hydraz');
}

export function getSessionsDir(repoRoot: string): string {
  return join(getHydrazDir(repoRoot), 'sessions');
}

export function getSessionDir(repoRoot: string, sessionId: string): string {
  return join(getSessionsDir(repoRoot), sessionId);
}

export function initRepoState(repoRoot: string): void {
  const hydrazDir = getHydrazDir(repoRoot);
  mkdirSync(join(hydrazDir, 'sessions'), { recursive: true });

  const repoConfigPath = join(hydrazDir, 'repo.json');
  if (!existsSync(repoConfigPath)) {
    writeFileSync(repoConfigPath, JSON.stringify({ version: '1' }, null, 2) + '\n');
  }
}

export function createNewSession(params: {
  name: string;
  repoRoot: string;
  branchName: string;
  personas: [string, string, string];
  executionTarget: 'local' | 'cloud';
  task: string;
}): SessionMetadata {
  const existing = listSessions(params.repoRoot);
  if (existing.some((s) => s.name === params.name)) {
    throw new SessionError(`Session "${params.name}" already exists in this repo`);
  }

  const session = createSession(params);
  const sessionDir = getSessionDir(params.repoRoot, session.id);
  mkdirSync(sessionDir, { recursive: true });
  mkdirSync(join(sessionDir, 'artifacts'), { recursive: true });
  writeFileSync(join(sessionDir, 'session.json'), JSON.stringify(session, null, 2) + '\n');
  writeFileSync(join(sessionDir, 'events.jsonl'), '');

  return session;
}

export function loadSession(repoRoot: string, sessionId: string): SessionMetadata {
  const sessionFile = join(getSessionDir(repoRoot, sessionId), 'session.json');

  if (!existsSync(sessionFile)) {
    throw new SessionError(`Session "${sessionId}" not found`);
  }

  return JSON.parse(readFileSync(sessionFile, 'utf-8')) as SessionMetadata;
}

export function saveSession(repoRoot: string, session: SessionMetadata): void {
  const sessionFile = join(getSessionDir(repoRoot, session.id), 'session.json');
  writeFileSync(sessionFile, JSON.stringify(session, null, 2) + '\n');
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
    const sessionFile = join(sessionsDir, entry.name, 'session.json');
    if (!existsSync(sessionFile)) continue;

    try {
      const data = JSON.parse(readFileSync(sessionFile, 'utf-8')) as SessionMetadata;
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
