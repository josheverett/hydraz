import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  getHydrazHome,
  repoHash,
  repoSlug,
  resolveRepoDataPaths,
  getSessionDir,
  getWorkspaceDir,
} from './paths.js';

describe('getHydrazHome', () => {
  it('returns ~/.hydraz', () => {
    expect(getHydrazHome()).toBe(join(homedir(), '.hydraz'));
  });
});

describe('repoHash', () => {
  it('returns a 12-character hex string', () => {
    const hash = repoHash('/Users/josh/workspace/myrepo');
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it('is deterministic for the same path', () => {
    expect(repoHash('/tmp/repo')).toBe(repoHash('/tmp/repo'));
  });

  it('differs for different paths', () => {
    expect(repoHash('/tmp/repo-a')).not.toBe(repoHash('/tmp/repo-b'));
  });

  it('normalizes paths', () => {
    expect(repoHash('/tmp/repo')).toBe(repoHash('/tmp/../tmp/repo'));
  });
});

describe('repoSlug', () => {
  it('combines repo name and hash', () => {
    const slug = repoSlug('/Users/josh/workspace/travelagent-ai');
    expect(slug).toMatch(/^travelagent-ai-[0-9a-f]{12}$/);
  });
});

describe('resolveRepoDataPaths', () => {
  it('puts sessions under ~/.hydraz/repos/<slug>/sessions', () => {
    const paths = resolveRepoDataPaths('/tmp/myrepo');
    expect(paths.sessionsDir).toContain('.hydraz/repos/');
    expect(paths.sessionsDir).toContain('myrepo-');
    expect(paths.sessionsDir.endsWith('/sessions')).toBe(true);
  });

  it('puts workspaces under ~/.hydraz/repos/<slug>/workspaces', () => {
    const paths = resolveRepoDataPaths('/tmp/myrepo');
    expect(paths.workspacesDir.endsWith('/workspaces')).toBe(true);
  });

  it('puts MCP config under the repo data dir', () => {
    const paths = resolveRepoDataPaths('/tmp/myrepo');
    expect(paths.repoMcpFile.endsWith('/mcp.json')).toBe(true);
  });
});

describe('getSessionDir', () => {
  it('resolves session dir under the repo data path', () => {
    const dir = getSessionDir('/tmp/myrepo', 'sess-123');
    expect(dir).toContain('myrepo-');
    expect(dir).toContain('sessions/sess-123');
  });

  it('rejects session ids that are not safe path segments', () => {
    expect(() => getSessionDir('/tmp/myrepo', '../escape')).toThrow();
  });
});

describe('getWorkspaceDir', () => {
  it('resolves workspace dir under the repo data path', () => {
    const dir = getWorkspaceDir('/tmp/myrepo', 'sess-456');
    expect(dir).toContain('myrepo-');
    expect(dir).toContain('workspaces/sess-456');
  });

  it('rejects workspace ids that are not safe path segments', () => {
    expect(() => getWorkspaceDir('/tmp/myrepo', '../../tmp/outside')).toThrow();
  });
});
