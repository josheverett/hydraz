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

  it('rejects non-string fields', () => {
    expect(() => validateConfig({ version: 42 })).toThrow(ConfigValidationError);
  });

  it('rejects non-boolean retention fields', () => {
    expect(() => validateConfig({ retention: { keepTranscripts: 'yes' } })).toThrow(
      ConfigValidationError,
    );
  });
});
