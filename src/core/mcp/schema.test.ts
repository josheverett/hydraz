import { describe, it, expect } from 'vitest';
import {
  createDefaultMcpConfig,
  findServer,
  addServer,
  removeServer,
  toggleServer,
  McpError,
} from './schema.js';

describe('createDefaultMcpConfig', () => {
  it('starts with empty servers array', () => {
    expect(createDefaultMcpConfig().servers).toEqual([]);
  });
});

describe('addServer', () => {
  it('adds a server to the config', () => {
    const config = createDefaultMcpConfig();
    const updated = addServer(config, {
      name: 'github',
      command: 'npx',
      args: ['@modelcontextprotocol/server-github'],
      enabled: true,
    });
    expect(updated.servers).toHaveLength(1);
    expect(updated.servers[0].name).toBe('github');
  });

  it('rejects duplicate names', () => {
    const config = addServer(createDefaultMcpConfig(), {
      name: 'github',
      command: 'npx',
      enabled: true,
    });
    expect(() =>
      addServer(config, { name: 'github', command: 'other', enabled: true }),
    ).toThrow(McpError);
  });

  it('does not mutate the original config', () => {
    const original = createDefaultMcpConfig();
    addServer(original, { name: 'test', command: 'cmd', enabled: true });
    expect(original.servers).toHaveLength(0);
  });
});

describe('removeServer', () => {
  it('removes a server by name', () => {
    let config = addServer(createDefaultMcpConfig(), {
      name: 'github',
      command: 'npx',
      enabled: true,
    });
    config = removeServer(config, 'github');
    expect(config.servers).toHaveLength(0);
  });

  it('throws for non-existent server', () => {
    expect(() => removeServer(createDefaultMcpConfig(), 'ghost')).toThrow(McpError);
  });
});

describe('toggleServer', () => {
  it('disables an enabled server', () => {
    let config = addServer(createDefaultMcpConfig(), {
      name: 'github',
      command: 'npx',
      enabled: true,
    });
    config = toggleServer(config, 'github', false);
    expect(findServer(config, 'github')?.enabled).toBe(false);
  });

  it('enables a disabled server', () => {
    let config = addServer(createDefaultMcpConfig(), {
      name: 'github',
      command: 'npx',
      enabled: false,
    });
    config = toggleServer(config, 'github', true);
    expect(findServer(config, 'github')?.enabled).toBe(true);
  });

  it('throws for non-existent server', () => {
    expect(() => toggleServer(createDefaultMcpConfig(), 'ghost', true)).toThrow(McpError);
  });
});

describe('findServer', () => {
  it('finds an existing server', () => {
    const config = addServer(createDefaultMcpConfig(), {
      name: 'linear',
      command: 'npx',
      enabled: true,
    });
    expect(findServer(config, 'linear')).toBeDefined();
  });

  it('returns undefined for missing server', () => {
    expect(findServer(createDefaultMcpConfig(), 'nope')).toBeUndefined();
  });
});
