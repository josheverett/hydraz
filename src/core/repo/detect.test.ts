import { describe, it, expect } from 'vitest';
import { detectRepo, hasGitRemote, parseGitHubRemoteUrl } from './detect.js';

describe('detectRepo', () => {
  it('detects the current repo from the repo root', () => {
    const result = detectRepo();
    expect(result).not.toBeNull();
    expect(result!.name).toBe('hydraz');
    expect(result!.root).toContain('hydraz');
  });

  it('detects the repo from a subdirectory', () => {
    const result = detectRepo(process.cwd() + '/src');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('hydraz');
  });

  it('returns null for the filesystem root', () => {
    const result = detectRepo('/');
    expect(result).toBeNull();
  });

  it('returns the directory name as the repo name', () => {
    const result = detectRepo();
    expect(result!.name).toBe('hydraz');
  });
});

describe('hasGitRemote', () => {
  it('returns true for a repo with a remote', () => {
    expect(hasGitRemote(process.cwd())).toBe(true);
  });

  it('returns false for a repo without a remote', () => {
    expect(hasGitRemote('/')).toBe(false);
  });
});

describe('parseGitHubRemoteUrl', () => {
  it('parses SSH scp-style GitHub remotes', () => {
    expect(parseGitHubRemoteUrl('git@github.com:octocat/hello-world.git')).toEqual({
      owner: 'octocat',
      repo: 'hello-world',
      httpsUrl: 'https://github.com/octocat/hello-world.git',
      remoteUrl: 'git@github.com:octocat/hello-world.git',
    });
  });

  it('parses HTTPS GitHub remotes', () => {
    expect(parseGitHubRemoteUrl('https://github.com/octocat/hello-world')).toEqual({
      owner: 'octocat',
      repo: 'hello-world',
      httpsUrl: 'https://github.com/octocat/hello-world.git',
      remoteUrl: 'https://github.com/octocat/hello-world',
    });
  });

  it('parses SSH URL GitHub remotes', () => {
    expect(parseGitHubRemoteUrl('ssh://git@github.com/octocat/hello-world.git')).toEqual({
      owner: 'octocat',
      repo: 'hello-world',
      httpsUrl: 'https://github.com/octocat/hello-world.git',
      remoteUrl: 'ssh://git@github.com/octocat/hello-world.git',
    });
  });

  it('returns null for non-GitHub remotes', () => {
    expect(parseGitHubRemoteUrl('git@gitlab.com:octocat/hello-world.git')).toBeNull();
  });

  it('returns null for malformed GitHub remotes', () => {
    expect(parseGitHubRemoteUrl('https://github.com/octocat')).toBeNull();
  });
});
