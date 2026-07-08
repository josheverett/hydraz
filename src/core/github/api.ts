import type { GitHubRepoInfo } from '../repo/detect.js';

interface GitHubRepoResponse {
  default_branch?: string;
}

interface GitHubUserResponse {
  id?: number;
  login?: string;
}

export interface GitHubGitIdentity {
  name: string;
  email: string;
}

interface GitHubPullRequestResponse {
  number?: number;
  html_url?: string;
}

interface GitHubCompareResponse {
  ahead_by?: number;
  total_commits?: number;
}

interface GitHubErrorResponse {
  message?: string;
  errors?: Array<{ message?: string } | string>;
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

export async function getGitHubAuthenticatedUserIdentity(token: string): Promise<GitHubGitIdentity> {
  const response = await githubRequest('/user', token);
  if (!response.ok) {
    throw new GitHubApiError(`Failed to load GitHub authenticated user (${response.status})`);
  }

  const data = await response.json() as GitHubUserResponse;
  if (typeof data.id !== 'number' || !data.login) {
    throw new GitHubApiError('GitHub authenticated user response did not include id and login');
  }

  return {
    name: data.login,
    email: `${data.id}+${data.login}@users.noreply.github.com`,
  };
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

export async function compareGitHubBranches(
  repo: GitHubRepoInfo,
  base: string,
  head: string,
  token: string,
): Promise<{ aheadBy: number; totalCommits: number }> {
  const response = await githubRequest(
    `/repos/${repo.owner}/${repo.repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
    token,
  );

  if (!response.ok) {
    throw new GitHubApiError(`Failed to compare GitHub branches (${response.status})`);
  }

  const data = await response.json() as GitHubCompareResponse;
  return {
    aheadBy: typeof data.ahead_by === 'number' ? data.ahead_by : 0,
    totalCommits: typeof data.total_commits === 'number' ? data.total_commits : 0,
  };
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

  const errorDetail = await githubErrorDetail(response);

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

  const detail = errorDetail ? `: ${errorDetail}` : '';
  throw new GitHubApiError(`Failed to create GitHub pull request (${response.status})${detail}`);
}

async function githubErrorDetail(response: Response): Promise<string | null> {
  let data: GitHubErrorResponse;
  try {
    data = await response.json() as GitHubErrorResponse;
  } catch {
    return null;
  }

  const parts = [
    typeof data.message === 'string' ? data.message : undefined,
    ...(Array.isArray(data.errors)
      ? data.errors.map((error) => {
          if (typeof error === 'string') return error;
          return typeof error.message === 'string' ? error.message : undefined;
        })
      : []),
  ].filter((part): part is string => !!part?.trim());

  if (parts.length === 0) return null;
  return parts.join(': ');
}
