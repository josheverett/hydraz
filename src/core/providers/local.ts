import { execFileSync } from 'node:child_process';
import type {
  WorkspaceProvider,
  WorkspaceInfo,
  CreateWorkspaceParams,
  ProviderCheckResult,
} from './provider.js';
import { createWorktree, destroyWorktree } from './worktree.js';

export class LocalProvider implements WorkspaceProvider {
  readonly type = 'local' as const;

  async createWorkspace(params: CreateWorkspaceParams): Promise<WorkspaceInfo> {
    const { session } = params;
    const worktree = createWorktree(session.repoRoot, session.id, session.branchName);

    return {
      id: session.id,
      type: 'local',
      directory: worktree.directory,
      branchName: worktree.branchName,
      sessionId: session.id,
    };
  }

  destroyWorkspace(repoRoot: string, workspace: WorkspaceInfo): void {
    destroyWorktree(repoRoot, workspace.directory);
  }

  checkAvailability(): ProviderCheckResult {
    try {
      execFileSync('git', ['--version'], { stdio: 'pipe' });
      return { available: true };
    } catch {
      return { available: false, error: 'git is not available on PATH' };
    }
  }
}
