import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalContainerProvider } from './local-container.js';
import { createSession } from '../sessions/schema.js';
import { createDefaultConfig } from '../config/schema.js';

vi.mock('./devpod.js', () => ({
  checkDevPodAvailability: vi.fn(() => ({ available: true, version: 'v0.6.15' })),
  checkDockerAvailability: vi.fn(() => true),
  hasDevcontainerJson: vi.fn(() => true),
  devpodUp: vi.fn(),
  devpodDelete: vi.fn(),
  verifyClaudeInContainer: vi.fn(() => ({ available: true, version: 'Claude Code v2.1.74' })),
  createWorktreeInContainer: vi.fn(() => '/tmp/hydraz-worktrees/session-id'),
  copyWorktreeIncludesInContainer: vi.fn(),
  sshExec: vi.fn(),
}));

import {
  checkDevPodAvailability,
  checkDockerAvailability,
  hasDevcontainerJson,
  devpodUp,
  devpodDelete,
  verifyClaudeInContainer,
  createWorktreeInContainer,
  copyWorktreeIncludesInContainer,
  sshExec,
} from './devpod.js';

const mockCheckDevPod = vi.mocked(checkDevPodAvailability);
const mockCheckDocker = vi.mocked(checkDockerAvailability);
const mockHasDevcontainer = vi.mocked(hasDevcontainerJson);
const mockDevpodUp = vi.mocked(devpodUp);
const mockDevpodDelete = vi.mocked(devpodDelete);
const mockVerifyClaude = vi.mocked(verifyClaudeInContainer);
const mockCreateWorktreeInContainer = vi.mocked(createWorktreeInContainer);
const mockCopyIncludes = vi.mocked(copyWorktreeIncludesInContainer);
const _mockSshExec = vi.mocked(sshExec);

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
  mockCheckDevPod.mockReturnValue({ available: true, version: 'v0.6.15' });
  mockCheckDocker.mockReturnValue(true);
  mockHasDevcontainer.mockReturnValue(true);
  mockVerifyClaude.mockReturnValue({ available: true, version: 'Claude Code v2.1.74' });
  mockCreateWorktreeInContainer.mockReturnValue('/tmp/hydraz-worktrees/session-id');
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
    it('launches devpod with the main repo root, not a worktree', () => {
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = createDefaultConfig();

      provider.createWorkspace({ session, config });

      const devpodUpArgs = mockDevpodUp.mock.calls[0];
      expect(devpodUpArgs?.[0]).toBe('/fake/repo');
    });

    it('creates worktree inside the container via SSH', () => {
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = createDefaultConfig();

      provider.createWorkspace({ session, config });

      expect(mockCreateWorktreeInContainer).toHaveBeenCalledWith(
        expect.stringContaining(session.id),
        expect.stringContaining('/workspaces/'),
        session.branchName,
        session.id,
      );
    });

    it('copies .worktreeinclude files inside the container', () => {
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = createDefaultConfig();

      provider.createWorkspace({ session, config });

      expect(mockCopyIncludes).toHaveBeenCalled();
    });

    it('returns container-internal worktree path as directory', () => {
      mockCreateWorktreeInContainer.mockReturnValue('/tmp/hydraz-worktrees/abc');
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = createDefaultConfig();

      const workspace = provider.createWorkspace({ session, config });

      expect(workspace.type).toBe('local-container');
      expect(workspace.directory).toBe('/tmp/hydraz-worktrees/abc');
      expect(workspace.sessionId).toBe(session.id);
    });

    it('tears down devpod if worktree creation inside container fails', () => {
      mockCreateWorktreeInContainer.mockImplementation(() => { throw new Error('git failed'); });
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = createDefaultConfig();

      expect(() => provider.createWorkspace({ session, config })).toThrow('git failed');
      expect(mockDevpodDelete).toHaveBeenCalled();
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
    });
  });

  describe('destroyWorkspace', () => {
    const fakeWorkspace = {
      id: 'session-123',
      type: 'local-container' as const,
      directory: '/tmp/hydraz-worktrees/session-123',
      branchName: 'hydraz/test-session',
      sessionId: 'session-123',
    };

    it('deletes devpod workspace', () => {
      const provider = new LocalContainerProvider();

      provider.destroyWorkspace('/fake/repo', fakeWorkspace);

      expect(mockDevpodDelete).toHaveBeenCalledWith('hydraz-session-123');
    });

    it('does not throw if devpod delete fails', () => {
      mockDevpodDelete.mockImplementation(() => { throw new Error('delete failed'); });
      const provider = new LocalContainerProvider();

      expect(() => provider.destroyWorkspace('/fake/repo', fakeWorkspace)).not.toThrow();
    });
  });
});
