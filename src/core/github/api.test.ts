import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  compareGitHubBranches,
  ensureGitHubPullRequest,
  getGitHubDefaultBranch,
  githubBranchExists,
} from './api.js';

const repo = {
  remoteName: 'origin',
  remoteUrl: 'git@github.com:octocat/hello-world.git',
  owner: 'octocat',
  repo: 'hello-world',
  httpsUrl: 'https://github.com/octocat/hello-world.git',
};

describe('github api helpers', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the default branch from repo metadata', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      default_branch: 'main',
    }), { status: 200 }));

    await expect(getGitHubDefaultBranch(repo, 'token')).resolves.toBe('main');
  });

  it('returns true when the branch exists on GitHub', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 200 }));

    await expect(githubBranchExists(repo, 'hydraz/test', 'token')).resolves.toBe(true);
  });

  it('returns false when the branch does not exist on GitHub', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 404 }));

    await expect(githubBranchExists(repo, 'hydraz/test', 'token')).resolves.toBe(false);
  });

  it('compares base and head branches on GitHub', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      ahead_by: 2,
      total_commits: 2,
    }), { status: 200 }));

    await expect(compareGitHubBranches(repo, 'main', 'hydraz/test', 'token')).resolves.toEqual({
      aheadBy: 2,
      totalCommits: 2,
    });
  });

  it('creates a pull request and returns its URL', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      number: 12,
      html_url: 'https://github.com/octocat/hello-world/pull/12',
    }), { status: 201 }));

    await expect(ensureGitHubPullRequest(repo, 'token', {
      title: 'Title',
      body: 'Body',
      head: 'hydraz/test',
      base: 'main',
    })).resolves.toEqual({
      number: 12,
      url: 'https://github.com/octocat/hello-world/pull/12',
      existing: false,
    });
  });

  it('returns an existing PR when GitHub reports the PR already exists', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('{}', { status: 422 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        number: 12,
        html_url: 'https://github.com/octocat/hello-world/pull/12',
      }]), { status: 200 }));

    await expect(ensureGitHubPullRequest(repo, 'token', {
      title: 'Title',
      body: 'Body',
      head: 'hydraz/test',
      base: 'main',
    })).resolves.toEqual({
      number: 12,
      url: 'https://github.com/octocat/hello-world/pull/12',
      existing: true,
    });
  });

  it('includes GitHub validation details when PR creation fails with no existing PR', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        message: 'Validation Failed',
        errors: [
          { message: 'No commits between main and hydraz/test' },
        ],
      }), { status: 422 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

    await expect(ensureGitHubPullRequest(repo, 'token', {
      title: 'Title',
      body: 'Body',
      head: 'hydraz/test',
      base: 'main',
    })).rejects.toThrow('Failed to create GitHub pull request (422): Validation Failed: No commits between main and hydraz/test');
  });
});
