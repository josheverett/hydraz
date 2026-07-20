import { createHash } from 'node:crypto';
import type { GoalInputSource } from '../sessions/index.js';

export type GoalSummaryAudience = 'local' | 'public';
const INLINE_PREVIEW_MAX_BYTES = 200;

export function formatGoalSummary(
  task: string,
  source?: GoalInputSource,
  audience: GoalSummaryAudience = 'local',
): string {
  const byteLength = Buffer.byteLength(task, 'utf8');
  const sha256 = createHash('sha256').update(task, 'utf8').digest('hex');
  const sourceKind = source?.kind ?? 'inline';

  if (sourceKind === 'inline' && byteLength <= INLINE_PREVIEW_MAX_BYTES) {
    return task.replace(/\s+/g, ' ').trim();
  }

  const details = `${byteLength} bytes, sha256:${sha256.slice(0, 12)}`;
  if (source?.kind === 'file') {
    const label = audience === 'public'
      ? 'file-backed goal'
      : `file ${source.label}`;
    return `${label} (${details})`;
  }
  if (source?.kind === 'stdin') {
    return `stdin goal (${details})`;
  }
  return `inline goal (${details})`;
}
