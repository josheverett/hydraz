export interface McpServer {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

export interface McpConfig {
  servers: McpServer[];
}

export function createDefaultMcpConfig(): McpConfig {
  return { servers: [] };
}

export function findServer(config: McpConfig, name: string): McpServer | undefined {
  return config.servers.find((s) => s.name === name);
}

export function addServer(config: McpConfig, server: McpServer): McpConfig {
  if (findServer(config, server.name)) {
    throw new McpError(`MCP server "${server.name}" already exists`);
  }
  return { servers: [...config.servers, server] };
}

export function removeServer(config: McpConfig, name: string): McpConfig {
  if (!findServer(config, name)) {
    throw new McpError(`MCP server "${name}" not found`);
  }
  return { servers: config.servers.filter((s) => s.name !== name) };
}

export function toggleServer(config: McpConfig, name: string, enabled: boolean): McpConfig {
  const server = findServer(config, name);
  if (!server) {
    throw new McpError(`MCP server "${name}" not found`);
  }
  return {
    servers: config.servers.map((s) =>
      s.name === name ? { ...s, enabled } : s,
    ),
  };
}

export class McpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpError';
  }
}
