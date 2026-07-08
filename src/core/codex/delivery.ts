import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import type { SessionMetadata } from '../sessions/schema.js';
import type { WorkspaceInfo, WorkspaceProvider } from '../providers/provider.js';
import { getGitHubRepo } from '../repo/detect.js';
import { buildPullRequestContent } from '../github/pull-request.js';
import {
  compareGitHubBranches,
  ensureGitHubPullRequest,
  getGitHubDefaultBranch,
  type GitHubGitIdentity,
} from '../github/api.js';

export interface CodexDeliveryResult {
  action: 'destroyed' | 'preserved';
  committed: boolean;
  pushed: boolean;
  prUrl?: string;
  error?: string;
  message: string;
}

export interface CodexDeliveryOptions {
  session: SessionMetadata;
  repoRoot: string;
  workspace: WorkspaceInfo;
  provider: WorkspaceProvider;
  githubToken?: string;
  gitIdentity?: GitHubGitIdentity;
  createPullRequest: boolean;
  keepWorkspace?: boolean;
  execFile?: typeof execFileSync;
  createPullRequestForBranch?: (input: {
    repoRoot: string;
    session: SessionMetadata;
    token: string;
  }) => Promise<string>;
  compareBranchWithBase?: (input: {
    repoRoot: string;
    session: SessionMetadata;
    token: string;
  }) => Promise<{ base: string; aheadBy: number; totalCommits: number }>;
}

export async function finalizeCodexDelivery(options: CodexDeliveryOptions): Promise<CodexDeliveryResult> {
  const execFile = options.execFile ?? execFileSync;
  const gitEnv = buildGitIdentityEnv(options.gitIdentity);
  const gitExecOptions = (): ExecFileSyncOptions => ({
    cwd: options.workspace.directory,
    stdio: 'pipe',
    ...gitEnv,
  });
  let committed = false;
  let pushed = false;

  try {
    const statusOptions: ExecFileSyncOptions = {
      ...gitExecOptions(),
      encoding: 'utf-8',
    };
    const status = execFile('git', ['status', '--porcelain'], statusOptions) as unknown as string;

    if (status.trim().length > 0) {
      execFile('git', ['add', '-A'], gitExecOptions());
      execFile('git', ['commit', '-m', `Hydraz Codex: ${options.session.name}`], gitExecOptions());
      committed = true;
    }

    execFile('git', ['push', 'origin', options.session.branchName], gitExecOptions());
    pushed = true;
  } catch (err) {
    return preserve(committed, pushed, err instanceof Error ? err.message : String(err));
  }

  let prUrl: string | undefined;
  if (options.createPullRequest) {
    if (!options.githubToken) {
      return preserve(committed, pushed, 'GitHub token is required to create a pull request');
    }

    try {
      const comparison = options.compareBranchWithBase
        ? await options.compareBranchWithBase({
            repoRoot: options.repoRoot,
            session: options.session,
            token: options.githubToken,
          })
        : await compareDefaultBranch(options.repoRoot, options.session, options.githubToken);
      if (comparison.aheadBy === 0 || comparison.totalCommits === 0) {
        return preserve(
          committed,
          pushed,
          `No changes to deliver: branch ${options.session.branchName} has no commits ahead of ${comparison.base}`,
        );
      }

      prUrl = options.createPullRequestForBranch
        ? await options.createPullRequestForBranch({
            repoRoot: options.repoRoot,
            session: options.session,
            token: options.githubToken,
          })
        : await createDefaultPullRequest(options.repoRoot, options.session, options.githubToken);
    } catch (err) {
      return preserve(committed, pushed, err instanceof Error ? err.message : String(err));
    }
  }

  if (options.keepWorkspace) {
    return {
      action: 'preserved',
      committed,
      pushed,
      prUrl,
      message: prUrl
        ? `Workspace preserved after push and PR delivery: ${prUrl}`
        : 'Workspace preserved after push',
    };
  }

  options.provider.destroyWorkspace(options.repoRoot, options.workspace);
  return {
    action: 'destroyed',
    committed,
    pushed,
    prUrl,
    message: prUrl
      ? `Workspace cleaned up after push and PR delivery: ${prUrl}`
      : 'Workspace cleaned up after push',
  };
}

async function createDefaultPullRequest(
  repoRoot: string,
  session: SessionMetadata,
  token: string,
): Promise<string> {
  const repo = getGitHubRepo(repoRoot);
  if (!repo) {
    throw new Error('GitHub remote is required to create a pull request');
  }

  const base = await getGitHubDefaultBranch(repo, token);
  const pr = buildPullRequestContent(session, null);
  const created = await ensureGitHubPullRequest(repo, token, {
    title: pr.title,
    body: pr.body,
    head: session.branchName,
    base,
  });
  return created.url;
}

async function compareDefaultBranch(
  repoRoot: string,
  session: SessionMetadata,
  token: string,
): Promise<{ base: string; aheadBy: number; totalCommits: number }> {
  const repo = getGitHubRepo(repoRoot);
  if (!repo) {
    throw new Error('GitHub remote is required to create a pull request');
  }

  const base = await getGitHubDefaultBranch(repo, token);
  const comparison = await compareGitHubBranches(repo, base, session.branchName, token);
  return { base, ...comparison };
}

function preserve(committed: boolean, pushed: boolean, error: string): CodexDeliveryResult {
  return {
    action: 'preserved',
    committed,
    pushed,
    error,
    message: `Workspace preserved: ${error}`,
  };
}

function buildGitIdentityEnv(identity?: GitHubGitIdentity): { env?: NodeJS.ProcessEnv } {
  if (!identity) return {};

  return {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: identity.name,
      GIT_AUTHOR_EMAIL: identity.email,
      GIT_COMMITTER_NAME: identity.name,
      GIT_COMMITTER_EMAIL: identity.email,
    },
  };
}
