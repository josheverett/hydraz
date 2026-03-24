import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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
} from './manager.js';
import { SessionError } from './schema.js';

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'hydraz-session-test-'));
  initRepoState(repoRoot);
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
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

describe('initRepoState', () => {
  it('creates .hydraz/sessions/ directory', () => {
    expect(existsSync(join(repoRoot, '.hydraz', 'sessions'))).toBe(true);
  });

  it('creates .hydraz/repo.json', () => {
    expect(existsSync(join(repoRoot, '.hydraz', 'repo.json'))).toBe(true);
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
