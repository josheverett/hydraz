import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import {
  initRepoState,
  createNewSession,
  loadSession,
  saveSession,
  transitionState,
  listSessions,
  findSessionByName,
  getActiveSessions,
  getSessionDir,
  getArtifactPath,
  getSessionsDir,
} from './manager.js';
import { SessionError } from './schema.js';
import { resolveRepoDataPaths } from '../repo/paths.js';

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'hydraz-session-test-'));
  initRepoState(repoRoot);
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
  const paths = resolveRepoDataPaths(repoRoot);
  rmSync(paths.repoDataDir, { recursive: true, force: true });
});

function makeSession(name: string = 'test-session') {
  return createNewSession({
    name,
    repoRoot,
    branchName: `hydraz/${name}`,
    personas: ['architect', 'implementer', 'verifier'],
    executionTarget: 'local',
    task: 'Fix the thing',
  });
}

function tamperSessionFile(
  sessionId: string,
  mutate: (data: Record<string, unknown>) => void,
) {
  const sessionFile = join(getSessionDir(repoRoot, sessionId), 'session.json');
  const data = JSON.parse(readFileSync(sessionFile, 'utf-8')) as Record<string, unknown>;
  mutate(data);
  writeFileSync(sessionFile, JSON.stringify(data, null, 2) + '\n');
}

describe('initRepoState', () => {
  it('creates sessions directory under ~/.hydraz', () => {
    const paths = resolveRepoDataPaths(repoRoot);
    expect(existsSync(paths.sessionsDir)).toBe(true);
  });

  it('creates workspaces directory under ~/.hydraz', () => {
    const paths = resolveRepoDataPaths(repoRoot);
    expect(existsSync(paths.workspacesDir)).toBe(true);
  });

  it('does not create .hydraz/ in the target repo', () => {
    expect(existsSync(join(repoRoot, '.hydraz'))).toBe(false);
  });
});

describe('createNewSession', () => {
  it('creates a session directory with session.json and events.jsonl', () => {
    const session = makeSession();
    const sessionDir = getSessionDir(repoRoot, session.id);

    expect(existsSync(join(sessionDir, 'session.json'))).toBe(true);
    expect(existsSync(join(sessionDir, 'events.jsonl'))).toBe(true);
    expect(existsSync(join(sessionDir, 'artifacts'))).toBe(true);
  });

  it('creates session.json and events.jsonl with restrictive permissions on POSIX', () => {
    if (process.platform === 'win32') return;
    const session = makeSession();
    const sessionDir = getSessionDir(repoRoot, session.id);
    expect(statSync(join(sessionDir, 'session.json')).mode & 0o777).toBe(0o600);
    expect(statSync(join(sessionDir, 'events.jsonl')).mode & 0o777).toBe(0o600);
  });

  it('creates session directories with restrictive permissions on POSIX', () => {
    if (process.platform === 'win32') return;
    const session = makeSession();
    const sessionDir = getSessionDir(repoRoot, session.id);
    expect(statSync(sessionDir).mode & 0o777).toBe(0o700);
    expect(statSync(join(sessionDir, 'artifacts')).mode & 0o777).toBe(0o700);
  });

  it('rejects duplicate session names', () => {
    makeSession('dup-name');
    expect(() => makeSession('dup-name')).toThrow(SessionError);
  });

  it('returns a session in created state', () => {
    const session = makeSession();
    expect(session.state).toBe('created');
  });
});

describe('loadSession', () => {
  it('loads a previously created session', () => {
    const original = makeSession();
    const loaded = loadSession(repoRoot, original.id);
    expect(loaded.name).toBe(original.name);
    expect(loaded.id).toBe(original.id);
  });

  it('throws for non-existent session', () => {
    expect(() => loadSession(repoRoot, 'nonexistent')).toThrow(SessionError);
  });

  it('rejects a session file whose stored id does not match its directory', () => {
    const session = makeSession();
    tamperSessionFile(session.id, (data) => {
      data['id'] = '00000000-0000-0000-0000-000000000000';
    });

    expect(() => loadSession(repoRoot, session.id)).toThrow(SessionError);
  });

  it('rejects a session file whose stored repoRoot does not match the current repo', () => {
    const session = makeSession();
    tamperSessionFile(session.id, (data) => {
      data['repoRoot'] = '/tmp/other-repo';
    });

    expect(() => loadSession(repoRoot, session.id)).toThrow(SessionError);
  });
});

describe('saveSession', () => {
  it('rejects saving a session under a different repo root', () => {
    const session = makeSession();
    const loaded = loadSession(repoRoot, session.id);
    loaded.repoRoot = '/tmp/other-repo';

    expect(() => saveSession(repoRoot, loaded)).toThrow(SessionError);
  });
});

describe('transitionState', () => {
  it('transitions from created to starting', () => {
    const session = makeSession();
    const updated = transitionState(repoRoot, session.id, 'starting');
    expect(updated.state).toBe('starting');
  });

  it('updates the updatedAt timestamp', () => {
    const session = makeSession();
    const updated = transitionState(repoRoot, session.id, 'starting');
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(session.updatedAt).getTime(),
    );
  });

  it('stores blocker message on blocked transition', () => {
    const session = makeSession();
    transitionState(repoRoot, session.id, 'starting');
    const blocked = transitionState(repoRoot, session.id, 'blocked', 'Missing API key');
    expect(blocked.blockerMessage).toBe('Missing API key');
  });

  it('stores failure message on failed transition', () => {
    const session = makeSession();
    transitionState(repoRoot, session.id, 'starting');
    const failed = transitionState(repoRoot, session.id, 'failed', 'Process crashed');
    expect(failed.failureMessage).toBe('Process crashed');
  });

  it('rejects invalid transitions', () => {
    const session = makeSession();
    expect(() => transitionState(repoRoot, session.id, 'implementing')).toThrow(SessionError);
  });

  it('persists state change to disk', () => {
    const session = makeSession();
    transitionState(repoRoot, session.id, 'starting');
    const reloaded = loadSession(repoRoot, session.id);
    expect(reloaded.state).toBe('starting');
  });

  it('rewrites session.json with restrictive permissions on POSIX after transition', () => {
    if (process.platform === 'win32') return;
    const session = makeSession();
    transitionState(repoRoot, session.id, 'starting');
    const sessionFile = join(getSessionDir(repoRoot, session.id), 'session.json');
    expect(statSync(sessionFile).mode & 0o777).toBe(0o600);
  });

  it('allows transition from stopped to created (for resume)', () => {
    const session = makeSession();
    transitionState(repoRoot, session.id, 'stopped');
    const updated = transitionState(repoRoot, session.id, 'created');
    expect(updated.state).toBe('created');
  });

  it('allows transition from blocked to created (for resume)', () => {
    const session = makeSession();
    transitionState(repoRoot, session.id, 'starting');
    transitionState(repoRoot, session.id, 'blocked');
    const updated = transitionState(repoRoot, session.id, 'created');
    expect(updated.state).toBe('created');
  });

  it('allows transition from failed to created (for resume)', () => {
    const session = makeSession();
    transitionState(repoRoot, session.id, 'starting');
    transitionState(repoRoot, session.id, 'failed');
    const updated = transitionState(repoRoot, session.id, 'created');
    expect(updated.state).toBe('created');
  });

  it('rejects transition from completed to created', () => {
    const session = makeSession();
    transitionState(repoRoot, session.id, 'starting');
    transitionState(repoRoot, session.id, 'planning');
    transitionState(repoRoot, session.id, 'completed');
    expect(() => transitionState(repoRoot, session.id, 'created')).toThrow(SessionError);
  });
});

describe('listSessions', () => {
  it('returns empty array for a fresh repo', () => {
    const freshRepo = mkdtempSync(join(tmpdir(), 'hydraz-empty-'));
    expect(listSessions(freshRepo)).toEqual([]);
    rmSync(freshRepo, { recursive: true, force: true });
  });

  it('lists all created sessions', () => {
    makeSession('session-a');
    makeSession('session-b');
    const sessions = listSessions(repoRoot);
    expect(sessions).toHaveLength(2);
  });

  it('sorts by most recently updated first', () => {
    const a = makeSession('session-a');
    makeSession('session-b');

    const session = loadSession(repoRoot, a.id);
    session.updatedAt = new Date(Date.now() + 10_000).toISOString();
    saveSession(repoRoot, session);

    const sessions = listSessions(repoRoot);
    expect(sessions[0].name).toBe('session-a');
  });

  it('skips session files whose stored id does not match the containing directory', () => {
    makeSession('valid-session');
    const tampered = makeSession('tampered-session');
    tamperSessionFile(tampered.id, (data) => {
      data['id'] = '11111111-1111-1111-1111-111111111111';
    });

    const sessions = listSessions(repoRoot);
    expect(sessions.map((s) => s.name)).toContain('valid-session');
    expect(sessions.map((s) => s.name)).not.toContain('tampered-session');
  });

  it('skips session files whose stored repoRoot does not match the current repo', () => {
    makeSession('valid-session');
    const tampered = makeSession('wrong-repo-session');
    tamperSessionFile(tampered.id, (data) => {
      data['repoRoot'] = '/tmp/other-repo';
    });

    const sessions = listSessions(repoRoot);
    expect(sessions.map((s) => s.name)).toContain('valid-session');
    expect(sessions.map((s) => s.name)).not.toContain('wrong-repo-session');
  });
});

describe('findSessionByName', () => {
  it('finds a session by name', () => {
    makeSession('find-me');
    const found = findSessionByName(repoRoot, 'find-me');
    expect(found).not.toBeNull();
    expect(found!.name).toBe('find-me');
  });

  it('returns null for non-existent name', () => {
    expect(findSessionByName(repoRoot, 'nope')).toBeNull();
  });
});

describe('getActiveSessions', () => {
  it('returns only sessions in active states', () => {
    const a = makeSession('active-one');
    const b = makeSession('stopped-one');
    transitionState(repoRoot, a.id, 'starting');
    transitionState(repoRoot, b.id, 'stopped');

    const active = getActiveSessions(repoRoot);
    expect(active).toHaveLength(1);
    expect(active[0].name).toBe('active-one');
  });
});

describe('getArtifactPath', () => {
  it('returns the correct path for an artifact', () => {
    const session = makeSession();
    const path = getArtifactPath(repoRoot, session.id, 'plan.md');
    expect(path).toContain('artifacts');
    expect(path.endsWith('plan.md')).toBe(true);
  });
});
