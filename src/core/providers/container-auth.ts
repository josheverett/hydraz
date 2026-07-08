import type { HydrazConfig } from '../config/schema.js';
import { buildGitHubGitEnv } from '../github/git-env.js';

export function prepareContainerAuthEnv(config: HydrazConfig): Record<string, string> {
  const env: Record<string, string> = {};

  if (config.github.token) {
    Object.assign(env, buildGitHubGitEnv(config.github.token));
    env['GH_TOKEN'] = config.github.token;
  }

  return env;
}
