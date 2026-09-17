import { describe, expect, it } from 'vitest';
import { createSession } from '../sessions/schema.js';
import { buildPullRequestContent } from './pull-request.js';

function makeSession() {
  return createSession({
    name: 'auth-cleanup',
    repoRoot: '/tmp/repo',
    branchName: 'hydraz/auth-cleanup',
    executionTarget: 'local-container',
    task: 'Switch container delivery to GitHub HTTPS auth',
  });
}

describe('buildPullRequestContent', () => {
  it('uses the first markdown heading as the title when present', () => {
    const session = makeSession();
    const content = buildPullRequestContent(session, '# My PR title\n\nBody text');
    expect(content.title).toBe('My PR title');
    expect(content.body).toContain('Body text');
  });

  it('falls back to a Hydraz title when the draft has no heading', () => {
    const session = makeSession();
    const content = buildPullRequestContent(session, 'Plain body text');
    expect(content.title).toBe('Hydraz: auth-cleanup');
    expect(content.body).toBe('Plain body text');
  });

  it('falls back to a generated title and body when no draft exists', () => {
    const session = makeSession();
    const content = buildPullRequestContent(session, null);
    expect(content.title).toBe('Hydraz: auth-cleanup');
    expect(content.body).toContain('Switch container delivery to GitHub HTTPS auth');
  });

  it('bounds file-backed goals in fallback pull request bodies', () => {
    const task = `TOP_SECRET_PULL_REQUEST_GOAL${'x'.repeat(256 * 1024)}`;
    const session = createSession({
      name: 'large-goal',
      repoRoot: '/tmp/repo',
      branchName: 'hydraz/large-goal',
      executionTarget: 'cloud',
      task,
      taskSource: {
        kind: 'file',
        label: '/home/test-user/private/goal.md',
        byteLength: Buffer.byteLength(task, 'utf8'),
        sha256: 'public-sha',
      },
    });

    const content = buildPullRequestContent(session, null);

    expect(content.body).toContain('file-backed goal');
    expect(content.body).not.toContain('TOP_SECRET_PULL_REQUEST_GOAL');
    expect(content.body).not.toContain('/home/test-user/private');
    expect(content.body.length).toBeLessThan(1_000);
  });
});
