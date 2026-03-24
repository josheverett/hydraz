import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { resolveConfigPaths } from './paths.js';

describe('resolveConfigPaths', () => {
  it('uses ~/.config/hydraz by default', () => {
    const paths = resolveConfigPaths();
    expect(paths.configDir).toBe(join(homedir(), '.config', 'hydraz'));
  });

  it('uses the override directory when provided', () => {
    const paths = resolveConfigPaths('/tmp/test-config');
    expect(paths.configDir).toBe('/tmp/test-config');
  });

  it('resolves config.json inside the config directory', () => {
    const paths = resolveConfigPaths('/tmp/test');
    expect(paths.configFile).toBe('/tmp/test/config.json');
  });

  it('resolves master-prompt.md inside the config directory', () => {
    const paths = resolveConfigPaths('/tmp/test');
    expect(paths.masterPromptFile).toBe('/tmp/test/master-prompt.md');
  });

  it('resolves personas directory inside the config directory', () => {
    const paths = resolveConfigPaths('/tmp/test');
    expect(paths.personasDir).toBe('/tmp/test/personas');
  });

  it('resolves mcp servers file inside mcp directory', () => {
    const paths = resolveConfigPaths('/tmp/test');
    expect(paths.mcpServersFile).toBe('/tmp/test/mcp/servers.json');
  });
});
