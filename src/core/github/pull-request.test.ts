import { describe, expect, it } from 'vitest';
import { createSession, type GoalInputSource } from '../sessions/schema.js';
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

  it.each([
    {
      kind: 'file',
      task: 'TOP_SECRET_FILE_GOAL',
      taskSource: {
        kind: 'file',
        label: '/home/test-user/private/goal.md',
        byteLength: 20,
        sha256: 'file-sha',
      } as GoalInputSource,
      expectedSummary: 'file-backed goal',
      privateLabel: '/home/test-user/private',
    },
    {
      kind: 'stdin',
      task: 'TOP_SECRET_STDIN_GOAL',
      taskSource: {
        kind: 'stdin',
        byteLength: 21,
        sha256: 'stdin-sha',
      } as GoalInputSource,
      expectedSummary: 'stdin goal',
      privateLabel: undefined,
    },
  ])('summarizes short $kind goals in fallback pull request bodies', ({
    task,
    taskSource,
    expectedSummary,
    privateLabel,
  }) => {
    const session = createSession({
      name: 'private-goal',
      repoRoot: '/tmp/repo',
      branchName: 'hydraz/private-goal',
      executionTarget: 'cloud',
      task,
      taskSource,
    });

    const content = buildPullRequestContent(session, null);

    expect(content.body).toContain(expectedSummary);
    expect(content.body).not.toContain(task);
    if (privateLabel) expect(content.body).not.toContain(privateLabel);
    expect(content.body.length).toBeLessThan(1_000);
  });
});
