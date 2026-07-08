import type { HydrazConfig } from '../config/schema.js';
import type { GitHubGitIdentity } from '../github/api.js';
import { buildGitHubGitEnv } from '../github/git-env.js';

export function prepareContainerAuthEnv(
  config: HydrazConfig,
  identity?: GitHubGitIdentity,
): Record<string, string> {
  const env: Record<string, string> = {};

  if (config.github.token) {
    Object.assign(env, buildGitHubGitEnv(config.github.token));
    env['GH_TOKEN'] = config.github.token;
  }

  if (identity) {
    env['GIT_AUTHOR_NAME'] = identity.name;
    env['GIT_AUTHOR_EMAIL'] = identity.email;
    env['GIT_COMMITTER_NAME'] = identity.name;
    env['GIT_COMMITTER_EMAIL'] = identity.email;
  }

  return env;
}
