import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalContainerProvider } from './local-container.js';
import { createSession } from '../sessions/schema.js';
import { createDefaultConfig } from '../config/schema.js';

vi.mock('./worktree.js', () => ({
  createWorktree: vi.fn(() => ({
    directory: '/fake/worktree/dir',
    branchName: 'hydraz/test-session',
  })),
  destroyWorktree: vi.fn(),
}));

vi.mock('./devpod.js', () => ({
  checkDevPodAvailability: vi.fn(() => ({ available: true, version: 'v0.6.15' })),
  checkDockerAvailability: vi.fn(() => true),
  hasDevcontainerJson: vi.fn(() => true),
  devpodUp: vi.fn(),
  devpodDelete: vi.fn(),
  verifyClaudeInContainer: vi.fn(() => ({ available: true, version: 'Claude Code v2.1.74' })),
}));

import { createWorktree, destroyWorktree } from './worktree.js';
import {
  checkDevPodAvailability,
  checkDockerAvailability,
  hasDevcontainerJson,
  devpodUp,
  devpodDelete,
  verifyClaudeInContainer,
} from './devpod.js';

const mockCreateWorktree = vi.mocked(createWorktree);
const mockDestroyWorktree = vi.mocked(destroyWorktree);
const mockCheckDevPod = vi.mocked(checkDevPodAvailability);
const mockCheckDocker = vi.mocked(checkDockerAvailability);
const mockHasDevcontainer = vi.mocked(hasDevcontainerJson);
const mockDevpodUp = vi.mocked(devpodUp);
const mockDevpodDelete = vi.mocked(devpodDelete);
const mockVerifyClaude = vi.mocked(verifyClaudeInContainer);

function makeSession(name: string = 'test-session') {
  return createSession({
    name,
    repoRoot: '/fake/repo',
    branchName: `hydraz/${name}`,
    personas: ['architect', 'implementer', 'verifier'],
    executionTarget: 'local-container',
    task: 'Fix it',
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mockCreateWorktree.mockReturnValue({
    directory: '/fake/worktree/dir',
    branchName: 'hydraz/test-session',
  });
  mockCheckDevPod.mockReturnValue({ available: true, version: 'v0.6.15' });
  mockCheckDocker.mockReturnValue(true);
  mockHasDevcontainer.mockReturnValue(true);
  mockVerifyClaude.mockReturnValue({ available: true, version: 'Claude Code v2.1.74' });
});

describe('LocalContainerProvider', () => {
  it('has type "local-container"', () => {
    const provider = new LocalContainerProvider();
    expect(provider.type).toBe('local-container');
  });

  describe('checkAvailability', () => {
    it('returns available when all prerequisites are met', () => {
      const provider = new LocalContainerProvider();
      const result = provider.checkAvailability();
      expect(result.available).toBe(true);
    });

    it('fails when DevPod is not available', () => {
      mockCheckDevPod.mockReturnValue({ available: false, error: 'DevPod CLI is not available on PATH' });
      const provider = new LocalContainerProvider();
      const result = provider.checkAvailability();
      expect(result.available).toBe(false);
      expect(result.error).toContain('DevPod');
    });

    it('fails when Docker is not available', () => {
      mockCheckDocker.mockReturnValue(false);
      const provider = new LocalContainerProvider();
      const result = provider.checkAvailability();
      expect(result.available).toBe(false);
      expect(result.error).toContain('Docker');
    });
  });

  describe('createWorkspace', () => {
    it('creates a worktree then launches devpod', () => {
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = createDefaultConfig();

      const workspace = provider.createWorkspace({ session, config });

      expect(mockCreateWorktree).toHaveBeenCalledWith(
        session.repoRoot,
        session.id,
        session.branchName,
      );
      expect(mockDevpodUp).toHaveBeenCalled();
      expect(workspace.type).toBe('local-container');
      expect(workspace.directory).toBe('/fake/worktree/dir');
      expect(workspace.sessionId).toBe(session.id);
      expect(workspace.branchName).toBe('hydraz/test-session');
    });

    it('uses a devpod workspace name derived from the session id', () => {
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = createDefaultConfig();

      provider.createWorkspace({ session, config });

      const devpodUpArgs = mockDevpodUp.mock.calls[0];
      expect(devpodUpArgs?.[0]).toBe('/fake/worktree/dir');
      expect(devpodUpArgs?.[1]).toContain(session.id);
    });

    it('cleans up worktree if devpod up fails', () => {
      mockDevpodUp.mockImplementation(() => { throw new Error('devpod failed'); });
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = createDefaultConfig();

      expect(() => provider.createWorkspace({ session, config })).toThrow('devpod failed');
      expect(mockDestroyWorktree).toHaveBeenCalled();
    });

    it('fails if devcontainer.json is missing', () => {
      mockHasDevcontainer.mockReturnValue(false);
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = createDefaultConfig();

      expect(() => provider.createWorkspace({ session, config })).toThrow('devcontainer');
    });

    it('tears down workspace if Claude Code is not found in the container', () => {
      mockVerifyClaude.mockReturnValue({ available: false, error: 'Claude Code CLI is not available inside the container' });
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = createDefaultConfig();

      expect(() => provider.createWorkspace({ session, config })).toThrow('Claude Code');
      expect(mockDevpodDelete).toHaveBeenCalled();
      expect(mockDestroyWorktree).toHaveBeenCalled();
    });
  });

  describe('destroyWorkspace', () => {
    const fakeWorkspace = {
      id: 'session-123',
      type: 'local-container' as const,
      directory: '/fake/worktree/dir',
      branchName: 'hydraz/test-session',
      sessionId: 'session-123',
    };

    it('deletes devpod workspace then destroys worktree', () => {
      const provider = new LocalContainerProvider();

      provider.destroyWorkspace('/fake/repo', fakeWorkspace);

      expect(mockDevpodDelete).toHaveBeenCalledWith('hydraz-session-123');
      expect(mockDestroyWorktree).toHaveBeenCalledWith('/fake/repo', '/fake/worktree/dir');
    });

    it('still destroys worktree if devpod delete fails', () => {
      mockDevpodDelete.mockImplementation(() => { throw new Error('delete failed'); });
      const provider = new LocalContainerProvider();

      provider.destroyWorkspace('/fake/repo', fakeWorkspace);

      expect(mockDestroyWorktree).toHaveBeenCalledWith('/fake/repo', '/fake/worktree/dir');
    });
  });
});
