import { describe, it, expect } from 'vitest';
import { parseClaudeVersion } from './claude.js';

describe('parseClaudeVersion', () => {
  it('extracts a semver version from output', () => {
    expect(parseClaudeVersion('claude 1.2.3')).toBe('1.2.3');
  });

  it('extracts version from multiline output', () => {
    expect(parseClaudeVersion('Claude Code CLI\nVersion: 1.0.15\n')).toBe('1.0.15');
  });

  it('extracts version when surrounded by text', () => {
    expect(parseClaudeVersion('v0.9.1-beta')).toBe('0.9.1');
  });

  it('returns null when no version is found', () => {
    expect(parseClaudeVersion('no version here')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseClaudeVersion('')).toBeNull();
  });
});
