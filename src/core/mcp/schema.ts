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

export function validateMcpConfig(data: unknown): McpConfig {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return createDefaultMcpConfig();
  }
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj['servers'])) {
    return createDefaultMcpConfig();
  }

  const servers: McpServer[] = [];
  for (const entry of obj['servers']) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      continue;
    }
    const s = entry as Record<string, unknown>;
    if (typeof s['name'] !== 'string' || s['name'].length === 0) continue;
    if (typeof s['command'] !== 'string' || s['command'].length === 0) continue;
    if (typeof s['enabled'] !== 'boolean') continue;

    const server: McpServer = {
      name: s['name'],
      command: s['command'],
      enabled: s['enabled'],
    };

    if (Array.isArray(s['args']) && s['args'].every((a: unknown) => typeof a === 'string')) {
      server.args = s['args'] as string[];
    }

    if (
      typeof s['env'] === 'object' && s['env'] !== null && !Array.isArray(s['env']) &&
      Object.values(s['env'] as Record<string, unknown>).every((v) => typeof v === 'string')
    ) {
      server.env = s['env'] as Record<string, string>;
    }

    servers.push(server);
  }

  return { servers };
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
