import type { SessionMetadata } from '../sessions/schema.js';
import type { HydrazConfig } from '../config/schema.js';
import { getWorkspaceDir as resolveWorkspaceDir } from '../repo/paths.js';

export interface WorkspaceInfo {
  id: string;
  type: 'local' | 'cloud';
  directory: string;
  branchName: string;
  sessionId: string;
}

export interface CreateWorkspaceParams {
  session: SessionMetadata;
  config: HydrazConfig;
}

export interface ProviderCheckResult {
  available: boolean;
  error?: string;
}

export interface WorkspaceProvider {
  readonly type: 'local' | 'cloud';
  createWorkspace(params: CreateWorkspaceParams): WorkspaceInfo;
  destroyWorkspace(repoRoot: string, workspace: WorkspaceInfo): void;
  checkAvailability(): ProviderCheckResult;
}

export function getWorkspaceDir(repoRoot: string, sessionId: string): string {
  return resolveWorkspaceDir(repoRoot, sessionId);
}
