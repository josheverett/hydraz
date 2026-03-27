import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../config/schema.js';
import { getGitHubAutomationReadiness } from './requirements.js';

vi.mock('../repo/detect.js', () => ({
  getGitHubRepo: vi.fn(),
}));

import { getGitHubRepo } from '../repo/detect.js';

const mockGetGitHubRepo = vi.mocked(getGitHubRepo);

beforeEach(() => {
  vi.resetAllMocks();
});

describe('getGitHubAutomationReadiness', () => {
  it('returns an error when the repo is not hosted on github.com', () => {
    mockGetGitHubRepo.mockReturnValue(null);
    const config = createDefaultConfig();
    config.github.token = 'github_pat_test';

    const result = getGitHubAutomationReadiness(config, '/fake/repo');

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/GitHub-only/i);
  });

  it('returns an error when GitHub auth is missing', () => {
    mockGetGitHubRepo.mockReturnValue({
      remoteName: 'origin',
      remoteUrl: 'git@github.com:octocat/hello-world.git',
      owner: 'octocat',
      repo: 'hello-world',
      httpsUrl: 'https://github.com/octocat/hello-world.git',
    });
    const config = createDefaultConfig();

    const result = getGitHubAutomationReadiness(config, '/fake/repo');

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/GitHub token/i);
  });

  it('returns repo metadata when GitHub automation is configured', () => {
    mockGetGitHubRepo.mockReturnValue({
      remoteName: 'origin',
      remoteUrl: 'git@github.com:octocat/hello-world.git',
      owner: 'octocat',
      repo: 'hello-world',
      httpsUrl: 'https://github.com/octocat/hello-world.git',
    });
    const config = createDefaultConfig();
    config.github.token = 'github_pat_test';

    const result = getGitHubAutomationReadiness(config, '/fake/repo');

    expect(result.ok).toBe(true);
    expect(result.repo?.owner).toBe('octocat');
  });
});
