import { describe, it, expect } from 'vitest';
import {
  createDefaultConfig,
  validateConfig,
  ConfigValidationError,
} from './schema.js';

describe('createDefaultConfig', () => {
  it('defaults Hydraz v3 to cloud Codex execution', () => {
    const config = createDefaultConfig();
    expect(config.executionTarget).toBe('cloud');
    expect(config.branchNaming.prefix).toBe('hydraz/');
    expect(config.codex).toEqual({
      command: 'codex',
      sandbox: 'workspace-write',
      search: false,
    });
  });

  it('returns a fresh copy each time', () => {
    const a = createDefaultConfig();
    const b = createDefaultConfig();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
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

  it('preserves Codex overrides', () => {
    const result = validateConfig({
      codex: {
        command: '/opt/bin/codex',
        model: 'gpt-5.5',
        sandbox: 'danger-full-access',
        search: true,
      },
    });

    expect(result.codex).toEqual({
      command: '/opt/bin/codex',
      model: 'gpt-5.5',
      sandbox: 'danger-full-access',
      search: true,
    });
  });

  it('preserves github token when configured', () => {
    const result = validateConfig({
      github: { token: 'github_pat_test' },
    });
    expect(result.github.token).toBe('github_pat_test');
  });

  it('rejects non-object input', () => {
    expect(() => validateConfig('bad')).toThrow(ConfigValidationError);
    expect(() => validateConfig(null)).toThrow(ConfigValidationError);
    expect(() => validateConfig(42)).toThrow(ConfigValidationError);
  });

  it('rejects invalid executionTarget', () => {
    expect(() => validateConfig({ executionTarget: 'mars' })).toThrow(ConfigValidationError);
  });

  it('rejects invalid Codex sandbox', () => {
    expect(() => validateConfig({ codex: { sandbox: 'mars' } })).toThrow(ConfigValidationError);
  });

  it('rejects non-boolean Codex search', () => {
    expect(() => validateConfig({ codex: { search: 'yes' } })).toThrow(ConfigValidationError);
  });
});
