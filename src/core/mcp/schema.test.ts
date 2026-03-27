import { describe, it, expect } from 'vitest';
import {
  createDefaultMcpConfig,
  findServer,
  addServer,
  removeServer,
  toggleServer,
  validateMcpConfig,
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

describe('validateMcpConfig', () => {
  it('returns default for non-object input', () => {
    expect(validateMcpConfig(null).servers).toEqual([]);
    expect(validateMcpConfig('string').servers).toEqual([]);
    expect(validateMcpConfig(42).servers).toEqual([]);
    expect(validateMcpConfig([]).servers).toEqual([]);
  });

  it('returns default when servers is not an array', () => {
    expect(validateMcpConfig({ servers: 'not-an-array' }).servers).toEqual([]);
    expect(validateMcpConfig({}).servers).toEqual([]);
  });

  it('filters out entries with missing required fields', () => {
    const data = {
      servers: [
        { name: 'valid', command: 'cmd', enabled: true },
        { name: 'no-command', enabled: true },
        { command: 'no-name', enabled: true },
        { name: 'no-enabled', command: 'cmd' },
      ],
    };
    const config = validateMcpConfig(data);
    expect(config.servers).toHaveLength(1);
    expect(config.servers[0].name).toBe('valid');
  });

  it('preserves valid server entries with optional fields', () => {
    const data = {
      servers: [{
        name: 'full',
        command: 'npx',
        args: ['@mcp/server'],
        env: { API_KEY: 'abc' },
        enabled: true,
      }],
    };
    const config = validateMcpConfig(data);
    expect(config.servers).toHaveLength(1);
    expect(config.servers[0].args).toEqual(['@mcp/server']);
    expect(config.servers[0].env).toEqual({ API_KEY: 'abc' });
  });

  it('drops invalid optional fields without rejecting the entry', () => {
    const data = {
      servers: [{
        name: 'partial',
        command: 'cmd',
        args: 'not-an-array',
        env: 'not-an-object',
        enabled: false,
      }],
    };
    const config = validateMcpConfig(data);
    expect(config.servers).toHaveLength(1);
    expect(config.servers[0].args).toBeUndefined();
    expect(config.servers[0].env).toBeUndefined();
  });
});
