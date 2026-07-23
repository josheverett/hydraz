import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type {
  WorkspaceProvider,
  WorkspaceInfo,
  CreateWorkspaceParams,
  ProviderCheckResult,
} from './provider.js';
import type { ExecutionTarget } from '../config/schema.js';
import { DEFAULT_CLOUD_MAX_RUNTIME } from '../sessions/schema.js';
import {
  checkDevPodAvailability,
  checkDockerAvailability,
  hasDevcontainerJson,
  checkDevcontainerPlatform,
  devpodUp,
  devpodDelete,
  verifyCodexInContainer,
  createWorktreeInContainer,
  configureGitIdentityInContainer,
  copyWorktreeIncludesInContainer,
  scpFilesToContainer,
  getContainerRepoPath,
  composeProjectName,
  removeComposeProjectVolumes,
} from './devpod.js';
import { listCopyableWorktreeIncludes } from './worktree-include.js';
import { prepareContainerAuthEnv } from './container-auth.js';
import { getGitHubRepo, hasGitRemote, getCurrentBranch } from '../repo/detect.js';
import { debug } from '../debug.js';
import { getGitHubAuthenticatedUserIdentity } from '../github/api.js';

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
    debug(`createWorkspace: repoRoot=${session.repoRoot} executionTarget=${session.executionTarget} skipClone=${!!params.skipClone}`);

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

    let devpodSource: string;

    if (params.skipClone) {
      devpodSource = session.repoRoot;
      debug(`createWorkspace: skipClone — using local path ${devpodSource}`);
    } else {
      if (!hasGitRemote(session.repoRoot)) {
        throw new Error(
          'Container mode requires a git remote. Work inside containers can only be delivered via push to a remote branch.',
        );
      }

      const ghRepo = getGitHubRepo(session.repoRoot);
      if (!ghRepo) {
        throw new Error(
          'Container mode beta automation is currently GitHub-only. Configure `origin` to point at github.com and try again.',
        );
      }
      debug(`createWorkspace: github remote=${ghRepo.remoteUrl} (${ghRepo.owner}/${ghRepo.repo})`);
      devpodSource = ghRepo.remoteUrl;
    }

    const includes = params.skipClone ? [] : listCopyableWorktreeIncludes(session.repoRoot, includeDestinationRoot);
    debug(`createWorkspace: worktree includes=[${includes.join(', ')}]`);

    const workspaceName = `hydraz-${session.id}`;
    debug(`createWorkspace: workspaceName=${workspaceName}`);
    const devpodProvider = this.type === 'local-container' ? 'docker' : undefined;
    const currentBranch = params.skipClone
      ? undefined
      : params.branchOverride ?? (this.type === 'local-container' ? getCurrentBranch(session.repoRoot) ?? undefined : undefined);
    debug(`createWorkspace: devpodUp source=${devpodSource} provider=${devpodProvider ?? 'default'} branch=${currentBranch ?? 'none'}`);
    let gitIdentity = params.gitIdentity;
    if (!params.skipClone) {
      if (!gitIdentity && params.config.github.token) {
        try {
          gitIdentity = await getGitHubAuthenticatedUserIdentity(params.config.github.token);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`Failed to load managed git identity: ${message}`);
        }
      }
      if (!gitIdentity) {
        throw new Error('GitHub token is required to configure managed git identity');
      }
    }

    try {
      const authEnv = prepareContainerAuthEnv(params.config, gitIdentity);
      await devpodUp(devpodSource, workspaceName, {
        provider: devpodProvider,
        branch: currentBranch,
        onHeartbeat: params.onHeartbeat,
        env: authEnv,
        providerOptions: this.type === 'cloud'
          ? { INACTIVITY_TIMEOUT: params.maxRuntime ?? session.maxRuntime ?? DEFAULT_CLOUD_MAX_RUNTIME }
          : undefined,
        processEnv: this.type === 'local-container'
          ? { COMPOSE_PROJECT_NAME: composeProjectName(workspaceName) }
          : undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to launch DevPod workspace: ${message}`);
    }

    debug('createWorkspace: verifying Codex CLI in container');
    const codexCheck = verifyCodexInContainer(workspaceName);
    if (!codexCheck.available) {
      devpodDelete(workspaceName);
      throw new Error(codexCheck.error ?? 'Codex CLI is not available inside the container');
    }
    debug(`createWorkspace: codex available — ${codexCheck.version}`);

    let containerRepoPath: string;
    try {
      containerRepoPath = getContainerRepoPath(workspaceName);
    } catch (err) {
      devpodDelete(workspaceName);
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to resolve container repository root: ${message}`);
    }
    debug(`createWorkspace: containerRepoPath=${containerRepoPath}`);

    if (params.skipClone) {
      debug(`createWorkspace: complete (skipClone) — directory=${containerRepoPath}`);
      return {
        id: session.id,
        type: session.executionTarget,
        directory: containerRepoPath,
        branchName: session.branchName,
        sessionId: session.id,
        gitIdentity,
      };
    }

    let worktreePath: string;

    try {
      worktreePath = createWorktreeInContainer(
        workspaceName,
        containerRepoPath,
        session.branchName,
        session.id,
      );
      debug(`createWorkspace: worktreePath=${worktreePath} branch=${session.branchName}`);
      if (gitIdentity) {
        configureGitIdentityInContainer(workspaceName, worktreePath, gitIdentity);
      }
      const safeIncludes = listCopyableWorktreeIncludes(session.repoRoot, includeDestinationRoot);
      debug(`createWorkspace: copying ${safeIncludes.length} include files into worktree`);
      if (safeIncludes.length > 0) {
        await scpFilesToContainer(workspaceName, session.repoRoot, containerRepoPath, safeIncludes);
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
      gitIdentity,
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

    if (workspace.type === 'local-container') {
      removeComposeProjectVolumes(composeProjectName(workspaceName));
    }
  }
}
