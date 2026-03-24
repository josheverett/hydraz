export {
  type WorkspaceInfo,
  type WorkspaceProvider,
  type CreateWorkspaceParams,
  type ProviderCheckResult,
  getWorkspaceDir,
} from './provider.js';
export { LocalProvider } from './local.js';
export { CloudProvider } from './cloud.js';
export {
  type ClaudeEnvVars,
  prepareClaudeEnv,
  describeAuthMode,
  validateAuthAvailability,
} from './auth.js';
export { parseWorktreeInclude, copyWorktreeIncludes } from './worktree-include.js';
