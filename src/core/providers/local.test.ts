import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { LocalProvider } from './local.js';
import { createSession } from '../sessions/schema.js';
import { createDefaultConfig } from '../config/schema.js';
import { resolveRepoDataPaths } from '../repo/paths.js';

let testRepo: string;
let provider: LocalProvider;

beforeEach(() => {
  testRepo = mkdtempSync(join(tmpdir(), 'hydraz-provider-test-'));
  execSync('git init', { cwd: testRepo, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: testRepo, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: testRepo, stdio: 'pipe' });
  writeFileSync(join(testRepo, 'README.md'), '# test');
  execSync('git add . && git commit -m "init"', { cwd: testRepo, stdio: 'pipe' });
  provider = new LocalProvider();
});

afterEach(() => {
  rmSync(testRepo, { recursive: true, force: true });
  rmSync(resolveRepoDataPaths(testRepo).repoDataDir, { recursive: true, force: true });
});

function makeSession(name: string = 'test-session') {
  return createSession({
    name,
    repoRoot: testRepo,
    branchName: `hydraz/${name}`,
    personas: ['architect', 'implementer', 'verifier'],
    executionTarget: 'local',
    task: 'Fix it',
  });
}

describe('LocalProvider', () => {
  it('has type "local"', () => {
    expect(provider.type).toBe('local');
  });

  describe('checkAvailability', () => {
    it('reports git as available', () => {
      const result = provider.checkAvailability();
      expect(result.available).toBe(true);
    });
  });

  describe('createWorkspace', () => {
    it('creates a worktree directory', async () => {
      const session = makeSession();
      const config = createDefaultConfig();
      const workspace = await provider.createWorkspace({ session, config });

      expect(existsSync(workspace.directory)).toBe(true);
      expect(workspace.type).toBe('local');
      expect(workspace.sessionId).toBe(session.id);
      expect(workspace.branchName).toBe(session.branchName);
    });

    it('creates the session branch', async () => {
      const session = makeSession();
      const config = createDefaultConfig();
      await provider.createWorkspace({ session, config });

      const branches = execSync('git branch', { cwd: testRepo, encoding: 'utf-8' });
      expect(branches).toContain('hydraz/test-session');
    });

    it('worktree contains repo files', async () => {
      const session = makeSession();
      const config = createDefaultConfig();
      const workspace = await provider.createWorkspace({ session, config });

      expect(existsSync(join(workspace.directory, 'README.md'))).toBe(true);
    });
  });

  describe('destroyWorkspace', () => {
    it('removes the worktree directory', async () => {
      const session = makeSession();
      const config = createDefaultConfig();
      const workspace = await provider.createWorkspace({ session, config });

      expect(existsSync(workspace.directory)).toBe(true);
      provider.destroyWorkspace(testRepo, workspace);
      expect(existsSync(workspace.directory)).toBe(false);
    });

    it('does not throw for already-removed workspace', async () => {
      const session = makeSession();
      const config = createDefaultConfig();
      const workspace = await provider.createWorkspace({ session, config });
      provider.destroyWorkspace(testRepo, workspace);

      expect(() => provider.destroyWorkspace(testRepo, workspace)).not.toThrow();
    });
  });
});
