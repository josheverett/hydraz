import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { createWorktree, destroyWorktree } from './worktree.js';
import { resolveRepoDataPaths } from '../repo/paths.js';

let testRepo: string;

beforeEach(() => {
  testRepo = mkdtempSync(join(tmpdir(), 'hydraz-worktree-test-'));
  execSync('git init', { cwd: testRepo, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: testRepo, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: testRepo, stdio: 'pipe' });
  writeFileSync(join(testRepo, 'README.md'), '# test');
  execSync('git add . && git commit -m "init"', { cwd: testRepo, stdio: 'pipe' });
});

afterEach(() => {
  rmSync(testRepo, { recursive: true, force: true });
  rmSync(resolveRepoDataPaths(testRepo).repoDataDir, { recursive: true, force: true });
});

describe('createWorktree', () => {
  it('creates a worktree directory', () => {
    const result = createWorktree(testRepo, 'session-1', 'hydraz/test');
    expect(existsSync(result.directory)).toBe(true);
    expect(result.branchName).toBe('hydraz/test');
  });

  it('creates the branch in the repo', () => {
    createWorktree(testRepo, 'session-1', 'hydraz/new-branch');
    const branches = execSync('git branch', { cwd: testRepo, encoding: 'utf-8' });
    expect(branches).toContain('hydraz/new-branch');
  });

  it('worktree contains repo files', () => {
    const result = createWorktree(testRepo, 'session-1', 'hydraz/test');
    expect(existsSync(join(result.directory, 'README.md'))).toBe(true);
  });

  it('reuses an existing branch', () => {
    execSync('git branch hydraz/existing', { cwd: testRepo, stdio: 'pipe' });
    const result = createWorktree(testRepo, 'session-1', 'hydraz/existing');
    expect(existsSync(result.directory)).toBe(true);
  });

  it('copies .worktreeinclude files', () => {
    writeFileSync(join(testRepo, '.worktreeinclude'), '.env\n');
    writeFileSync(join(testRepo, '.env'), 'SECRET=123');
    execSync('git add .worktreeinclude && git commit -m "add include"', { cwd: testRepo, stdio: 'pipe' });

    const result = createWorktree(testRepo, 'session-1', 'hydraz/test');
    expect(existsSync(join(result.directory, '.env'))).toBe(true);
  });

  it('fails before creating a worktree when a listed entry is a symlink', () => {
    if (process.platform === 'win32') return;

    writeFileSync(join(testRepo, '.env.real'), 'SECRET=123');
    symlinkSync(join(testRepo, '.env.real'), join(testRepo, '.env'));
    writeFileSync(join(testRepo, '.worktreeinclude'), '.env\n');
    execSync('git add .worktreeinclude .env.real .env && git commit -m "add symlink include"', {
      cwd: testRepo,
      stdio: 'pipe',
    });

    const expectedDir = join(resolveRepoDataPaths(testRepo).workspacesDir, 'session-1');

    expect(() => createWorktree(testRepo, 'session-1', 'hydraz/test')).toThrow(/symlink/i);
    expect(existsSync(expectedDir)).toBe(false);
    expect(execSync('git worktree list --porcelain', { cwd: testRepo, encoding: 'utf-8' })).not.toContain(expectedDir);
  });

  it('throws on invalid repo root', () => {
    expect(() => createWorktree('/nonexistent', 'session-1', 'hydraz/test')).toThrow();
  });
});

describe('destroyWorktree', () => {
  it('removes the worktree directory', () => {
    const result = createWorktree(testRepo, 'session-1', 'hydraz/test');
    expect(existsSync(result.directory)).toBe(true);
    destroyWorktree(testRepo, result.directory);
    expect(existsSync(result.directory)).toBe(false);
  });

  it('does not throw for already-removed directory', () => {
    const result = createWorktree(testRepo, 'session-1', 'hydraz/test');
    destroyWorktree(testRepo, result.directory);
    expect(() => destroyWorktree(testRepo, result.directory)).not.toThrow();
  });

  it('does not throw for nonexistent directory', () => {
    expect(() => destroyWorktree(testRepo, '/nonexistent/path')).not.toThrow();
  });
});
