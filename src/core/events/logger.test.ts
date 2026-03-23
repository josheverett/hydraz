import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { createEvent, appendEvent, readEvents, formatEvent } from './logger.js';
import { initRepoState, createNewSession } from '../sessions/manager.js';

let repoRoot: string;
let sessionId: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'hydraz-events-test-'));
  initRepoState(repoRoot);
  const session = createNewSession({
    name: 'event-test',
    repoRoot,
    branchName: 'hydraz/event-test',
    personas: ['architect', 'implementer', 'verifier'],
    executionTarget: 'local',
    task: 'Test events',
  });
  sessionId = session.id;
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
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

  it('preserves event data through serialization', () => {
    const event = createEvent(sessionId, 'artifact.created', 'Plan written', {
      metadata: { file: 'plan.md' },
    });
    appendEvent(repoRoot, event);

    const [loaded] = readEvents(repoRoot, sessionId);
    expect(loaded.metadata).toEqual({ file: 'plan.md' });
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
});
