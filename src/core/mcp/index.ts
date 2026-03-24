export {
  type McpServer,
  type McpConfig,
  createDefaultMcpConfig,
  findServer,
  addServer,
  removeServer,
  toggleServer,
  McpError,
} from './schema.js';
export {
  loadGlobalMcpConfig,
  saveGlobalMcpConfig,
  loadRepoMcpConfig,
  saveRepoMcpConfig,
  mergeScopes,
  getEffectiveServers,
} from './manager.js';
