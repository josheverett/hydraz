import type {
  WorkspaceProvider,
  WorkspaceInfo,
  CreateWorkspaceParams,
  ProviderCheckResult,
} from './provider.js';

export class CloudProvider implements WorkspaceProvider {
  readonly type = 'cloud' as const;

  createWorkspace(_params: CreateWorkspaceParams): WorkspaceInfo {
    throw new Error('Cloud provider is not yet implemented in v1.');
  }

  destroyWorkspace(_repoRoot: string, _workspace: WorkspaceInfo): void {
    throw new Error('Cloud provider is not yet implemented in v1.');
  }

  checkAvailability(): ProviderCheckResult {
    return {
      available: false,
      error: 'Cloud provider is not yet implemented in v1. Use local execution.',
    };
  }
}
