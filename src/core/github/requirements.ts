import type { HydrazConfig } from '../config/schema.js';
import { getGitHubRepo, type GitHubRepoInfo } from '../repo/detect.js';

export interface GitHubAutomationReadiness {
  ok: boolean;
  repo?: GitHubRepoInfo;
  error?: string;
}

export function getGitHubAutomationReadiness(
  config: HydrazConfig,
  repoRoot: string,
): GitHubAutomationReadiness {
  const repo = getGitHubRepo(repoRoot);
  if (!repo) {
    return {
      ok: false,
      error: 'Container mode beta automation is currently GitHub-only. Configure `origin` to point at github.com and try again.',
    };
  }

  if (!config.github.token) {
    return {
      ok: false,
      error: 'GitHub automation requires a GitHub token configured in `hydraz config`.',
    };
  }

  return {
    ok: true,
    repo,
  };
}
