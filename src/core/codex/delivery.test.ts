import { describe, expect, it, vi } from 'vitest';
import { finalizeCodexDelivery } from './delivery.js';
import type { SessionMetadata } from '../sessions/schema.js';
import type { WorkspaceInfo, WorkspaceProvider } from '../providers/provider.js';

function makeSession(overrides: Partial<SessionMetadata> = {}): SessionMetadata {
  return {
    id: 'session-1',
    name: 'codex-v3',
    repoRoot: '/repo',
    branchName: 'hydraz/codex-v3',
    personas: ['architect', 'implementer', 'verifier'],
    executionTarget: 'cloud',
    task: 'Implement v3',
    state: 'delivering',
    createdAt: '2026-07-07T00:00:00.000Z',
    updatedAt: '2026-07-07T00:00:00.000Z',
    ...overrides,
  };
}

function makeWorkspace(): WorkspaceInfo {
  return {
    id: 'session-1',
    type: 'cloud',
    directory: '/workspace',
    branchName: 'hydraz/codex-v3',
    sessionId: 'session-1',
  };
}

function makeProvider() {
  return {
    type: 'cloud',
    createWorkspace: vi.fn(),
    checkAvailability: vi.fn(),
    destroyWorkspace: vi.fn(),
  } as unknown as WorkspaceProvider & { destroyWorkspace: ReturnType<typeof vi.fn> };
}

describe('finalizeCodexDelivery', () => {
  it('commits dirty changes, pushes, creates a PR, and destroys the workspace', async () => {
    const execFile = vi.fn((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'status') return ' M src/index.ts\n';
      return '';
    }) as any;
    const provider = makeProvider();
    const createPullRequestForBranch = vi.fn(async () => 'https://github.com/acme/repo/pull/1');

    const result = await finalizeCodexDelivery({
      session: makeSession(),
      repoRoot: '/repo',
      workspace: makeWorkspace(),
      provider,
      githubToken: 'ghp-test',
      createPullRequest: true,
      execFile,
      createPullRequestForBranch,
    });

    expect(execFile).toHaveBeenCalledWith('git', ['add', '-A'], expect.objectContaining({ cwd: '/workspace' }));
    expect(execFile).toHaveBeenCalledWith('git', ['commit', '-m', 'Hydraz Codex: codex-v3'], expect.objectContaining({ cwd: '/workspace' }));
    expect(execFile).toHaveBeenCalledWith('git', ['push', 'origin', 'hydraz/codex-v3'], expect.objectContaining({ cwd: '/workspace' }));
    expect(createPullRequestForBranch).toHaveBeenCalledOnce();
    expect(provider.destroyWorkspace).toHaveBeenCalledWith('/repo', makeWorkspace());
    expect(result).toMatchObject({
      action: 'destroyed',
      committed: true,
      pushed: true,
      prUrl: 'https://github.com/acme/repo/pull/1',
    });
  });

  it('skips the commit when the workspace is clean but still pushes', async () => {
    const execFile = vi.fn((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'status') return '';
      return '';
    }) as any;

    const result = await finalizeCodexDelivery({
      session: makeSession(),
      repoRoot: '/repo',
      workspace: makeWorkspace(),
      provider: makeProvider(),
      githubToken: 'ghp-test',
      createPullRequest: false,
      execFile,
    });

    expect(execFile).not.toHaveBeenCalledWith('git', ['commit', '-m', 'Hydraz Codex: codex-v3'], expect.anything());
    expect(execFile).toHaveBeenCalledWith('git', ['push', 'origin', 'hydraz/codex-v3'], expect.objectContaining({ cwd: '/workspace' }));
    expect(result.committed).toBe(false);
    expect(result.pushed).toBe(true);
  });

  it('preserves the workspace when PR delivery is requested without GitHub auth', async () => {
    const execFile = vi.fn((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'status') return '';
      return '';
    }) as any;
    const provider = makeProvider();

    const result = await finalizeCodexDelivery({
      session: makeSession(),
      repoRoot: '/repo',
      workspace: makeWorkspace(),
      provider,
      createPullRequest: true,
      execFile,
    });

    expect(provider.destroyWorkspace).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      action: 'preserved',
      pushed: true,
      error: 'GitHub token is required to create a pull request',
    });
  });
});
