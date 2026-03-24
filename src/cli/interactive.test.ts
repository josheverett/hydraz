import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('interactive menu switch cases', () => {
  const source = readFileSync(resolve('src/cli/interactive.ts'), 'utf-8');

  it('config case does not contain stub message', () => {
    const configCase = extractCase(source, "'config'");
    expect(configCase).not.toContain('Run "hydraz config" directly');
    expect(configCase).not.toContain('not yet implemented');
  });

  it('attach case does not contain stub message', () => {
    const attachCase = extractCase(source, "'attach'");
    expect(attachCase).not.toContain('will be fully wired');
    expect(attachCase).not.toContain('not yet implemented');
  });

  it('review case does not contain stub message', () => {
    const reviewCase = extractCase(source, "'review'");
    expect(reviewCase).not.toContain('will be fully wired');
    expect(reviewCase).not.toContain('not yet implemented');
  });
});

function extractCase(source: string, caseLabel: string): string {
  const idx = source.indexOf(`case ${caseLabel}:`);
  if (idx === -1) return '';
  const afterCase = source.slice(idx);
  const nextBreak = afterCase.indexOf('break;');
  return afterCase.slice(0, nextBreak > 0 ? nextBreak : 200);
}
