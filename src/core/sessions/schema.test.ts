import { describe, it, expect } from 'vitest';
import {
  createSession,
  isValidTransition,
  isActiveState,
  isTerminalState,
  ACTIVE_STATES,
  TERMINAL_STATES,
  ARTIFACT_FILES,
} from './schema.js';

describe('createSession', () => {
  it('returns a session with a UUID id', () => {
    const session = createSession({
      name: 'test-session',
      repoRoot: '/tmp/repo',
      branchName: 'hydraz/test-session',
      personas: ['architect', 'implementer', 'verifier'],
      executionTarget: 'local',
      task: 'Fix the auth bug',
    });

    expect(session.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('starts in created state', () => {
    const session = createSession({
      name: 'test',
      repoRoot: '/tmp/repo',
      branchName: 'hydraz/test',
      personas: ['architect', 'implementer', 'verifier'],
      executionTarget: 'local',
      task: 'Fix it',
    });

    expect(session.state).toBe('created');
  });

  it('sets timestamps', () => {
    const session = createSession({
      name: 'test',
      repoRoot: '/tmp/repo',
      branchName: 'hydraz/test',
      personas: ['architect', 'implementer', 'verifier'],
      executionTarget: 'local',
      task: 'Fix it',
    });

    expect(session.createdAt).toBeTruthy();
    expect(session.updatedAt).toBe(session.createdAt);
  });

  it('copies personas array', () => {
    const personas: [string, string, string] = ['a', 'b', 'c'];
    const session = createSession({
      name: 'test',
      repoRoot: '/tmp/repo',
      branchName: 'hydraz/test',
      personas,
      executionTarget: 'local',
      task: 'Fix it',
    });

    expect(session.personas).toEqual(personas);
    expect(session.personas).not.toBe(personas);
  });
});

describe('isValidTransition', () => {
  it('allows created → starting', () => {
    expect(isValidTransition('created', 'starting')).toBe(true);
  });

  it('allows starting → planning', () => {
    expect(isValidTransition('starting', 'planning')).toBe(true);
  });

  it('allows any active state → stopped', () => {
    for (const state of ACTIVE_STATES) {
      expect(isValidTransition(state, 'stopped')).toBe(true);
    }
  });

  it('allows any active state → failed', () => {
    for (const state of ACTIVE_STATES.filter((s) => s !== 'created')) {
      expect(isValidTransition(state, 'failed')).toBe(true);
    }
  });

  it('allows planning → completed (simple tasks)', () => {
    expect(isValidTransition('planning', 'completed')).toBe(true);
  });

  it('allows implementing → completed (skipping verification)', () => {
    expect(isValidTransition('implementing', 'completed')).toBe(true);
  });

  it('allows verifying → implementing (retry)', () => {
    expect(isValidTransition('verifying', 'implementing')).toBe(true);
  });

  it('blocks transitions from terminal states', () => {
    for (const state of TERMINAL_STATES) {
      expect(isValidTransition(state, 'starting')).toBe(false);
    }
  });

  it('blocks skipping phases', () => {
    expect(isValidTransition('created', 'implementing')).toBe(false);
    expect(isValidTransition('planning', 'verifying')).toBe(false);
  });
});

describe('isActiveState / isTerminalState', () => {
  it('active and terminal are mutually exclusive', () => {
    for (const state of ACTIVE_STATES) {
      expect(isTerminalState(state)).toBe(false);
    }
    for (const state of TERMINAL_STATES) {
      expect(isActiveState(state)).toBe(false);
    }
  });
});

describe('ARTIFACT_FILES', () => {
  it('contains the 5 required artifacts', () => {
    expect(ARTIFACT_FILES).toHaveLength(5);
    expect(ARTIFACT_FILES).toContain('intake.md');
    expect(ARTIFACT_FILES).toContain('plan.md');
    expect(ARTIFACT_FILES).toContain('implementation-summary.md');
    expect(ARTIFACT_FILES).toContain('verification-report.md');
    expect(ARTIFACT_FILES).toContain('pr-draft.md');
  });
});
