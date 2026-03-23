import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import type {
  WorkspaceProvider,
  WorkspaceInfo,
  CreateWorkspaceParams,
  ProviderCheckResult,
} from './provider.js';
import { getWorkspaceDir } from './provider.js';

export class LocalProvider implements WorkspaceProvider {
  readonly type = 'local' as const;

  createWorkspace(params: CreateWorkspaceParams): WorkspaceInfo {
    const { session } = params;
    const workDir = getWorkspaceDir(session.repoRoot, session.id);

    mkdirSync(workDir, { recursive: true });

    const branchExists = this.branchExists(session.repoRoot, session.branchName);

    try {
      if (branchExists) {
        execSync(`git worktree add "${workDir}" "${session.branchName}"`, {
          cwd: session.repoRoot,
          stdio: 'pipe',
        });
      } else {
        execSync(`git worktree add -b "${session.branchName}" "${workDir}"`, {
          cwd: session.repoRoot,
          stdio: 'pipe',
        });
      }
    } catch (err) {
      rmSync(workDir, { recursive: true, force: true });
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to create worktree: ${message}`);
    }

    return {
      id: session.id,
      type: 'local',
      directory: workDir,
      branchName: session.branchName,
      sessionId: session.id,
    };
  }

  destroyWorkspace(repoRoot: string, workspace: WorkspaceInfo): void {
    if (existsSync(workspace.directory)) {
      try {
        execSync(`git worktree remove "${workspace.directory}" --force`, {
          cwd: repoRoot,
          stdio: 'pipe',
        });
      } catch {
        rmSync(workspace.directory, { recursive: true, force: true });
      }
    }
  }

  checkAvailability(): ProviderCheckResult {
    try {
      execSync('git --version', { stdio: 'pipe' });
      return { available: true };
    } catch {
      return { available: false, error: 'git is not available on PATH' };
    }
  }

  private branchExists(repoRoot: string, branch: string): boolean {
    try {
      execSync(`git rev-parse --verify "${branch}"`, {
        cwd: repoRoot,
        stdio: 'pipe',
      });
      return true;
    } catch {
      return false;
    }
  }
}
