import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

describe('checkClaudeAvailability security', () => {
  const source = readFileSync(resolve('src/core/config/claude.ts'), 'utf-8');

  it('does not use execSync (vulnerable to shell injection)', () => {
    expect(source).not.toContain('execSync');
  });

  it('uses execFileSync for safe argument passing', () => {
    expect(source).toContain('execFileSync');
  });
});
