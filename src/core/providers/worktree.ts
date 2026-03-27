import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { copyWorktreeIncludes, listCopyableWorktreeIncludes } from './worktree-include.js';
import { getWorkspaceDir } from './provider.js';

export interface WorktreeResult {
  directory: string;
  branchName: string;
}

export function createWorktree(
  repoRoot: string,
  sessionId: string,
  branchName: string,
): WorktreeResult {
  const workDir = getWorkspaceDir(repoRoot, sessionId);
  listCopyableWorktreeIncludes(repoRoot, workDir);
  mkdirSync(workDir, { recursive: true });

  const branchExists = gitBranchExists(repoRoot, branchName);

  try {
    if (branchExists) {
      execFileSync('git', ['worktree', 'add', workDir, branchName], {
        cwd: repoRoot,
        stdio: 'pipe',
      });
    } else {
      execFileSync('git', ['worktree', 'add', '-b', branchName, workDir], {
        cwd: repoRoot,
        stdio: 'pipe',
      });
    }
  } catch (err) {
    rmSync(workDir, { recursive: true, force: true });
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to create worktree: ${message}`);
  }

  copyWorktreeIncludes(repoRoot, workDir);

  return { directory: workDir, branchName };
}

export function destroyWorktree(repoRoot: string, directory: string): void {
  if (!existsSync(directory)) return;

  try {
    execFileSync('git', ['worktree', 'remove', directory, '--force'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
  } catch {
    rmSync(directory, { recursive: true, force: true });
  }
}

function gitBranchExists(repoRoot: string, branch: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--verify', branch], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}
