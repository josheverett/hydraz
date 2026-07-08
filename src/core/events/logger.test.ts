import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { createEvent, appendEvent, readEvents, formatEvent } from './logger.js';
import { initRepoState, createNewSession, getSessionDir } from '../sessions/manager.js';
import { resolveRepoDataPaths } from '../repo/paths.js';

let repoRoot: string;
let sessionId: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'hydraz-events-test-'));
  initRepoState(repoRoot);
  const session = createNewSession({
    name: 'event-test',
    repoRoot,
    branchName: 'hydraz/event-test',
    executionTarget: 'local',
    task: 'Test events',
  });
  sessionId = session.id;
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
  rmSync(resolveRepoDataPaths(repoRoot).repoDataDir, { recursive: true, force: true });
});

describe('createEvent', () => {
  it('creates an event with timestamp and type', () => {
    const event = createEvent(sessionId, 'session.created', 'Session created');
    expect(event.timestamp).toBeTruthy();
    expect(event.type).toBe('session.created');
    expect(event.message).toBe('Session created');
    expect(event.sessionId).toBe(sessionId);
  });

  it('includes optional state and metadata', () => {
    const event = createEvent(sessionId, 'session.state_changed', 'State changed', {
      state: 'planning',
      metadata: { branch: 'hydraz/test' },
    });
    expect(event.state).toBe('planning');
    expect(event.metadata).toEqual({ branch: 'hydraz/test' });
  });

  it('redacts secrets from event messages', () => {
    const event = createEvent(sessionId, 'session.warning', 'token github_pat_abc123');

    expect(event.message).toContain('[REDACTED]');
    expect(event.message).not.toContain('github_pat_abc123');
  });

  it('redacts secrets from nested metadata', () => {
    const event = createEvent(sessionId, 'session.warning', 'metadata', {
      metadata: {
        token: 'github_pat_abc123',
        nested: {
          authorization: 'Bearer ghp_abc123',
          values: ['OPENAI_API_KEY=sk-test123'],
        },
      },
    });

    const serialized = JSON.stringify(event.metadata);
    expect(serialized).toContain('[REDACTED]');
    expect(serialized).not.toContain('github_pat_abc123');
    expect(serialized).not.toContain('ghp_abc123');
    expect(serialized).not.toContain('sk-test123');
  });
});

describe('appendEvent + readEvents', () => {
  it('starts with no events', () => {
    const events = readEvents(repoRoot, sessionId);
    expect(events).toEqual([]);
  });

  it('appends and reads back events', () => {
    const event1 = createEvent(sessionId, 'session.created', 'Created');
    const event2 = createEvent(sessionId, 'session.state_changed', 'Started');

    appendEvent(repoRoot, event1);
    appendEvent(repoRoot, event2);

    const events = readEvents(repoRoot, sessionId);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('session.created');
    expect(events[1].type).toBe('session.state_changed');
  });

  it('keeps events.jsonl restrictive on POSIX when appending creates or replaces lines', () => {
    if (process.platform === 'win32') return;
    const eventsFile = join(getSessionDir(repoRoot, sessionId), 'events.jsonl');
    expect(statSync(eventsFile).mode & 0o777).toBe(0o600);
    appendEvent(repoRoot, createEvent(sessionId, 'codex.runner_started', 'ok'));
    expect(statSync(eventsFile).mode & 0o777).toBe(0o600);
  });

  it('preserves event data through serialization', () => {
    const event = createEvent(sessionId, 'artifact.created', 'Plan written', {
      metadata: { file: 'plan.md' },
    });
    appendEvent(repoRoot, event);

    const [loaded] = readEvents(repoRoot, sessionId);
    expect(loaded.metadata).toEqual({ file: 'plan.md' });
  });
});

describe('readEvents resilience', () => {
  it('skips corrupt JSONL lines without crashing', () => {
    const eventsFile = join(getSessionDir(repoRoot, sessionId), 'events.jsonl');
    writeFileSync(eventsFile, '{"type":"good"}\nNOT_JSON\n{"type":"also_good"}\n');

    const events = readEvents(repoRoot, sessionId);
    expect(events).toHaveLength(2);
  });
});

describe('formatEvent', () => {
  it('formats an event as a human-readable string', () => {
    const event = createEvent(sessionId, 'session.created', 'Session created');
    const formatted = formatEvent(event);
    expect(formatted).toContain('session.created');
    expect(formatted).toContain('Session created');
  });

  it('includes state when present', () => {
    const event = createEvent(sessionId, 'session.state_changed', 'Changed', {
      state: 'planning',
    });
    const formatted = formatEvent(event);
    expect(formatted).toContain('[planning]');
  });

  it('strips ANSI and control characters from formatted output', () => {
    const event = {
      ...createEvent(sessionId, 'session.created', 'Danger \u001b[31mred\u001b[0m\r\nnext\u0007line'),
      type: 'session.created\u001b[2J',
      state: 'plan\u0007ning',
    };
    const formatted = formatEvent(event);
    expect(formatted).toContain('session.created [planning]  Danger red nextline');
    expect(formatted).not.toContain('\u001b');
    expect(formatted).not.toContain('\n');
    expect(formatted).not.toContain('\u0007');
  });

  it('redacts secrets from legacy unredacted events when formatting', () => {
    const formatted = formatEvent({
      timestamp: new Date().toISOString(),
      sessionId,
      type: 'session.warning',
      message: 'token github_pat_abc123',
    });

    expect(formatted).toContain('[REDACTED]');
    expect(formatted).not.toContain('github_pat_abc123');
  });
});
