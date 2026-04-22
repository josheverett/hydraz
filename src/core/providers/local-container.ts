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
  checkDevcontainerPlatform,
  devpodUp,
  devpodDelete,
  verifyClaudeInContainer,
  createWorktreeInContainer,
  copyWorktreeIncludesInContainer,
  scpFilesToContainer,
} from './devpod.js';
import { listCopyableWorktreeIncludes } from './worktree-include.js';
import { getGitHubRepo, hasGitRemote, getCurrentBranch } from '../repo/detect.js';
import { debug } from '../debug.js';

export class LocalContainerProvider implements WorkspaceProvider {
  readonly type: ExecutionTarget = 'local-container';

  checkAvailability(): ProviderCheckResult {
    debug('checkAvailability: verifying git');
    try {
      execFileSync('git', ['--version'], { stdio: 'pipe' });
    } catch {
      debug('checkAvailability: git not found');
      return { available: false, error: 'git is not available on PATH' };
    }

    debug('checkAvailability: verifying devpod');
    const devpodCheck = checkDevPodAvailability();
    if (!devpodCheck.available) {
      debug(`checkAvailability: devpod not available — ${devpodCheck.error}`);
      return { available: false, error: devpodCheck.error };
    }
    debug(`checkAvailability: devpod ${devpodCheck.version}`);

    debug('checkAvailability: verifying docker');
    if (!checkDockerAvailability()) {
      debug('checkAvailability: docker not available');
      return { available: false, error: 'Docker is not running or not available on PATH' };
    }
    debug('checkAvailability: all prerequisites met');

    return { available: true };
  }

  async createWorkspace(params: CreateWorkspaceParams): Promise<WorkspaceInfo> {
    const { session } = params;
    const includeDestinationRoot = join(session.repoRoot, '.hydraz-container-worktree');
    debug(`createWorkspace: repoRoot=${session.repoRoot} executionTarget=${session.executionTarget}`);

    if (!hasDevcontainerJson(session.repoRoot)) {
      throw new Error(
        'Container mode requires a .devcontainer/devcontainer.json in the target repo',
      );
    }
    debug('createWorkspace: devcontainer.json found');

    const platformCheck = checkDevcontainerPlatform(session.repoRoot);
    if (!platformCheck.ok) {
      throw new Error(platformCheck.message ?? 'devcontainer.json platform mismatch');
    }

    if (!hasGitRemote(session.repoRoot)) {
      throw new Error(
        'Container mode requires a git remote. Work inside containers can only be delivered via push to a remote branch.',
      );
    }

    if (!params.config.github.token) {
      throw new Error('Container mode beta automation requires a GitHub token configured in `hydraz config`.');
    }

    const ghRepo = getGitHubRepo(session.repoRoot);
    if (!ghRepo) {
      throw new Error(
        'Container mode beta automation is currently GitHub-only. Configure `origin` to point at github.com and try again.',
      );
    }
    debug(`createWorkspace: github remote=${ghRepo.remoteUrl} (${ghRepo.owner}/${ghRepo.repo})`);

    const includes = listCopyableWorktreeIncludes(session.repoRoot, includeDestinationRoot);
    debug(`createWorkspace: worktree includes=[${includes.join(', ')}]`);

    const workspaceName = `hydraz-${session.id}`;
    debug(`createWorkspace: workspaceName=${workspaceName}`);
    const devpodProvider = this.type === 'local-container' ? 'docker' : undefined;
    const currentBranch = params.branchOverride ?? (this.type === 'local-container' ? getCurrentBranch(session.repoRoot) ?? undefined : undefined);
    debug(`createWorkspace: devpodUp source=${ghRepo.remoteUrl} provider=${devpodProvider ?? 'default'} branch=${currentBranch ?? 'default'}`);

    try {
      await devpodUp(ghRepo.remoteUrl, workspaceName, devpodProvider, currentBranch, params.onHeartbeat);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to launch DevPod workspace: ${message}`);
    }

    debug('createWorkspace: verifying Claude Code in container');
    const claudeCheck = verifyClaudeInContainer(workspaceName);
    if (!claudeCheck.available) {
      devpodDelete(workspaceName);
      throw new Error(claudeCheck.error ?? 'Claude Code CLI is not available inside the container');
    }
    debug(`createWorkspace: claude available — ${claudeCheck.version}`);

    const containerRepoPath = `/workspaces/${workspaceName}`;
    debug(`createWorkspace: containerRepoPath=${containerRepoPath}`);
    let worktreePath: string;

    try {
      worktreePath = createWorktreeInContainer(
        workspaceName,
        containerRepoPath,
        session.branchName,
        session.id,
      );
      debug(`createWorkspace: worktreePath=${worktreePath} branch=${session.branchName}`);
      const safeIncludes = listCopyableWorktreeIncludes(session.repoRoot, includeDestinationRoot);
      debug(`createWorkspace: copying ${safeIncludes.length} include files into worktree`);
      if (safeIncludes.length > 0) {
        scpFilesToContainer(workspaceName, session.repoRoot, containerRepoPath, safeIncludes);
      }
      copyWorktreeIncludesInContainer(workspaceName, containerRepoPath, worktreePath, safeIncludes);
    } catch (err) {
      devpodDelete(workspaceName);
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to set up worktree in container: ${message}`);
    }

    debug(`createWorkspace: complete — directory=${worktreePath}`);
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
    debug(`destroyWorkspace: deleting ${workspaceName}`);

    try {
      devpodDelete(workspaceName);
      debug('destroyWorkspace: deleted');
    } catch {
      debug('destroyWorkspace: workspace already gone');
    }
  }
}
