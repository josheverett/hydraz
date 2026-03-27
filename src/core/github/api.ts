import type { GitHubRepoInfo } from '../repo/detect.js';

interface GitHubRepoResponse {
  default_branch?: string;
}

interface GitHubPullRequestResponse {
  number?: number;
  html_url?: string;
}

export class GitHubApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

async function githubRequest(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'hydraz',
      ...(init?.headers ?? {}),
    },
  });
}

export async function getGitHubDefaultBranch(
  repo: GitHubRepoInfo,
  token: string,
): Promise<string> {
  const response = await githubRequest(`/repos/${repo.owner}/${repo.repo}`, token);
  if (!response.ok) {
    throw new GitHubApiError(`Failed to load GitHub repo metadata (${response.status})`);
  }

  const data = await response.json() as GitHubRepoResponse;
  if (!data.default_branch) {
    throw new GitHubApiError('GitHub repo metadata did not include a default branch');
  }
  return data.default_branch;
}

export async function githubBranchExists(
  repo: GitHubRepoInfo,
  branchName: string,
  token: string,
): Promise<boolean> {
  const response = await githubRequest(
    `/repos/${repo.owner}/${repo.repo}/branches/${encodeURIComponent(branchName)}`,
    token,
  );

  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw new GitHubApiError(`Failed to verify GitHub branch (${response.status})`);
  }
  return true;
}

export async function ensureGitHubPullRequest(
  repo: GitHubRepoInfo,
  token: string,
  input: { title: string; body: string; head: string; base: string },
): Promise<{ number: number; url: string; existing: boolean }> {
  const response = await githubRequest(`/repos/${repo.owner}/${repo.repo}/pulls`, token, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (response.ok) {
    const data = await response.json() as GitHubPullRequestResponse;
    if (!data.number || !data.html_url) {
      throw new GitHubApiError('GitHub pull request response was missing expected fields');
    }
    return { number: data.number, url: data.html_url, existing: false };
  }

  if (response.status === 422) {
    const params = new URLSearchParams({
      state: 'open',
      head: `${repo.owner}:${input.head}`,
    });
    const existingResponse = await githubRequest(
      `/repos/${repo.owner}/${repo.repo}/pulls?${params.toString()}`,
      token,
    );
    if (!existingResponse.ok) {
      throw new GitHubApiError(`Failed to look up existing pull request (${existingResponse.status})`);
    }

    const existing = await existingResponse.json() as GitHubPullRequestResponse[];
    const match = existing[0];
    if (match?.number && match?.html_url) {
      return { number: match.number, url: match.html_url, existing: true };
    }
  }

  throw new GitHubApiError(`Failed to create GitHub pull request (${response.status})`);
}
