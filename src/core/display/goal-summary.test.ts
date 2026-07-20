import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { formatGoalSummary } from './goal-summary.js';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

describe('formatGoalSummary', () => {
  it('preserves a concise inline goal', () => {
    expect(formatGoalSummary('Implement the focused fix')).toBe(
      'Implement the focused fix',
    );
  });

  it('summarizes a large inline goal without including its content', () => {
    const task = `TOP_SECRET_LARGE_GOAL${'x'.repeat(256 * 1024)}`;

    const summary = formatGoalSummary(task);

    expect(summary).toContain(`${Buffer.byteLength(task, 'utf8')} bytes`);
    expect(summary).toContain(`sha256:${sha256(task).slice(0, 12)}`);
    expect(summary).not.toContain('TOP_SECRET_LARGE_GOAL');
  });

  it('summarizes a file goal locally with its source label', () => {
    const task = 'TOP_SECRET_FILE_GOAL';

    const summary = formatGoalSummary(task, {
      kind: 'file',
      label: '/Users/josh/My Specs/goal.md',
      byteLength: Buffer.byteLength(task, 'utf8'),
      sha256: sha256(task),
    });

    expect(summary).toContain('file /Users/josh/My Specs/goal.md');
    expect(summary).toContain('20 bytes');
    expect(summary).not.toContain(task);
  });

  it('summarizes a stdin goal without including its content', () => {
    const task = 'TOP_SECRET_STDIN_GOAL';

    const summary = formatGoalSummary(task, {
      kind: 'stdin',
      byteLength: Buffer.byteLength(task, 'utf8'),
      sha256: sha256(task),
    });

    expect(summary).toContain('stdin');
    expect(summary).toContain('21 bytes');
    expect(summary).not.toContain(task);
  });

  it('omits a local file path from public summaries', () => {
    const task = 'TOP_SECRET_PUBLIC_GOAL';

    const summary = formatGoalSummary(task, {
      kind: 'file',
      label: '/Users/josh/private/goal.md',
      byteLength: Buffer.byteLength(task, 'utf8'),
      sha256: sha256(task),
    }, 'public');

    expect(summary).toContain('file-backed goal');
    expect(summary).not.toContain('/Users/josh');
    expect(summary).not.toContain(task);
  });

  it('treats legacy sessions without provenance as inline goals', () => {
    expect(formatGoalSummary('Legacy goal')).toBe('Legacy goal');
  });
});
