import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

describe('local provider security', () => {
  const source = readFileSync(resolve('src/core/providers/local.ts'), 'utf-8');

  it('does not use execSync (vulnerable to shell injection)', () => {
    expect(source).not.toContain('execSync');
  });

  it('uses execFileSync for safe argument passing', () => {
    expect(source).toContain('execFileSync');
  });
});
