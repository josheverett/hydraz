import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getProvider, resumeSession } from './controller.js';
import { LocalProvider } from '../providers/local.js';
import { LocalContainerProvider } from '../providers/local-container.js';
import {
  createNewSession,
  initRepoState,
  transitionState,
  loadSession,
} from '../sessions/index.js';
import { resolveRepoDataPaths } from '../repo/paths.js';
import {
  registerSession,
  unregisterSession,
  registerSshChild,
  _resetForTesting as resetShutdown,
} from './shutdown.js';

describe('getProvider', () => {
  it('returns LocalProvider for local target', () => {
    expect(getProvider('local')).toBeInstanceOf(LocalProvider);
  });

  it('returns LocalContainerProvider for local-container target', () => {
    expect(getProvider('local-container')).toBeInstanceOf(LocalContainerProvider);
  });

  it('routes cloud to the container provider implementation', () => {
    expect(getProvider('cloud')).toBeInstanceOf(LocalContainerProvider);
  });
});

describe('controller integration', () => {
  it('stopSession is a function', async () => {
    const { stopSession } = await import('./controller.js');
    expect(typeof stopSession).toBe('function');
  });

  it('resumeSession is a function', async () => {
    const { resumeSession: fn } = await import('./controller.js');
    expect(typeof fn).toBe('function');
  });

  it('isSessionRunning returns false for unknown sessions', async () => {
    const { isSessionRunning } = await import('./controller.js');
    expect(isSessionRunning('nonexistent')).toBe(false);
  });
});

describe('resumeSession', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(tmpdir() + '/hydraz-controller-test-');
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

  it('rejects resuming a completed session', async () => {
    const session = makeSession('completed-one');
    transitionState(repoRoot, session.id, 'starting');
    transitionState(repoRoot, session.id, 'investigating');
    transitionState(repoRoot, session.id, 'architecting');
    transitionState(repoRoot, session.id, 'planning');
    transitionState(repoRoot, session.id, 'architect-reviewing');
    transitionState(repoRoot, session.id, 'fanning-out');
    transitionState(repoRoot, session.id, 'syncing');
    transitionState(repoRoot, session.id, 'merging');
    transitionState(repoRoot, session.id, 'reviewing');
    transitionState(repoRoot, session.id, 'delivering');
    transitionState(repoRoot, session.id, 'completed');

    const errors: string[] = [];
    await resumeSession(session.id, repoRoot, {
      onError: (msg) => errors.push(msg),
    });

    expect(errors.some((e) => e.includes('Cannot resume'))).toBe(true);
    const loaded = loadSession(repoRoot, session.id);
    expect(loaded.state).toBe('completed');
  });

  it('rejects resuming a session in an active state', async () => {
    const session = makeSession('active-one');
    transitionState(repoRoot, session.id, 'starting');

    const errors: string[] = [];
    await resumeSession(session.id, repoRoot, {
      onError: (msg) => errors.push(msg),
    });

    expect(errors.some((e) => e.includes('Cannot resume'))).toBe(true);
    const loaded = loadSession(repoRoot, session.id);
    expect(loaded.state).toBe('starting');
  });
});

describe('shutdown manager exports', () => {
  it('registerSession is a function', () => {
    expect(typeof registerSession).toBe('function');
  });

  it('unregisterSession is a function', () => {
    expect(typeof unregisterSession).toBe('function');
  });

  it('registerSshChild is a function', () => {
    expect(typeof registerSshChild).toBe('function');
  });

  it('resetForTesting clears state without error', () => {
    expect(() => resetShutdown()).not.toThrow();
  });
});
