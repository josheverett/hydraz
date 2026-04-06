import { describe, expect, it } from 'vitest';
import { createSession } from '../sessions/schema.js';
import { buildPullRequestContent } from './pull-request.js';

function makeSession() {
  return createSession({
    name: 'auth-cleanup',
    repoRoot: '/tmp/repo',
    branchName: 'hydraz/auth-cleanup',
    personas: ['architect', 'implementer', 'verifier'],
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
});
