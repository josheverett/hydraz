import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import type { ExecutorHandle } from '../claude/executor.js';
import type { WorkspaceProvider, WorkspaceInfo } from '../providers/provider.js';
import type { ControllerCallbacks } from './controller.js';
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
  registerExecutorHandle,
  unregisterExecutorHandle,
  gracefulShutdown,
  _resetForTesting,
} from './shutdown.js';

describe('shutdown manager', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(tmpdir() + '/hydraz-shutdown-test-');
    initRepoState(repoRoot);
    _resetForTesting();
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

  function makeContainerSession(name: string = 'container-session') {
    return createNewSession({
      name,
      repoRoot,
      branchName: `hydraz/${name}`,
      personas: ['architect', 'implementer', 'verifier'],
      executionTarget: 'local-container',
      task: 'Fix the thing in container',
    });
  }

  function mockProvider(destroyFn = vi.fn()): WorkspaceProvider {
    return {
      type: 'local-container',
      createWorkspace: vi.fn(),
      destroyWorkspace: destroyFn,
      checkAvailability: vi.fn(() => ({ available: true })),
    };
  }

  function mockWorkspace(sessionId: string): WorkspaceInfo {
    return {
      id: `ws-${sessionId}`,
      type: 'local-container',
      directory: '/tmp/ws',
      branchName: 'hydraz/test',
      sessionId,
    };
  }

  function mockChildProcess(): ChildProcess {
    return {
      killed: false,
      kill: vi.fn(function(this: { killed: boolean }) { this.killed = true; return true; }),
      pid: 12345,
    } as unknown as ChildProcess;
  }

  function mockExecutorHandle(): ExecutorHandle {
    return {
      process: {} as ChildProcess,
      pid: 99999,
      kill: vi.fn(),
      waitForExit: vi.fn(),
    };
  }

  describe('registerSession / unregisterSession', () => {
    it('registers and unregisters without error', () => {
      const session = makeSession();
      const provider = mockProvider();
      const workspace = mockWorkspace(session.id);

      expect(() => registerSession(session.id, repoRoot, provider, workspace, {})).not.toThrow();
      expect(() => unregisterSession(session.id)).not.toThrow();
    });

    it('unregistering an unknown session is a no-op', () => {
      expect(() => unregisterSession('nonexistent')).not.toThrow();
    });
  });

  describe('registerSshChild', () => {
    it('accepts a child process reference', () => {
      const child = mockChildProcess();
      expect(() => registerSshChild(child)).not.toThrow();
    });
  });

  describe('registerExecutorHandle / unregisterExecutorHandle', () => {
    it('registers and unregisters executor handles', () => {
      const handle = mockExecutorHandle();
      expect(() => registerExecutorHandle(handle)).not.toThrow();
      expect(() => unregisterExecutorHandle(handle)).not.toThrow();
    });

    it('unregistering an unregistered handle is a no-op', () => {
      const handle = mockExecutorHandle();
      expect(() => unregisterExecutorHandle(handle)).not.toThrow();
    });
  });

  describe('gracefulShutdown', () => {
    it('is a no-op when no session is registered', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      gracefulShutdown();
      expect(exitSpy).not.toHaveBeenCalled();
      exitSpy.mockRestore();
    });

    it('transitions session to stopped', () => {
      const session = makeSession('shutdown-state');
      transitionState(repoRoot, session.id, 'starting');
      transitionState(repoRoot, session.id, 'investigating');

      const provider = mockProvider();
      const workspace = mockWorkspace(session.id);
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      registerSession(session.id, repoRoot, provider, workspace, {});
      gracefulShutdown();

      const loaded = loadSession(repoRoot, session.id);
      expect(loaded.state).toBe('stopped');
      exitSpy.mockRestore();
    });

    it('emits session.stopped event via callbacks', () => {
      const session = makeSession('shutdown-event');
      transitionState(repoRoot, session.id, 'starting');

      const provider = mockProvider();
      const workspace = mockWorkspace(session.id);
      const onEvent = vi.fn();
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      registerSession(session.id, repoRoot, provider, workspace, { onEvent });
      gracefulShutdown();

      expect(onEvent).toHaveBeenCalledWith('session.stopped', expect.any(String));
      exitSpy.mockRestore();
    });

    it('kills the registered SSH child', () => {
      const session = makeSession('shutdown-ssh');
      transitionState(repoRoot, session.id, 'starting');

      const provider = mockProvider();
      const workspace = mockWorkspace(session.id);
      const child = mockChildProcess();
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      registerSession(session.id, repoRoot, provider, workspace, {});
      registerSshChild(child);
      gracefulShutdown();

      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      exitSpy.mockRestore();
    });

    it('kills all registered executor handles', () => {
      const session = makeSession('shutdown-handles');
      transitionState(repoRoot, session.id, 'starting');

      const provider = mockProvider();
      const workspace = mockWorkspace(session.id);
      const handle1 = mockExecutorHandle();
      const handle2 = mockExecutorHandle();
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      registerSession(session.id, repoRoot, provider, workspace, {});
      registerExecutorHandle(handle1);
      registerExecutorHandle(handle2);
      gracefulShutdown();

      expect(handle1.kill).toHaveBeenCalled();
      expect(handle2.kill).toHaveBeenCalled();
      exitSpy.mockRestore();
    });

    it('does not kill unregistered executor handles', () => {
      const session = makeSession('shutdown-unreg');
      transitionState(repoRoot, session.id, 'starting');

      const provider = mockProvider();
      const workspace = mockWorkspace(session.id);
      const handle = mockExecutorHandle();
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      registerSession(session.id, repoRoot, provider, workspace, {});
      registerExecutorHandle(handle);
      unregisterExecutorHandle(handle);
      gracefulShutdown();

      expect(handle.kill).not.toHaveBeenCalled();
      exitSpy.mockRestore();
    });

    it('destroys workspace for container sessions', () => {
      const session = makeContainerSession('shutdown-container');
      transitionState(repoRoot, session.id, 'starting');

      const destroyFn = vi.fn();
      const provider = mockProvider(destroyFn);
      const workspace = mockWorkspace(session.id);
      workspace.type = 'local-container';
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      registerSession(session.id, repoRoot, provider, workspace, {});
      gracefulShutdown();

      expect(destroyFn).toHaveBeenCalledWith(repoRoot, workspace);
      exitSpy.mockRestore();
    });

    it('does not destroy workspace for local sessions', () => {
      const session = makeSession('shutdown-local');
      transitionState(repoRoot, session.id, 'starting');

      const destroyFn = vi.fn();
      const provider = { ...mockProvider(destroyFn), type: 'local' as const };
      const workspace = { ...mockWorkspace(session.id), type: 'local' as const };
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      registerSession(session.id, repoRoot, provider, workspace, {});
      gracefulShutdown();

      expect(destroyFn).not.toHaveBeenCalled();
      exitSpy.mockRestore();
    });

    it('calls process.exit(130) after cleanup', () => {
      const session = makeSession('shutdown-exit');
      transitionState(repoRoot, session.id, 'starting');

      const provider = mockProvider();
      const workspace = mockWorkspace(session.id);
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      registerSession(session.id, repoRoot, provider, workspace, {});
      gracefulShutdown();

      expect(exitSpy).toHaveBeenCalledWith(130);
      exitSpy.mockRestore();
    });

    it('is a no-op after unregisterSession', () => {
      const session = makeSession('shutdown-after-unreg');
      transitionState(repoRoot, session.id, 'starting');

      const provider = mockProvider();
      const workspace = mockWorkspace(session.id);
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      registerSession(session.id, repoRoot, provider, workspace, {});
      unregisterSession(session.id);
      gracefulShutdown();

      const loaded = loadSession(repoRoot, session.id);
      expect(loaded.state).toBe('starting');
      expect(exitSpy).not.toHaveBeenCalled();
      exitSpy.mockRestore();
    });

    it('is idempotent — second call is a hard exit', () => {
      const session = makeSession('shutdown-double');
      transitionState(repoRoot, session.id, 'starting');

      const provider = mockProvider();
      const workspace = mockWorkspace(session.id);
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      registerSession(session.id, repoRoot, provider, workspace, {});
      gracefulShutdown();
      gracefulShutdown();

      expect(exitSpy).toHaveBeenCalledTimes(2);
      expect(exitSpy).toHaveBeenNthCalledWith(1, 130);
      expect(exitSpy).toHaveBeenNthCalledWith(2, 1);
      exitSpy.mockRestore();
    });

    it('skips state transition when session is already in a terminal state', () => {
      const session = makeSession('shutdown-terminal');
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

      const provider = mockProvider();
      const workspace = mockWorkspace(session.id);
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      registerSession(session.id, repoRoot, provider, workspace, {});
      gracefulShutdown();

      const loaded = loadSession(repoRoot, session.id);
      expect(loaded.state).toBe('completed');
      exitSpy.mockRestore();
    });

    it('swallows errors from destroyWorkspace without crashing', () => {
      const session = makeContainerSession('shutdown-destroy-err');
      transitionState(repoRoot, session.id, 'starting');

      const destroyFn = vi.fn(() => { throw new Error('DevPod boom'); });
      const provider = mockProvider(destroyFn);
      const workspace = mockWorkspace(session.id);
      workspace.type = 'local-container';
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      registerSession(session.id, repoRoot, provider, workspace, {});
      expect(() => gracefulShutdown()).not.toThrow();

      expect(exitSpy).toHaveBeenCalledWith(130);
      exitSpy.mockRestore();
    });

    it('does not kill an already-killed SSH child', () => {
      const session = makeSession('shutdown-killed-ssh');
      transitionState(repoRoot, session.id, 'starting');

      const provider = mockProvider();
      const workspace = mockWorkspace(session.id);
      const child = { ...mockChildProcess(), killed: true } as unknown as ChildProcess;
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      registerSession(session.id, repoRoot, provider, workspace, {});
      registerSshChild(child);
      gracefulShutdown();

      expect(child.kill).not.toHaveBeenCalled();
      exitSpy.mockRestore();
    });
  });
});
