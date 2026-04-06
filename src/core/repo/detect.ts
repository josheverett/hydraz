import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';

export interface RepoInfo {
  root: string;
  name: string;
}

export interface GitHubRepoInfo {
  owner: string;
  repo: string;
  remoteUrl: string;
  httpsUrl: string;
  remoteName: string;
}

export function detectRepo(cwd?: string): RepoInfo | null {
  let dir = resolve(cwd ?? process.cwd());

  while (true) {
    if (existsSync(resolve(dir, '.git'))) {
      return {
        root: dir,
        name: basename(dir),
      };
    }

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

export function hasGitRemote(repoRoot: string): boolean {
  try {
    const output = execFileSync('git', ['remote'], {
      cwd: repoRoot,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

export function getGitRemoteUrl(repoRoot: string, remoteName: string = 'origin'): string | null {
  try {
    const output = execFileSync('git', ['remote', 'get-url', remoteName], {
      cwd: repoRoot,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    const url = output.trim();
    return url.length > 0 ? url : null;
  } catch {
    return null;
  }
}

export function parseGitHubRemoteUrl(remoteUrl: string): Omit<GitHubRepoInfo, 'remoteName'> | null {
  const trimmed = remoteUrl.trim();
  const patterns = [
    /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/,
    /^ssh:\/\/git@github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/,
    /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (!match) continue;

    const [, owner, repo] = match;
    return {
      owner,
      repo,
      remoteUrl: trimmed,
      httpsUrl: `https://github.com/${owner}/${repo}.git`,
    };
  }

  return null;
}

export function getGitHubRepo(
  repoRoot: string,
  remoteName: string = 'origin',
): GitHubRepoInfo | null {
  const remoteUrl = getGitRemoteUrl(repoRoot, remoteName);
  if (!remoteUrl) return null;

  const parsed = parseGitHubRemoteUrl(remoteUrl);
  if (!parsed) return null;

  return {
    remoteName,
    ...parsed,
  };
}
