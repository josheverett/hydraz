import type { SessionMetadata } from '../sessions/schema.js';
import type { HydrazConfig, ExecutionTarget } from '../config/schema.js';
import { getWorkspaceDir as resolveWorkspaceDir } from '../repo/paths.js';

export interface WorkspaceInfo {
  id: string;
  type: ExecutionTarget;
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
  readonly type: ExecutionTarget;
  createWorkspace(params: CreateWorkspaceParams): WorkspaceInfo;
  destroyWorkspace(repoRoot: string, workspace: WorkspaceInfo): void;
  checkAvailability(): ProviderCheckResult;
}

export function isContainerExecutionTarget(target: ExecutionTarget): boolean {
  return target === 'local-container' || target === 'cloud';
}

export function getWorkspaceDir(repoRoot: string, sessionId: string): string {
  return resolveWorkspaceDir(repoRoot, sessionId);
}
