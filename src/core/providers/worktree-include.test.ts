import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import {
  parseWorktreeInclude,
  listCopyableWorktreeIncludes,
  copyWorktreeIncludes,
} from './worktree-include.js';

let repoRoot: string;
let worktreeDir: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'hydraz-wti-repo-'));
  worktreeDir = mkdtempSync(join(tmpdir(), 'hydraz-wti-worktree-'));
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
  rmSync(worktreeDir, { recursive: true, force: true });
  for (const dir of outsideDirectories.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('parseWorktreeInclude', () => {
  it('returns empty array when no .worktreeinclude file exists', () => {
    expect(parseWorktreeInclude(repoRoot)).toEqual([]);
  });

  it('parses file paths from .worktreeinclude', () => {
    writeFileSync(join(repoRoot, '.worktreeinclude'), 'agent/.env\nui/.env\n');
    const files = parseWorktreeInclude(repoRoot);
    expect(files).toEqual(['agent/.env', 'ui/.env']);
  });

  it('ignores comments and blank lines', () => {
    writeFileSync(
      join(repoRoot, '.worktreeinclude'),
      '# This is a comment\n\nagent/.env\n\n# Another comment\nui/.env\n',
    );
    const files = parseWorktreeInclude(repoRoot);
    expect(files).toEqual(['agent/.env', 'ui/.env']);
  });

  it('trims whitespace from lines', () => {
    writeFileSync(join(repoRoot, '.worktreeinclude'), '  agent/.env  \n  ui/.env  \n');
    const files = parseWorktreeInclude(repoRoot);
    expect(files).toEqual(['agent/.env', 'ui/.env']);
  });
});

describe('copyWorktreeIncludes', () => {
  it('lists safe, existing entries for a destination root', () => {
    mkdirSync(join(repoRoot, 'agent'), { recursive: true });
    writeFileSync(join(repoRoot, 'agent', '.env'), 'API_KEY=secret123');
    writeFileSync(
      join(repoRoot, '.worktreeinclude'),
      'agent/.env\nnonexistent/.env\n',
    );

    const files = listCopyableWorktreeIncludes(repoRoot, join(worktreeDir, 'placeholder'));
    expect(files).toEqual(['agent/.env']);
  });

  it('returns empty array when no .worktreeinclude exists', () => {
    expect(copyWorktreeIncludes(repoRoot, worktreeDir)).toEqual([]);
  });

  it('copies listed files that exist in the repo', () => {
    mkdirSync(join(repoRoot, 'agent'), { recursive: true });
    writeFileSync(join(repoRoot, 'agent', '.env'), 'API_KEY=secret123');
    writeFileSync(join(repoRoot, '.worktreeinclude'), 'agent/.env\n');

    const copied = copyWorktreeIncludes(repoRoot, worktreeDir);
    expect(copied).toEqual(['agent/.env']);
    expect(readFileSync(join(worktreeDir, 'agent', '.env'), 'utf-8')).toBe('API_KEY=secret123');
  });

  it('skips files that do not exist in the repo', () => {
    writeFileSync(join(repoRoot, '.worktreeinclude'), 'nonexistent/.env\n');
    const copied = copyWorktreeIncludes(repoRoot, worktreeDir);
    expect(copied).toEqual([]);
  });

  it('creates nested directories in the worktree as needed', () => {
    mkdirSync(join(repoRoot, 'deep', 'nested'), { recursive: true });
    writeFileSync(join(repoRoot, 'deep', 'nested', '.env'), 'DEEP=yes');
    writeFileSync(join(repoRoot, '.worktreeinclude'), 'deep/nested/.env\n');

    copyWorktreeIncludes(repoRoot, worktreeDir);
    expect(existsSync(join(worktreeDir, 'deep', 'nested', '.env'))).toBe(true);
  });

  it('copies multiple files', () => {
    mkdirSync(join(repoRoot, 'agent'), { recursive: true });
    mkdirSync(join(repoRoot, 'ui'), { recursive: true });
    writeFileSync(join(repoRoot, 'agent', '.env'), 'A=1');
    writeFileSync(join(repoRoot, 'ui', '.env'), 'B=2');
    writeFileSync(join(repoRoot, '.worktreeinclude'), 'agent/.env\nui/.env\n');

    const copied = copyWorktreeIncludes(repoRoot, worktreeDir);
    expect(copied).toHaveLength(2);
    expect(copied).toContain('agent/.env');
    expect(copied).toContain('ui/.env');
  });

  it('rejects entries that traverse outside the repo root', () => {
    writeFileSync(join(repoRoot, '.worktreeinclude'), '../../etc/passwd\n');
    expect(() => copyWorktreeIncludes(repoRoot, worktreeDir)).toThrow(/outside.*repository/i);
  });

  it('rejects absolute entries', () => {
    mkdirSync(join(repoRoot, 'legit'), { recursive: true });
    writeFileSync(join(repoRoot, 'legit', 'file'), 'ok');
    writeFileSync(join(repoRoot, '.worktreeinclude'), `${join(repoRoot, 'legit', 'file')}\n`);
    expect(() => copyWorktreeIncludes(repoRoot, worktreeDir)).toThrow(/absolute/i);
  });

  it('accepts valid entries with spaces, apostrophes, and a leading dash', () => {
    const entry = "-agent config/user's.env";
    mkdirSync(join(repoRoot, '-agent config'), { recursive: true });
    writeFileSync(join(repoRoot, entry), 'A=1');
    writeFileSync(join(repoRoot, '.worktreeinclude'), `${entry}\n`);

    expect(listCopyableWorktreeIncludes(repoRoot, worktreeDir)).toEqual([entry]);
  });

  it('continues skipping missing entries inside the repository', () => {
    writeFileSync(join(repoRoot, '.worktreeinclude'), 'missing config/.env\n');
    expect(listCopyableWorktreeIncludes(repoRoot, worktreeDir)).toEqual([]);
  });

  it('rejects a source that escapes through a symlinked ancestor', () => {
    if (process.platform === 'win32') return;

    const outside = makeOutsideDirectory();
    writeFileSync(join(outside, 'secret.env'), 'SECRET=yes');
    symlinkSync(outside, join(repoRoot, 'linked-directory'));
    writeFileSync(join(repoRoot, '.worktreeinclude'), 'linked-directory/secret.env\n');

    expect(() => listCopyableWorktreeIncludes(repoRoot, worktreeDir)).toThrow(/symlink.*outside.*repository/i);
  });

  it('rejects symlink entries even when they point inside the repo', () => {
    if (process.platform === 'win32') return;

    mkdirSync(join(repoRoot, 'agent'), { recursive: true });
    writeFileSync(join(repoRoot, 'agent', 'source.env'), 'A=1');
    symlinkSync(join(repoRoot, 'agent', 'source.env'), join(repoRoot, 'agent', '.env'));
    writeFileSync(join(repoRoot, '.worktreeinclude'), 'agent/.env\n');

    expect(() => listCopyableWorktreeIncludes(repoRoot, worktreeDir)).toThrow(/symlink/i);
    expect(() => copyWorktreeIncludes(repoRoot, worktreeDir)).toThrow(/symlink/i);
    expect(existsSync(join(worktreeDir, 'agent', '.env'))).toBe(false);
  });
});

function makeOutsideDirectory(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hydraz-wti-outside-'));
  outsideDirectories.push(dir);
  return dir;
}

const outsideDirectories: string[] = [];
