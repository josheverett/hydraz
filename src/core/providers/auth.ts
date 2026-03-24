import type { HydrazConfig } from '../config/schema.js';

export interface ClaudeEnvVars {
  [key: string]: string | undefined;
}

export function prepareClaudeEnv(config: HydrazConfig): ClaudeEnvVars {
  const env: ClaudeEnvVars = {};

  if (config.claudeAuth.mode === 'api-key') {
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (apiKey) {
      env['ANTHROPIC_API_KEY'] = apiKey;
    }
  }

  return env;
}

export function describeAuthMode(config: HydrazConfig): string {
  switch (config.claudeAuth.mode) {
    case 'claude-ai-oauth':
      return 'Claude.ai subscription (OAuth)';
    case 'api-key':
      return 'API key';
    default:
      return 'unknown';
  }
}

export function validateAuthAvailability(config: HydrazConfig): {
  valid: boolean;
  error?: string;
} {
  if (config.claudeAuth.mode === 'api-key') {
    if (!process.env['ANTHROPIC_API_KEY']) {
      return {
        valid: false,
        error: 'ANTHROPIC_API_KEY environment variable is not set.',
      };
    }
  }

  return { valid: true };
}
