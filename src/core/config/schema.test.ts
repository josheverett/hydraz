import { describe, it, expect } from 'vitest';
import {
  createDefaultConfig,
  validateConfig,
  ConfigValidationError,
  BUILT_IN_PERSONAS,
  DEFAULT_SWARM,
} from './schema.js';

describe('BUILT_IN_PERSONAS', () => {
  it('contains exactly 6 personas', () => {
    expect(BUILT_IN_PERSONAS).toHaveLength(6);
  });

  it('includes the default swarm members', () => {
    for (const persona of DEFAULT_SWARM) {
      expect(BUILT_IN_PERSONAS).toContain(persona);
    }
  });
});

describe('DEFAULT_SWARM', () => {
  it('contains exactly 3 personas', () => {
    expect(DEFAULT_SWARM).toHaveLength(3);
  });
});

describe('createDefaultConfig', () => {
  it('returns a valid config object', () => {
    const config = createDefaultConfig();
    expect(config.version).toBe('1');
    expect(config.executionTarget).toBe('local');
    expect(config.defaultPersonas).toHaveLength(3);
    expect(config.branchNaming.prefix).toBe('hydraz/');
    expect(config.claudeAuth.mode).toBe('claude-ai-oauth');
  });

  it('returns a fresh copy each time', () => {
    const a = createDefaultConfig();
    const b = createDefaultConfig();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.defaultPersonas).not.toBe(b.defaultPersonas);
  });
});

describe('validateConfig', () => {
  it('accepts a valid full config', () => {
    const input = createDefaultConfig();
    const result = validateConfig(input);
    expect(result).toEqual(input);
  });

  it('fills in missing fields with defaults', () => {
    const result = validateConfig({});
    expect(result).toEqual(createDefaultConfig());
  });

  it('preserves valid overrides', () => {
    const result = validateConfig({
      executionTarget: 'cloud',
      claudeAuth: { mode: 'api-key' },
    });
    expect(result.executionTarget).toBe('cloud');
    expect(result.claudeAuth.mode).toBe('api-key');
  });

  it('preserves oauthToken in claudeAuth', () => {
    const result = validateConfig({
      claudeAuth: { mode: 'claude-ai-oauth', oauthToken: 'sk-ant-oat01-test' },
    });
    expect(result.claudeAuth.oauthToken).toBe('sk-ant-oat01-test');
  });

  it('preserves apiKey in claudeAuth', () => {
    const result = validateConfig({
      claudeAuth: { mode: 'api-key', apiKey: 'sk-ant-api-test' },
    });
    expect(result.claudeAuth.apiKey).toBe('sk-ant-api-test');
  });

  it('preserves github token when configured', () => {
    const result = validateConfig({
      github: { token: 'github_pat_test' },
    });
    expect(result.github.token).toBe('github_pat_test');
  });

  it('leaves oauthToken undefined when not provided', () => {
    const result = validateConfig({
      claudeAuth: { mode: 'claude-ai-oauth' },
    });
    expect(result.claudeAuth.oauthToken).toBeUndefined();
  });

  it('leaves github token undefined when not provided', () => {
    const result = validateConfig({});
    expect(result.github.token).toBeUndefined();
  });

  it('rejects non-object input', () => {
    expect(() => validateConfig('bad')).toThrow(ConfigValidationError);
    expect(() => validateConfig(null)).toThrow(ConfigValidationError);
    expect(() => validateConfig(42)).toThrow(ConfigValidationError);
  });

  it('rejects invalid executionTarget', () => {
    expect(() => validateConfig({ executionTarget: 'mars' })).toThrow(ConfigValidationError);
  });

  it('rejects invalid auth mode', () => {
    expect(() => validateConfig({ claudeAuth: { mode: 'magic' } })).toThrow(
      ConfigValidationError,
    );
  });

  it('rejects wrong-length persona arrays', () => {
    expect(() => validateConfig({ defaultPersonas: ['one', 'two'] })).toThrow(
      ConfigValidationError,
    );
    expect(() =>
      validateConfig({ defaultPersonas: ['one', 'two', 'three', 'four'] }),
    ).toThrow(ConfigValidationError);
  });

  it('rejects non-array persona values', () => {
    expect(() => validateConfig({ defaultPersonas: 'architect' })).toThrow(
      ConfigValidationError,
    );
  });

  it('rejects empty persona strings', () => {
    expect(() => validateConfig({ defaultPersonas: ['a', '', 'c'] })).toThrow(
      ConfigValidationError,
    );
  });

  it('rejects defaultPersonas that are not valid persona names', () => {
    expect(() =>
      validateConfig({ defaultPersonas: ['architect', 'BadName', 'verifier'] }),
    ).toThrow(ConfigValidationError);
    expect(() =>
      validateConfig({ defaultPersonas: ['architect', 'a', 'verifier'] }),
    ).toThrow(ConfigValidationError);
    expect(() =>
      validateConfig({ defaultPersonas: ['architect', 'foo/../bar', 'verifier'] }),
    ).toThrow(ConfigValidationError);
  });

  it('rejects non-string fields', () => {
    expect(() => validateConfig({ version: 42 })).toThrow(ConfigValidationError);
  });

  it('rejects non-boolean retention fields', () => {
    expect(() => validateConfig({ retention: { keepTranscripts: 'yes' } })).toThrow(
      ConfigValidationError,
    );
  });
});
