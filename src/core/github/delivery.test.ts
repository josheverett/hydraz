import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSession } from '../sessions/schema.js';
import { finalizeGitHubContainerDelivery } from './delivery.js';

vi.mock('../repo/detect.js', () => ({
  getGitHubRepo: vi.fn(),
}));

vi.mock('../sessions/artifacts.js', () => ({
  loadArtifact: vi.fn(),
}));

vi.mock('./api.js', () => ({
  githubBranchExists: vi.fn(),
  getGitHubDefaultBranch: vi.fn(),
  ensureGitHubPullRequest: vi.fn(),
}));

import { getGitHubRepo } from '../repo/detect.js';
import { loadArtifact } from '../sessions/artifacts.js';
import {
  ensureGitHubPullRequest,
  getGitHubDefaultBranch,
  githubBranchExists,
} from './api.js';

const mockGetGitHubRepo = vi.mocked(getGitHubRepo);
const mockLoadArtifact = vi.mocked(loadArtifact);
const mockGithubBranchExists = vi.mocked(githubBranchExists);
const mockGetGitHubDefaultBranch = vi.mocked(getGitHubDefaultBranch);
const mockEnsureGitHubPullRequest = vi.mocked(ensureGitHubPullRequest);

const session = createSession({
  name: 'beta-delivery',
  repoRoot: '/repo',
  branchName: 'hydraz/beta-delivery',
  personas: ['architect', 'implementer', 'verifier'],
  executionTarget: 'local-container',
  task: 'Deliver work to GitHub',
});

const workspace = {
  id: session.id,
  type: 'local-container' as const,
  directory: '/tmp/hydraz-worktrees/session-id',
  branchName: session.branchName,
  sessionId: session.id,
};

const provider = {
  type: 'local-container' as const,
  checkAvailability: () => ({ available: true }),
  createWorkspace: () => workspace,
  destroyWorkspace: vi.fn(),
};

beforeEach(() => {
  vi.resetAllMocks();
  mockGetGitHubRepo.mockReturnValue({
    remoteName: 'origin',
    remoteUrl: 'git@github.com:octocat/hello-world.git',
    owner: 'octocat',
    repo: 'hello-world',
    httpsUrl: 'https://github.com/octocat/hello-world.git',
  });
  mockGithubBranchExists.mockResolvedValue(true);
  mockGetGitHubDefaultBranch.mockResolvedValue('main');
  mockLoadArtifact.mockReturnValue('# Title\n\nBody');
  mockEnsureGitHubPullRequest.mockResolvedValue({
    number: 12,
    url: 'https://github.com/octocat/hello-world/pull/12',
    existing: false,
  });
});

describe('finalizeGitHubContainerDelivery', () => {
  it('preserves the workspace when the branch is not on GitHub', async () => {
    mockGithubBranchExists.mockResolvedValue(false);

    const result = await finalizeGitHubContainerDelivery({
      session,
      workspace,
      repoRoot: '/repo',
      provider,
      token: 'token',
      createPullRequest: true,
    });

    expect(result.action).toBe('preserved');
    expect(provider.destroyWorkspace).not.toHaveBeenCalled();
  });

  it('creates a PR and destroys the workspace after successful delivery', async () => {
    const result = await finalizeGitHubContainerDelivery({
      session,
      workspace,
      repoRoot: '/repo',
      provider,
      token: 'token',
      createPullRequest: true,
    });

    expect(result.action).toBe('destroyed');
    expect(result.prUrl).toBe('https://github.com/octocat/hello-world/pull/12');
    expect(provider.destroyWorkspace).toHaveBeenCalledWith('/repo', workspace);
  });

  it('skips PR creation when only branch verification is needed', async () => {
    const result = await finalizeGitHubContainerDelivery({
      session,
      workspace,
      repoRoot: '/repo',
      provider,
      token: 'token',
      createPullRequest: false,
    });

    expect(result.action).toBe('destroyed');
    expect(mockEnsureGitHubPullRequest).not.toHaveBeenCalled();
    expect(provider.destroyWorkspace).toHaveBeenCalledWith('/repo', workspace);
  });
});
