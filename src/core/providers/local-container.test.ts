import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalContainerProvider } from './local-container.js';
import { CloudProvider } from './cloud.js';
import { createSession } from '../sessions/schema.js';
import { createDefaultConfig } from '../config/schema.js';

vi.mock('../repo/detect.js', () => ({
  hasGitRemote: vi.fn(() => true),
  getGitHubRepo: vi.fn(() => ({
    remoteName: 'origin',
    remoteUrl: 'git@github.com:octocat/hello-world.git',
    owner: 'octocat',
    repo: 'hello-world',
    httpsUrl: 'https://github.com/octocat/hello-world.git',
  })),
  getCurrentBranch: vi.fn(() => 'feature/devcontainer'),
}));

vi.mock('./worktree-include.js', () => ({
  listCopyableWorktreeIncludes: vi.fn(() => ['agent/.env']),
}));

vi.mock('../github/api.js', () => ({
  getGitHubAuthenticatedUserIdentity: vi.fn(async () => ({
    name: 'josheverett',
    email: '151150+josheverett@users.noreply.github.com',
  })),
}));

vi.mock('./devpod.js', () => ({
  checkDevPodAvailability: vi.fn(() => ({ available: true, version: 'v0.6.15' })),
  checkDockerAvailability: vi.fn(() => true),
  hasDevcontainerJson: vi.fn(() => true),
  checkDevcontainerPlatform: vi.fn(() => ({ ok: true })),
  devpodUp: vi.fn(),
  devpodDelete: vi.fn(),
  verifyCodexInContainer: vi.fn(() => ({ available: true, version: 'codex-cli 0.142.5' })),
  createWorktreeInContainer: vi.fn(() => '/tmp/hydraz-worktrees/session-id'),
  configureGitIdentityInContainer: vi.fn(),
  copyWorktreeIncludesInContainer: vi.fn(),
  scpFilesToContainer: vi.fn(),
  getContainerRepoPath: vi.fn(() => '/workspaces/hydraz-default'),
  composeProjectName: vi.fn((workspaceName: string) => workspaceName.toLowerCase()),
  removeComposeProjectVolumes: vi.fn(),
  setupContainerGitSsh: vi.fn(),
  sshExec: vi.fn(),
}));

import { hasGitRemote, getGitHubRepo, getCurrentBranch } from '../repo/detect.js';
import {
  checkDevPodAvailability,
  checkDockerAvailability,
  hasDevcontainerJson,
  devpodUp,
  devpodDelete,
  verifyCodexInContainer,
  createWorktreeInContainer,
  configureGitIdentityInContainer,
  copyWorktreeIncludesInContainer,
  scpFilesToContainer,
  getContainerRepoPath,
  composeProjectName,
  removeComposeProjectVolumes,
  sshExec,
} from './devpod.js';
import { listCopyableWorktreeIncludes } from './worktree-include.js';
import { getGitHubAuthenticatedUserIdentity } from '../github/api.js';

const mockCheckDevPod = vi.mocked(checkDevPodAvailability);
const mockCheckDocker = vi.mocked(checkDockerAvailability);
const mockHasDevcontainer = vi.mocked(hasDevcontainerJson);
const mockDevpodUp = vi.mocked(devpodUp);
const mockDevpodDelete = vi.mocked(devpodDelete);
const mockVerifyCodex = vi.mocked(verifyCodexInContainer);
const mockCreateWorktreeInContainer = vi.mocked(createWorktreeInContainer);
const mockConfigureGitIdentity = vi.mocked(configureGitIdentityInContainer);
const mockCopyIncludes = vi.mocked(copyWorktreeIncludesInContainer);
const mockScpFiles = vi.mocked(scpFilesToContainer);
const mockGetContainerRepoPath = vi.mocked(getContainerRepoPath);
const mockComposeProjectName = vi.mocked(composeProjectName);
const mockRemoveComposeProjectVolumes = vi.mocked(removeComposeProjectVolumes);
const _mockSshExec = vi.mocked(sshExec);
const mockHasGitRemote = vi.mocked(hasGitRemote);
const mockGetGitHubRepo = vi.mocked(getGitHubRepo);
const mockGetCurrentBranch = vi.mocked(getCurrentBranch);
const mockListCopyableIncludes = vi.mocked(listCopyableWorktreeIncludes);
const mockGetGitHubIdentity = vi.mocked(getGitHubAuthenticatedUserIdentity);

function makeSession(name: string = 'test-session', executionTarget: 'local-container' | 'cloud' = 'local-container') {
  return createSession({
    name,
    repoRoot: '/fake/repo',
    branchName: `hydraz/${name}`,
    executionTarget,
    task: 'Fix it',
  });
}

function makeConfig(withGitHubToken: boolean = true) {
  const config = createDefaultConfig();
  if (withGitHubToken) {
    config.github.token = 'github_pat_test';
  }
  return config;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockCheckDevPod.mockReturnValue({ available: true, version: 'v0.6.15' });
  mockCheckDocker.mockReturnValue(true);
  mockHasDevcontainer.mockReturnValue(true);
  mockHasGitRemote.mockReturnValue(true);
  mockGetGitHubRepo.mockReturnValue({
    remoteName: 'origin',
    remoteUrl: 'git@github.com:octocat/hello-world.git',
    owner: 'octocat',
    repo: 'hello-world',
    httpsUrl: 'https://github.com/octocat/hello-world.git',
  });
  mockVerifyCodex.mockReturnValue({ available: true, version: 'codex-cli 0.142.5' });
  mockCreateWorktreeInContainer.mockReturnValue('/tmp/hydraz-worktrees/session-id');
  mockGetContainerRepoPath.mockReturnValue('/workspaces/hydraz-default');
  mockComposeProjectName.mockImplementation((workspaceName) => workspaceName.toLowerCase());
  mockListCopyableIncludes.mockReturnValue(['agent/.env']);
  mockGetCurrentBranch.mockReturnValue('feature/devcontainer');
  mockGetGitHubIdentity.mockResolvedValue({
    name: 'josheverett',
    email: '151150+josheverett@users.noreply.github.com',
  });
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
    it('launches devpod with the git remote URL, docker provider, and current branch', async () => {
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = makeConfig();

      await provider.createWorkspace({ session, config });

      expect(mockDevpodUp).toHaveBeenCalledWith(
        'git@github.com:octocat/hello-world.git',
        expect.stringContaining('hydraz-'),
        expect.objectContaining({
          provider: 'docker',
          branch: 'feature/devcontainer',
          env: expect.objectContaining({ GH_TOKEN: 'github_pat_test' }),
          processEnv: expect.objectContaining({ COMPOSE_PROJECT_NAME: expect.stringContaining('hydraz-') }),
        }),
      );
    });

    it('pins a deterministic Compose project name only in the DevPod process environment', async () => {
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = makeConfig();

      await provider.createWorkspace({ session, config });

      const workspaceName = `hydraz-${session.id}`;
      expect(mockComposeProjectName).toHaveBeenCalledWith(workspaceName);
      expect(mockDevpodUp.mock.calls[0]?.[2]?.processEnv).toEqual({
        COMPOSE_PROJECT_NAME: workspaceName,
      });
    });

    it('launches devpod with an explicit branch override when provided', async () => {
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = makeConfig();

      await provider.createWorkspace({ session, config, branchOverride: 'staging' });

      expect(mockDevpodUp).toHaveBeenCalledWith(
        'git@github.com:octocat/hello-world.git',
        expect.stringContaining('hydraz-'),
        expect.objectContaining({
          provider: 'docker',
          branch: 'staging',
          env: expect.objectContaining({ GH_TOKEN: 'github_pat_test' }),
          processEnv: expect.objectContaining({ COMPOSE_PROJECT_NAME: expect.stringContaining('hydraz-') }),
        }),
      );
    });

    it('creates worktree inside the container via SSH', async () => {
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = makeConfig();

      await provider.createWorkspace({ session, config });

      expect(mockCreateWorktreeInContainer).toHaveBeenCalledWith(
        expect.stringContaining(session.id),
        expect.stringContaining('/workspaces/'),
        session.branchName,
        session.id,
      );
    });

    it('uses the repository root discovered inside the container for worktree setup and includes', async () => {
      mockGetContainerRepoPath.mockReturnValue('/workspaces/fixture-app');
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = makeConfig();

      await provider.createWorkspace({ session, config });

      expect(mockCreateWorktreeInContainer).toHaveBeenCalledWith(
        expect.stringContaining(session.id),
        '/workspaces/fixture-app',
        session.branchName,
        session.id,
      );
      expect(mockScpFiles).toHaveBeenCalledWith(
        expect.stringContaining(session.id),
        session.repoRoot,
        '/workspaces/fixture-app',
        ['agent/.env'],
      );
      expect(mockCopyIncludes).toHaveBeenCalledWith(
        expect.stringContaining(session.id),
        '/workspaces/fixture-app',
        '/tmp/hydraz-worktrees/session-id',
        ['agent/.env'],
      );
    });

    it('configures managed git identity inside the created worktree when provided', async () => {
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = makeConfig();
      const gitIdentity = {
        name: 'josheverett',
        email: '151150+josheverett@users.noreply.github.com',
      };

      await provider.createWorkspace({ session, config, gitIdentity });

      expect(mockConfigureGitIdentity).toHaveBeenCalledWith(
        expect.stringContaining(session.id),
        '/tmp/hydraz-worktrees/session-id',
        gitIdentity,
      );
    });

    it('fetches managed git identity from the configured GitHub token', async () => {
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = makeConfig();

      await provider.createWorkspace({ session, config });

      expect(mockGetGitHubIdentity).toHaveBeenCalledWith('github_pat_test');
      const envArg = mockDevpodUp.mock.calls[0]?.[2]?.env;
      expect(envArg).toMatchObject({
        GIT_AUTHOR_NAME: 'josheverett',
        GIT_AUTHOR_EMAIL: '151150+josheverett@users.noreply.github.com',
        GIT_COMMITTER_NAME: 'josheverett',
        GIT_COMMITTER_EMAIL: '151150+josheverett@users.noreply.github.com',
      });
      expect(mockConfigureGitIdentity).toHaveBeenCalledWith(
        expect.stringContaining(session.id),
        '/tmp/hydraz-worktrees/session-id',
        {
          name: 'josheverett',
          email: '151150+josheverett@users.noreply.github.com',
        },
      );
    });

    it('fails before launching devpod when managed git identity cannot be loaded', async () => {
      mockGetGitHubIdentity.mockRejectedValue(new Error('Failed to load GitHub authenticated user (401)'));
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = makeConfig();

      await expect(provider.createWorkspace({ session, config })).rejects.toThrow(
        'Failed to load managed git identity',
      );
      expect(mockDevpodUp).not.toHaveBeenCalled();
    });

    it('copies .worktreeinclude files inside the container', async () => {
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = makeConfig();

      await provider.createWorkspace({ session, config });

      expect(mockListCopyableIncludes).toHaveBeenCalledWith(
        '/fake/repo',
        '/fake/repo/.hydraz-container-worktree',
      );
      expect(mockCopyIncludes).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('/workspaces/'),
        expect.stringContaining('/tmp/hydraz-worktrees/'),
        ['agent/.env'],
      );
    });

    it('SCPs worktree include files from host to container before copying within container', async () => {
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = makeConfig();

      await provider.createWorkspace({ session, config });

      expect(mockScpFiles).toHaveBeenCalledWith(
        expect.stringContaining('hydraz-'),
        '/fake/repo',
        expect.stringContaining('/workspaces/'),
        ['agent/.env'],
      );
    });

    it('does not SCP when there are no worktree include files', async () => {
      mockListCopyableIncludes.mockReturnValue([]);
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = makeConfig();

      await provider.createWorkspace({ session, config });

      expect(mockScpFiles).not.toHaveBeenCalled();
    });

    it('tears down devpod if SCP of worktree include files fails', async () => {
      mockScpFiles.mockRejectedValueOnce(new Error('scp failed'));
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = makeConfig();

      await expect(provider.createWorkspace({ session, config })).rejects.toThrow('scp failed');
      expect(mockDevpodDelete).toHaveBeenCalled();
    });

    it('fails before launching devpod when .worktreeinclude validation rejects a symlink', async () => {
      mockListCopyableIncludes.mockImplementation(() => {
        throw new Error('Refusing to copy symlink entry from .worktreeinclude: agent/.env');
      });
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = makeConfig();

      await expect(provider.createWorkspace({ session, config })).rejects.toThrow(/symlink/i);
      expect(mockDevpodUp).not.toHaveBeenCalled();
      expect(mockVerifyCodex).not.toHaveBeenCalled();
      expect(mockCreateWorktreeInContainer).not.toHaveBeenCalled();
    });

    it('returns container-internal worktree path as directory', async () => {
      mockCreateWorktreeInContainer.mockReturnValue('/tmp/hydraz-worktrees/abc');
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = makeConfig();

      const workspace = await provider.createWorkspace({ session, config });

      expect(workspace.type).toBe('local-container');
      expect(workspace.directory).toBe('/tmp/hydraz-worktrees/abc');
      expect(workspace.sessionId).toBe(session.id);
    });

    it('returns a cloud workspace type when invoked for a cloud session', async () => {
      mockCreateWorktreeInContainer.mockReturnValue('/tmp/hydraz-worktrees/cloud-abc');
      const provider = new LocalContainerProvider();
      const session = makeSession('cloud-session', 'cloud');
      const config = makeConfig();

      const workspace = await provider.createWorkspace({ session, config });

      expect(workspace.type).toBe('cloud');
    });

    it('tears down devpod if worktree creation inside container fails', async () => {
      mockCreateWorktreeInContainer.mockImplementation(() => { throw new Error('git failed'); });
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = makeConfig();

      await expect(provider.createWorkspace({ session, config })).rejects.toThrow('git failed');
      expect(mockDevpodDelete).toHaveBeenCalled();
    });

    it('fails if devcontainer.json is missing', async () => {
      mockHasDevcontainer.mockReturnValue(false);
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = makeConfig();

      await expect(provider.createWorkspace({ session, config })).rejects.toThrow('devcontainer');
    });

    it('fails if no git remote is configured', async () => {
      mockHasGitRemote.mockReturnValue(false);
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = makeConfig();

      await expect(provider.createWorkspace({ session, config })).rejects.toThrow('remote');
    });

    it('fails early when the repo remote is not supported for GitHub-only beta automation', async () => {
      mockGetGitHubRepo.mockReturnValue(null);
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = makeConfig();

      await expect(provider.createWorkspace({ session, config })).rejects.toThrow(/GitHub-only/i);
      expect(mockDevpodUp).not.toHaveBeenCalled();
      expect(mockCreateWorktreeInContainer).not.toHaveBeenCalled();
    });

    it('fails before launching devpod when Hydraz GitHub auth is not configured', async () => {
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = makeConfig(false);

      await expect(provider.createWorkspace({ session, config })).rejects.toThrow(
        'GitHub token is required to configure managed git identity',
      );
      expect(mockDevpodUp).not.toHaveBeenCalled();
      expect(mockCreateWorktreeInContainer).not.toHaveBeenCalled();
    });

    it('tears down workspace if Codex CLI is not found in the container', async () => {
      mockVerifyCodex.mockReturnValue({ available: false, error: 'Codex CLI is not available inside the container' });
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = makeConfig();

      await expect(provider.createWorkspace({ session, config })).rejects.toThrow('Codex CLI');
      expect(mockDevpodDelete).toHaveBeenCalled();
    });

    it('uses local repo path as devpod source when skipClone is true', async () => {
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = makeConfig();

      await provider.createWorkspace({ session, config, skipClone: true });

      expect(mockDevpodUp).toHaveBeenCalledWith(
        '/fake/repo',
        expect.stringContaining('hydraz-'),
        expect.objectContaining({
          provider: 'docker',
          env: expect.objectContaining({ GH_TOKEN: 'github_pat_test' }),
          processEnv: expect.objectContaining({ COMPOSE_PROJECT_NAME: expect.stringContaining('hydraz-') }),
        }),
      );
    });

    it('skips git remote and GitHub checks when skipClone is true', async () => {
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = makeConfig(false);

      await provider.createWorkspace({ session, config, skipClone: true });

      expect(mockHasGitRemote).not.toHaveBeenCalled();
      expect(mockGetGitHubRepo).not.toHaveBeenCalled();
      expect(mockDevpodUp).toHaveBeenCalled();
    });

    it('skips worktree creation when skipClone is true', async () => {
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = makeConfig();

      await provider.createWorkspace({ session, config, skipClone: true });

      expect(mockCreateWorktreeInContainer).not.toHaveBeenCalled();
      expect(mockCopyIncludes).not.toHaveBeenCalled();
      expect(mockScpFiles).not.toHaveBeenCalled();
    });

    it('returns container repo path as directory when skipClone is true', async () => {
      mockGetContainerRepoPath.mockReturnValue('/workspaces/fixture-app');
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = makeConfig();

      const workspace = await provider.createWorkspace({ session, config, skipClone: true });

      expect(workspace.directory).toBe('/workspaces/fixture-app');
    });

    it('deletes the DevPod workspace when repository-root discovery fails', async () => {
      mockGetContainerRepoPath.mockImplementation(() => {
        throw new Error('git could not find a repository');
      });
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = makeConfig();

      await expect(provider.createWorkspace({ session, config })).rejects.toThrow(
        'Failed to resolve container repository root: git could not find a repository',
      );
      expect(mockDevpodDelete).toHaveBeenCalledWith(`hydraz-${session.id}`);
    });

    it('passes container auth env to devpodUp', async () => {
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = makeConfig();

      await provider.createWorkspace({ session, config });

      const envArg = mockDevpodUp.mock.calls[0]?.[2]?.env;
      expect(envArg).toBeDefined();
      expect(envArg!['GH_TOKEN']).toBe('github_pat_test');
    });

    it('threads onHeartbeat callback from params to devpodUp', async () => {
      const heartbeatCb = vi.fn();
      const provider = new LocalContainerProvider();
      const session = makeSession();
      const config = makeConfig();

      await provider.createWorkspace({ session, config, onHeartbeat: heartbeatCb });

      const passedCb = mockDevpodUp.mock.calls[0]?.[2]?.onHeartbeat;
      expect(passedCb).toBeDefined();
      passedCb?.('DevPod provisioning', 15000);
      expect(heartbeatCb).toHaveBeenCalledWith('DevPod provisioning', 15000);
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

    it('removes Compose volumes for a local-container workspace after deletion', () => {
      const provider = new LocalContainerProvider();

      provider.destroyWorkspace('/fake/repo', fakeWorkspace);

      expect(mockComposeProjectName).toHaveBeenCalledWith('hydraz-session-123');
      expect(mockRemoveComposeProjectVolumes).toHaveBeenCalledWith('hydraz-session-123');
    });

    it('does not invoke local Docker volume cleanup for a cloud workspace', () => {
      const provider = new LocalContainerProvider();
      const cloudWorkspace = { ...fakeWorkspace, type: 'cloud' as const };

      provider.destroyWorkspace('/fake/repo', cloudWorkspace);

      expect(mockRemoveComposeProjectVolumes).not.toHaveBeenCalled();
    });

    it('does not throw if devpod delete fails', () => {
      mockDevpodDelete.mockImplementation(() => { throw new Error('delete failed'); });
      const provider = new LocalContainerProvider();

      expect(() => provider.destroyWorkspace('/fake/repo', fakeWorkspace)).not.toThrow();
    });
  });
});

describe('CloudProvider', () => {
  it('has type "cloud"', () => {
    const provider = new CloudProvider();
    expect(provider.type).toBe('cloud');
  });

  describe('checkAvailability', () => {
    it('does not require Docker', () => {
      mockCheckDocker.mockReturnValue(false);
      const provider = new CloudProvider();
      const result = provider.checkAvailability();
      expect(result.available).toBe(true);
    });
  });

  describe('createWorkspace', () => {
    it('does not force docker provider or branch for devpod up', async () => {
      const provider = new CloudProvider();
      const session = makeSession('cloud-session', 'cloud');
      const config = makeConfig();

      await provider.createWorkspace({ session, config });

      const options = mockDevpodUp.mock.calls[0]?.[2];
      const providerArg = options?.provider;
      const branchArg = options?.branch;
      const processEnvArg = options?.processEnv;
      expect(providerArg).toBeUndefined();
      expect(branchArg).toBeUndefined();
      expect(processEnvArg).toBeUndefined();
    });

    it('passes a maximum runtime only for cloud workspaces', async () => {
      const config = makeConfig();
      const localSession = Object.assign(makeSession('local-session'), { maxRuntime: '8h' });
      const cloudSession = Object.assign(makeSession('cloud-session', 'cloud'), { maxRuntime: '8h' });

      await new LocalContainerProvider().createWorkspace({ session: localSession, config });
      await new CloudProvider().createWorkspace({ session: cloudSession, config });

      expect(mockDevpodUp.mock.calls[0]?.[2]?.providerOptions).toBeUndefined();
      expect(mockDevpodUp.mock.calls[1]?.[2]?.providerOptions).toEqual({
        INACTIVITY_TIMEOUT: '8h',
      });
    });
  });
});
