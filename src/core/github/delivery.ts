import type { SessionMetadata } from '../sessions/schema.js';
import type { WorkspaceInfo, WorkspaceProvider } from '../providers/provider.js';
import { loadArtifact } from '../sessions/artifacts.js';
import { getGitHubRepo } from '../repo/detect.js';
import { buildPullRequestContent } from './pull-request.js';
import {
  ensureGitHubPullRequest,
  getGitHubDefaultBranch,
  githubBranchExists,
} from './api.js';

export interface GitHubDeliveryResult {
  action: 'destroyed' | 'preserved';
  message: string;
  prUrl?: string;
}

export async function finalizeGitHubContainerDelivery(params: {
  session: SessionMetadata;
  workspace: WorkspaceInfo;
  repoRoot: string;
  provider: WorkspaceProvider;
  token: string;
  createPullRequest: boolean;
}): Promise<GitHubDeliveryResult> {
  const repo = getGitHubRepo(params.repoRoot);
  if (!repo) {
    return {
      action: 'preserved',
      message: 'Workspace preserved: automated delivery only supports github.com remotes in beta.',
    };
  }

  const pushed = await githubBranchExists(repo, params.session.branchName, params.token);
  if (!pushed) {
    return {
      action: 'preserved',
      message: `Branch "${params.session.branchName}" was not found on GitHub. Workspace preserved for recovery.`,
    };
  }

  let prUrl: string | undefined;
  if (params.createPullRequest) {
    const base = await getGitHubDefaultBranch(repo, params.token);
    const prDraft = loadArtifact(params.repoRoot, params.session.id, 'pr-draft.md');
    const pr = buildPullRequestContent(params.session, prDraft);
    const created = await ensureGitHubPullRequest(repo, params.token, {
      title: pr.title,
      body: pr.body,
      head: params.session.branchName,
      base,
    });
    prUrl = created.url;
  }

  params.provider.destroyWorkspace(params.repoRoot, params.workspace);
  return {
    action: 'destroyed',
    message: prUrl
      ? `Workspace cleaned up after verified push and PR delivery: ${prUrl}`
      : 'Workspace cleaned up after verified push',
    prUrl,
  };
}
