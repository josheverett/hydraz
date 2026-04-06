import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type {
  WorkspaceProvider,
  WorkspaceInfo,
  CreateWorkspaceParams,
  ProviderCheckResult,
} from './provider.js';
import type { ExecutionTarget } from '../config/schema.js';
import {
  checkDevPodAvailability,
  checkDockerAvailability,
  hasDevcontainerJson,
  devpodUp,
  devpodDelete,
  verifyClaudeInContainer,
  createWorktreeInContainer,
  copyWorktreeIncludesInContainer,
} from './devpod.js';
import { listCopyableWorktreeIncludes } from './worktree-include.js';
import { getGitHubRepo, hasGitRemote } from '../repo/detect.js';

export class LocalContainerProvider implements WorkspaceProvider {
  readonly type: ExecutionTarget = 'local-container';

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
    const includeDestinationRoot = join(session.repoRoot, '.hydraz-container-worktree');

    if (!hasDevcontainerJson(session.repoRoot)) {
      throw new Error(
        'Container mode requires a .devcontainer/devcontainer.json in the target repo',
      );
    }

    if (!hasGitRemote(session.repoRoot)) {
      throw new Error(
        'Container mode requires a git remote. Work inside containers can only be delivered via push to a remote branch.',
      );
    }

    if (!params.config.github.token) {
      throw new Error('Container mode beta automation requires a GitHub token configured in `hydraz config`.');
    }

    if (!getGitHubRepo(session.repoRoot)) {
      throw new Error(
        'Container mode beta automation is currently GitHub-only. Configure `origin` to point at github.com and try again.',
      );
    }

    listCopyableWorktreeIncludes(session.repoRoot, includeDestinationRoot);

    const workspaceName = `hydraz-${session.id}`;

    try {
      devpodUp(session.repoRoot, workspaceName);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to launch DevPod workspace: ${message}`);
    }

    const claudeCheck = verifyClaudeInContainer(workspaceName);
    if (!claudeCheck.available) {
      devpodDelete(workspaceName);
      throw new Error(claudeCheck.error ?? 'Claude Code CLI is not available inside the container');
    }

    const containerRepoPath = `/workspaces/${workspaceName}`;
    let worktreePath: string;

    try {
      worktreePath = createWorktreeInContainer(
        workspaceName,
        containerRepoPath,
        session.branchName,
        session.id,
      );
      const safeIncludes = listCopyableWorktreeIncludes(session.repoRoot, includeDestinationRoot);
      copyWorktreeIncludesInContainer(workspaceName, containerRepoPath, worktreePath, safeIncludes);
    } catch (err) {
      devpodDelete(workspaceName);
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to set up worktree in container: ${message}`);
    }

    return {
      id: session.id,
      type: session.executionTarget,
      directory: worktreePath,
      branchName: session.branchName,
      sessionId: session.id,
    };
  }

  destroyWorkspace(_repoRoot: string, workspace: WorkspaceInfo): void {
    const workspaceName = `hydraz-${workspace.sessionId}`;

    try {
      devpodDelete(workspaceName);
    } catch {
      // DevPod workspace may already be gone
    }
  }
}
