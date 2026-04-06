import type { HydrazConfig } from '../config/schema.js';
import { buildGitHubGitEnv } from '../github/git-env.js';

export function prepareContainerAuthEnv(config: HydrazConfig): Record<string, string> {
  const env: Record<string, string> = {};

  if (config.claudeAuth.mode === 'claude-ai-oauth' && config.claudeAuth.oauthToken) {
    env['CLAUDE_CODE_OAUTH_TOKEN'] = config.claudeAuth.oauthToken;
  }

  if (config.claudeAuth.mode === 'api-key' && config.claudeAuth.apiKey) {
    env['ANTHROPIC_API_KEY'] = config.claudeAuth.apiKey;
  }

  if (config.github.token) {
    Object.assign(env, buildGitHubGitEnv(config.github.token));
  }

  return env;
}

export function validateContainerAuth(config: HydrazConfig): {
  valid: boolean;
  error?: string;
} {
  if (config.claudeAuth.mode === 'claude-ai-oauth') {
    if (!config.claudeAuth.oauthToken) {
      return {
        valid: false,
        error: 'Container mode requires an OAuth token. Run `claude setup-token` then configure via `hydraz config`.',
      };
    }
  }

  if (config.claudeAuth.mode === 'api-key') {
    if (!config.claudeAuth.apiKey) {
      return {
        valid: false,
        error: 'Container mode requires an API key configured in `hydraz config`.',
      };
    }
  }

  return { valid: true };
}
