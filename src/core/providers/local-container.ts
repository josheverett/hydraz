import { execFileSync } from 'node:child_process';
import type {
  WorkspaceProvider,
  WorkspaceInfo,
  CreateWorkspaceParams,
  ProviderCheckResult,
} from './provider.js';
import { createWorktree, destroyWorktree } from './worktree.js';
import {
  checkDevPodAvailability,
  checkDockerAvailability,
  hasDevcontainerJson,
  devpodUp,
  devpodDelete,
} from './devpod.js';

export class LocalContainerProvider implements WorkspaceProvider {
  readonly type = 'local-container' as const;

  checkAvailability(): ProviderCheckResult {
    try {
      execFileSync('git', ['--version'], { stdio: 'pipe' });
    } catch {
      return { available: false, error: 'git is not available on PATH' };
    }

    const devpodCheck = checkDevPodAvailability();
    if (!devpodCheck.available) {
      return { available: false, error: devpodCheck.error };
    }

    if (!checkDockerAvailability()) {
      return { available: false, error: 'Docker is not running or not available on PATH' };
    }

    return { available: true };
  }

  createWorkspace(params: CreateWorkspaceParams): WorkspaceInfo {
    const { session } = params;

    if (!hasDevcontainerJson(session.repoRoot)) {
      throw new Error(
        'Container mode requires a .devcontainer/devcontainer.json in the target repo',
      );
    }

    const worktree = createWorktree(session.repoRoot, session.id, session.branchName);
    const workspaceName = `hydraz-${session.id}`;

    try {
      devpodUp(worktree.directory, workspaceName);
    } catch (err) {
      destroyWorktree(session.repoRoot, worktree.directory);
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to launch DevPod workspace: ${message}`);
    }

    return {
      id: session.id,
      type: 'local-container',
      directory: worktree.directory,
      branchName: worktree.branchName,
      sessionId: session.id,
    };
  }

  destroyWorkspace(repoRoot: string, workspace: WorkspaceInfo): void {
    const workspaceName = `hydraz-${workspace.sessionId}`;

    try {
      devpodDelete(workspaceName);
    } catch {
      // DevPod workspace may already be gone; proceed to worktree cleanup
    }

    destroyWorktree(repoRoot, workspace.directory);
  }
}
