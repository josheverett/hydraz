import { describe, it, expect } from 'vitest';
import { prepareContainerAuthEnv, validateContainerAuth } from './container-auth.js';
import { createDefaultConfig } from '../config/schema.js';

describe('prepareContainerAuthEnv', () => {
  it('returns CLAUDE_CODE_OAUTH_TOKEN when token is configured', () => {
    const config = createDefaultConfig();
    config.claudeAuth.mode = 'claude-ai-oauth';
    config.claudeAuth.oauthToken = 'sk-ant-oat01-test-token';
    const env = prepareContainerAuthEnv(config);
    expect(env['CLAUDE_CODE_OAUTH_TOKEN']).toBe('sk-ant-oat01-test-token');
  });

  it('returns empty env when no token is configured', () => {
    const config = createDefaultConfig();
    config.claudeAuth.mode = 'claude-ai-oauth';
    const env = prepareContainerAuthEnv(config);
    expect(Object.keys(env)).toHaveLength(0);
  });

  it('returns ANTHROPIC_API_KEY for api-key mode when set', () => {
    const config = createDefaultConfig();
    config.claudeAuth.mode = 'api-key';
    config.claudeAuth.apiKey = 'sk-ant-api-test';
    const env = prepareContainerAuthEnv(config);
    expect(env['ANTHROPIC_API_KEY']).toBe('sk-ant-api-test');
  });
});

describe('validateContainerAuth', () => {
  it('returns valid when oauth token is configured', () => {
    const config = createDefaultConfig();
    config.claudeAuth.mode = 'claude-ai-oauth';
    config.claudeAuth.oauthToken = 'sk-ant-oat01-test-token';
    const result = validateContainerAuth(config);
    expect(result.valid).toBe(true);
  });

  it('returns invalid when oauth mode but no token', () => {
    const config = createDefaultConfig();
    config.claudeAuth.mode = 'claude-ai-oauth';
    const result = validateContainerAuth(config);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('OAuth token');
  });

  it('returns valid for api-key mode when key is configured', () => {
    const config = createDefaultConfig();
    config.claudeAuth.mode = 'api-key';
    config.claudeAuth.apiKey = 'sk-ant-api-test';
    const result = validateContainerAuth(config);
    expect(result.valid).toBe(true);
  });

  it('returns invalid for api-key mode when key is missing', () => {
    const config = createDefaultConfig();
    config.claudeAuth.mode = 'api-key';
    const result = validateContainerAuth(config);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('API key');
  });
});
