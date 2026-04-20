import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../config/index.js', () => ({
  loadConfig: vi.fn(() => ({
    github: { token: 'test-token' },
  })),
}));

vi.mock('../claude/resolver.js', () => ({
  resolveAuth: vi.fn(() => ({
    resolved: true,
    modeDescription: 'API key',
    errors: [],
  })),
  formatAuthResolution: vi.fn(() => 'resolved'),
}));

vi.mock('../providers/container-auth.js', () => ({
  validateContainerAuth: vi.fn(() => ({ valid: true })),
  prepareContainerAuthEnv: vi.fn(() => ({})),
}));

vi.mock('../github/requirements.js', () => ({
  getGitHubAutomationReadiness: vi.fn(() => ({ ok: true })),
}));

vi.mock('../swarm/index.js', () => ({
  ensureSwarmDirs: vi.fn(),
  DEFAULT_SWARM_CONFIG: {
    defaultWorkerCount: 3,
    defaultReviewers: ['reviewer-1'],
    outerLoopMaxIterations: 2,
    consensusMaxRounds: 3,
  },
}));

vi.mock('../swarm/repo-config.js', () => ({
  processHydrazIncludes: vi.fn(),
}));

vi.mock('../providers/devpod.js', () => ({
  scpToContainer: vi.fn(),
  getDistRoot: vi.fn(() => '/fake/dist'),
  sshExec: vi.fn(() => '{}'),
  devpodUp: vi.fn(),
  devpodDelete: vi.fn(),
  devpodList: vi.fn(() => []),
  devpodStatus: vi.fn(() => 'NotFound'),
  checkDevPodAvailability: vi.fn(() => ({ available: true })),
  checkDockerAvailability: vi.fn(() => true),
  hasDevcontainerJson: vi.fn(() => true),
  buildSshCommand: vi.fn(() => ({ cmd: 'ssh', args: [] })),
  verifyBranchPushed: vi.fn(() => true),
  verifyClaudeInContainer: vi.fn(() => ({ available: true })),
  createWorktreeInContainer: vi.fn(() => '/tmp/worktree'),
  copyWorktreeIncludesInContainer: vi.fn(),
  scpFilesToContainer: vi.fn(),
}));

vi.mock('../claude/ssh.js', () => ({
  buildSshNodeCommand: vi.fn(() => ({
    cmd: 'ssh',
    args: ['test.devpod', 'sh', '-s'],
    stdinScript: 'exec node test.js\n',
  })),
  shellEscape: vi.fn((s: string) => `'${s}'`),
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execFileSync: vi.fn(),
}));

vi.mock('../github/delivery.js', () => ({
  finalizeGitHubContainerDelivery: vi.fn(),
}));

vi.mock('../events/index.js', () => ({
  createEvent: vi.fn((_sid: string, type: string, message: string) => ({
    id: 'evt-1', sessionId: _sid, type, message, timestamp: new Date().toISOString(),
  })),
  appendEvent: vi.fn(),
}));

vi.mock('./cleanup.js', () => ({
  findAllOrphanedWorkspaces: vi.fn(() => ({ known: [], unknown: [], total: 0 })),
}));

import { getProvider, resumeSession, startSession } from './controller.js';
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
import { scpToContainer, sshExec } from '../providers/devpod.js';
import { spawn } from 'node:child_process';
import { findAllOrphanedWorkspaces } from './cleanup.js';

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

describe('startSession container failure paths', () => {
  let repoRoot: string;
  let destroyWorkspaceSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    repoRoot = mkdtempSync(tmpdir() + '/hydraz-controller-failure-test-');
    initRepoState(repoRoot);

    vi.spyOn(LocalContainerProvider.prototype, 'checkAvailability').mockReturnValue({
      available: true,
    });
    vi.spyOn(LocalContainerProvider.prototype, 'createWorkspace').mockImplementation(
      async (params: any) => ({
        type: 'local-container' as const,
        directory: '/workspaces/test',
        sessionId: params.session.id,
      }),
    );
    destroyWorkspaceSpy = vi.spyOn(
      LocalContainerProvider.prototype,
      'destroyWorkspace',
    ).mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetShutdown();
    rmSync(repoRoot, { recursive: true, force: true });
    const paths = resolveRepoDataPaths(repoRoot);
    rmSync(paths.repoDataDir, { recursive: true, force: true });
  });

  function makeContainerSession(name = 'container-test') {
    return createNewSession({
      name,
      repoRoot,
      branchName: `hydraz/${name}`,
      personas: ['architect', 'implementer', 'verifier'],
      executionTarget: 'local-container',
      task: 'Fix the thing',
    });
  }

  function createFakeChildProcess(exitCode: number) {
    const child = new EventEmitter() as any;
    child.stdin = { write: vi.fn(), end: vi.fn() };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = vi.fn();
    process.nextTick(() => child.emit('close', exitCode));
    return child;
  }

  it('destroys workspace when container setup (SCP) fails', async () => {
    const session = makeContainerSession('scp-fail');
    vi.mocked(scpToContainer).mockImplementation(() => {
      throw new Error('SCP connection refused');
    });

    const errors: string[] = [];
    await startSession(session.id, repoRoot, {
      onError: (msg) => errors.push(msg),
    });

    expect(destroyWorkspaceSpy).toHaveBeenCalled();
    const loaded = loadSession(repoRoot, session.id);
    expect(loaded.state).toBe('failed');
  });

  it('emits recovery info when pipeline fails in container mode', async () => {
    const session = makeContainerSession('pipeline-fail');
    vi.mocked(scpToContainer).mockImplementation(() => {});
    vi.mocked(spawn).mockReturnValue(createFakeChildProcess(1) as any);
    vi.mocked(sshExec).mockReturnValue(JSON.stringify({
      success: false,
      phase: 'failed',
      outerLoopsUsed: 1,
      consensusRoundsUsed: 0,
      approved: false,
      error: 'Pipeline failed in test',
    }));

    const errors: string[] = [];
    await startSession(session.id, repoRoot, {
      onError: (msg) => errors.push(msg),
    });

    expect(errors.some(e => e.includes('devpod ssh'))).toBe(true);
    expect(errors.some(e => e.includes(`hydraz-${session.id}`))).toBe(true);
    const loaded = loadSession(repoRoot, session.id);
    expect(loaded.state).toBe('failed');
  });

  it('emits warning when orphaned workspaces are detected at startup', async () => {
    const session = makeContainerSession('orphan-warn');
    vi.mocked(findAllOrphanedWorkspaces).mockReturnValue({
      known: [{ sessionId: 'old-1', sessionName: 'old-session', workspaceName: 'hydraz-old-1', sessionState: 'failed', branchName: 'hydraz/old', devpodStatus: 'Running' }],
      unknown: [{ workspaceName: 'hydraz-mystery', devpodStatus: 'Running' }],
      total: 2,
    } as any);
    vi.mocked(scpToContainer).mockImplementation(() => {
      throw new Error('SCP failed');
    });

    const errors: string[] = [];
    const events: string[] = [];
    await startSession(session.id, repoRoot, {
      onError: (msg) => errors.push(msg),
      onEvent: (type, msg) => events.push(`${type}: ${msg}`),
    });

    expect(errors.some(e => e.includes('orphaned') && e.includes('hydraz clean'))).toBe(true);
  });

  it('does not warn when no orphaned workspaces exist', async () => {
    const session = makeContainerSession('no-orphans');
    vi.mocked(findAllOrphanedWorkspaces).mockReturnValue({
      known: [],
      unknown: [],
      total: 0,
    });
    vi.mocked(scpToContainer).mockImplementation(() => {
      throw new Error('SCP failed');
    });

    const errors: string[] = [];
    await startSession(session.id, repoRoot, {
      onError: (msg) => errors.push(msg),
    });

    expect(errors.some(e => e.includes('orphaned'))).toBe(false);
  });

  it('does not block session start when orphan check fails', async () => {
    const session = makeContainerSession('orphan-check-crash');
    vi.mocked(findAllOrphanedWorkspaces).mockImplementation(() => {
      throw new Error('devpod not available');
    });
    vi.mocked(scpToContainer).mockImplementation(() => {
      throw new Error('SCP failed');
    });

    const errors: string[] = [];
    await startSession(session.id, repoRoot, {
      onError: (msg) => errors.push(msg),
    });

    const loaded = loadSession(repoRoot, session.id);
    expect(loaded.state).toBe('failed');
  });

  it('passes heartbeat callback to createWorkspace that emits workspace.heartbeat events', async () => {
    const createSpy = vi.spyOn(LocalContainerProvider.prototype, 'createWorkspace');
    createSpy.mockImplementation(async (params: any) => {
      params.onHeartbeat?.('DevPod provisioning', 15000);
      return {
        type: 'local-container' as const,
        directory: '/workspaces/test',
        sessionId: params.session.id,
      };
    });

    const session = makeContainerSession('heartbeat-ws');
    vi.mocked(scpToContainer).mockImplementation(() => {
      throw new Error('SCP failed');
    });

    const events: string[] = [];
    await startSession(session.id, repoRoot, {
      onEvent: (type, msg) => events.push(`${type}: ${msg}`),
      onError: () => {},
    });

    expect(events.some(e => e.startsWith('workspace.heartbeat:') && e.includes('15s'))).toBe(true);
  });

  it('passes heartbeat callback to scpToContainer that emits swarm.heartbeat events', async () => {
    const session = makeContainerSession('heartbeat-scp');
    vi.mocked(scpToContainer).mockImplementation(async (...args: any[]) => {
      const heartbeatCb = args[3];
      heartbeatCb?.('Copying to container', 10000);
    });
    vi.mocked(spawn).mockReturnValue(createFakeChildProcess(1) as any);
    vi.mocked(sshExec).mockReturnValue(JSON.stringify({
      success: false, phase: 'failed', outerLoopsUsed: 0,
      consensusRoundsUsed: 0, approved: false, error: 'fail',
    }));

    const events: string[] = [];
    await startSession(session.id, repoRoot, {
      onEvent: (type, msg) => events.push(`${type}: ${msg}`),
      onError: () => {},
    });

    expect(events.some(e => e.startsWith('swarm.heartbeat:') && e.includes('10s'))).toBe(true);
  });

  it('emits swarm.heartbeat during idle SSH pipeline execution', async () => {
    vi.useFakeTimers();

    const session = makeContainerSession('ssh-idle-hb');
    vi.mocked(scpToContainer).mockImplementation(async () => {});

    const child = new EventEmitter() as any;
    child.stdin = { write: vi.fn(), end: vi.fn() };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = vi.fn();
    vi.mocked(spawn).mockReturnValue(child);

    vi.mocked(sshExec).mockReturnValue(JSON.stringify({
      success: false, phase: 'failed', outerLoopsUsed: 0,
      consensusRoundsUsed: 0, approved: false, error: 'idle test',
    }));

    const events: string[] = [];
    const sessionPromise = startSession(session.id, repoRoot, {
      onEvent: (type, msg) => events.push(`${type}: ${msg}`),
      onError: () => {},
    });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(events.some(e => e.startsWith('swarm.heartbeat:') && e.includes('30s'))).toBe(true);

    child.emit('close', 1);
    await sessionPromise;

    vi.useRealTimers();
  });
});
