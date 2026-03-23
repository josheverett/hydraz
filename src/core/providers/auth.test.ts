import { describe, it, expect, vi, afterEach } from 'vitest';
import { prepareClaudeEnv, describeAuthMode, validateAuthAvailability } from './auth.js';
import { createDefaultConfig } from '../config/schema.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('prepareClaudeEnv', () => {
  it('returns empty env for oauth mode', () => {
    const config = createDefaultConfig();
    config.claudeAuth.mode = 'claude-ai-oauth';
    const env = prepareClaudeEnv(config);
    expect(Object.keys(env)).toHaveLength(0);
  });

  it('passes through ANTHROPIC_API_KEY for api-key mode when set', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test-123');
    const config = createDefaultConfig();
    config.claudeAuth.mode = 'api-key';
    const env = prepareClaudeEnv(config);
    expect(env['ANTHROPIC_API_KEY']).toBe('sk-test-123');
  });

  it('returns empty env for api-key mode when key is not set', () => {
    delete process.env['ANTHROPIC_API_KEY'];
    const config = createDefaultConfig();
    config.claudeAuth.mode = 'api-key';
    const env = prepareClaudeEnv(config);
    expect(env['ANTHROPIC_API_KEY']).toBeUndefined();
  });
});

describe('describeAuthMode', () => {
  it('describes oauth mode', () => {
    const config = createDefaultConfig();
    config.claudeAuth.mode = 'claude-ai-oauth';
    expect(describeAuthMode(config)).toContain('OAuth');
  });

  it('describes api-key mode', () => {
    const config = createDefaultConfig();
    config.claudeAuth.mode = 'api-key';
    expect(describeAuthMode(config)).toContain('API key');
  });
});

describe('validateAuthAvailability', () => {
  it('returns valid for oauth mode regardless of env', () => {
    const config = createDefaultConfig();
    config.claudeAuth.mode = 'claude-ai-oauth';
    const result = validateAuthAvailability(config);
    expect(result.valid).toBe(true);
  });

  it('returns valid for api-key mode when key is set', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test-123');
    const config = createDefaultConfig();
    config.claudeAuth.mode = 'api-key';
    const result = validateAuthAvailability(config);
    expect(result.valid).toBe(true);
  });

  it('returns invalid for api-key mode when key is missing', () => {
    delete process.env['ANTHROPIC_API_KEY'];
    const config = createDefaultConfig();
    config.claudeAuth.mode = 'api-key';
    const result = validateAuthAvailability(config);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('ANTHROPIC_API_KEY');
  });
});
