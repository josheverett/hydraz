import { describe, expect, it, vi } from 'vitest';
import { finalizeCodexDelivery } from './delivery.js';
import type { SessionMetadata } from '../sessions/schema.js';
import type { WorkspaceInfo, WorkspaceProvider } from '../providers/provider.js';

vi.mock('../repo/detect.js', () => ({
  getGitHubRepo: vi.fn(() => ({
    remoteName: 'origin',
    remoteUrl: 'git@github.com:octocat/hello-world.git',
    owner: 'octocat',
    repo: 'hello-world',
    httpsUrl: 'https://github.com/octocat/hello-world.git',
  })),
}));

vi.mock('../github/api.js', () => ({
  compareGitHubBranches: vi.fn(async () => ({
    aheadBy: 1,
    totalCommits: 1,
  })),
  ensureGitHubPullRequest: vi.fn(async () => ({
    number: 12,
    url: 'https://github.com/octocat/hello-world/pull/12',
    existing: false,
  })),
  getGitHubDefaultBranch: vi.fn(async () => 'main'),
}));

import {
  compareGitHubBranches,
  ensureGitHubPullRequest,
  getGitHubDefaultBranch,
} from '../github/api.js';

function makeSession(overrides: Partial<SessionMetadata> = {}): SessionMetadata {
  return {
    id: 'session-1',
    name: 'codex-v3',
    repoRoot: '/repo',
    branchName: 'hydraz/codex-v3',
    executionTarget: 'cloud',
    task: 'Implement v3',
    state: 'delivering',
    createdAt: '2026-07-07T00:00:00.000Z',
    updatedAt: '2026-07-07T00:00:00.000Z',
    ...overrides,
  };
}

function makeWorkspace(): WorkspaceInfo {
  return {
    id: 'session-1',
    type: 'cloud',
    directory: '/workspace',
    branchName: 'hydraz/codex-v3',
    sessionId: 'session-1',
  };
}

function makeProvider() {
  return {
    type: 'cloud',
    createWorkspace: vi.fn(),
    checkAvailability: vi.fn(),
    destroyWorkspace: vi.fn(),
  } as unknown as WorkspaceProvider & { destroyWorkspace: ReturnType<typeof vi.fn> };
}

describe('finalizeCodexDelivery', () => {
  it('commits dirty changes, pushes, creates a PR, and destroys the workspace', async () => {
    const execFile = vi.fn((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'status') return ' M src/index.ts\n';
      return '';
    }) as any;
    const provider = makeProvider();
    const createPullRequestForBranch = vi.fn(async () => 'https://github.com/acme/repo/pull/1');

    const result = await finalizeCodexDelivery({
      session: makeSession(),
      repoRoot: '/repo',
      workspace: makeWorkspace(),
      provider,
      githubToken: 'ghp-test',
      gitIdentity: {
        name: 'josheverett',
        email: '151150+josheverett@users.noreply.github.com',
      },
      createPullRequest: true,
      execFile,
      createPullRequestForBranch,
      compareBranchWithBase: vi.fn(async () => ({
        base: 'main',
        aheadBy: 1,
        totalCommits: 1,
      })),
    });

    expect(execFile).toHaveBeenCalledWith('git', ['add', '-A'], expect.objectContaining({ cwd: '/workspace' }));
    expect(execFile).toHaveBeenCalledWith('git', ['commit', '-m', 'Hydraz Codex: codex-v3'], expect.objectContaining({
      cwd: '/workspace',
      env: expect.objectContaining({
        GIT_AUTHOR_NAME: 'josheverett',
        GIT_AUTHOR_EMAIL: '151150+josheverett@users.noreply.github.com',
        GIT_COMMITTER_NAME: 'josheverett',
        GIT_COMMITTER_EMAIL: '151150+josheverett@users.noreply.github.com',
      }),
    }));
    expect(execFile).toHaveBeenCalledWith('git', ['push', 'origin', 'hydraz/codex-v3'], expect.objectContaining({ cwd: '/workspace' }));
    expect(createPullRequestForBranch).toHaveBeenCalledOnce();
    expect(provider.destroyWorkspace).toHaveBeenCalledWith('/repo', makeWorkspace());
    expect(result).toMatchObject({
      action: 'destroyed',
      committed: true,
      pushed: true,
      prUrl: 'https://github.com/acme/repo/pull/1',
    });
  });

  it('skips the commit when the workspace is clean but still pushes', async () => {
    const execFile = vi.fn((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'status') return '';
      return '';
    }) as any;

    const result = await finalizeCodexDelivery({
      session: makeSession(),
      repoRoot: '/repo',
      workspace: makeWorkspace(),
      provider: makeProvider(),
      githubToken: 'ghp-test',
      createPullRequest: false,
      execFile,
    });

    expect(execFile).not.toHaveBeenCalledWith('git', ['commit', '-m', 'Hydraz Codex: codex-v3'], expect.anything());
    expect(execFile).toHaveBeenCalledWith('git', ['push', 'origin', 'hydraz/codex-v3'], expect.objectContaining({ cwd: '/workspace' }));
    expect(result.committed).toBe(false);
    expect(result.pushed).toBe(true);
  });

  it('preserves the workspace when PR delivery is requested without GitHub auth', async () => {
    const execFile = vi.fn((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'status') return '';
      return '';
    }) as any;
    const provider = makeProvider();

    const result = await finalizeCodexDelivery({
      session: makeSession(),
      repoRoot: '/repo',
      workspace: makeWorkspace(),
      provider,
      createPullRequest: true,
      execFile,
    });

    expect(provider.destroyWorkspace).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      action: 'preserved',
      pushed: true,
      error: 'GitHub token is required to create a pull request',
    });
  });

  it('preserves the workspace and skips PR creation when the branch has no commits ahead of base', async () => {
    const execFile = vi.fn((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'status') return '';
      return '';
    }) as any;
    const provider = makeProvider();
    const createPullRequestForBranch = vi.fn(async () => 'https://github.com/acme/repo/pull/1');

    const result = await finalizeCodexDelivery({
      session: makeSession(),
      repoRoot: '/repo',
      workspace: makeWorkspace(),
      provider,
      githubToken: 'ghp-test',
      createPullRequest: true,
      execFile,
      createPullRequestForBranch,
      compareBranchWithBase: vi.fn(async () => ({
        base: 'main',
        aheadBy: 0,
        totalCommits: 0,
      })),
    });

    expect(createPullRequestForBranch).not.toHaveBeenCalled();
    expect(provider.destroyWorkspace).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      action: 'preserved',
      pushed: true,
      error: 'No changes to deliver: branch hydraz/codex-v3 has no commits ahead of main',
    });
  });

  it('uses the configured base branch for compare and pull request creation', async () => {
    const execFile = vi.fn((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'status') return '';
      return '';
    }) as any;
    const provider = makeProvider();

    const result = await finalizeCodexDelivery({
      session: makeSession({ baseBranch: 'staging' }),
      repoRoot: '/repo',
      workspace: makeWorkspace(),
      provider,
      githubToken: 'ghp-test',
      createPullRequest: true,
      execFile,
    });

    expect(getGitHubDefaultBranch).not.toHaveBeenCalled();
    expect(compareGitHubBranches).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'octocat', repo: 'hello-world' }),
      'staging',
      'hydraz/codex-v3',
      'ghp-test',
    );
    expect(ensureGitHubPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'octocat', repo: 'hello-world' }),
      'ghp-test',
      expect.objectContaining({
        head: 'hydraz/codex-v3',
        base: 'staging',
      }),
    );
    expect(result.prUrl).toBe('https://github.com/octocat/hello-world/pull/12');
  });
});
