import { mkdtempSync, rmSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { writeAuthFile, AUTH_FILE_NAME } from './container-auth-file.js';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'hydraz-auth-file-test-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('writeAuthFile', () => {
  it('writes env vars as KEY=quoted-VALUE lines', () => {
    writeAuthFile(testDir, { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-test' });
    const content = readFileSync(join(testDir, AUTH_FILE_NAME), 'utf-8');
    expect(content).toBe("CLAUDE_CODE_OAUTH_TOKEN='sk-ant-oat01-test'\n");
  });

  it('writes multiple env vars on separate lines', () => {
    writeAuthFile(testDir, { VAR1: 'val1', VAR2: 'val2' });
    const content = readFileSync(join(testDir, AUTH_FILE_NAME), 'utf-8');
    expect(content).toContain("VAR1='val1'\n");
    expect(content).toContain("VAR2='val2'\n");
  });

  it('escapes values containing shell metacharacters', () => {
    writeAuthFile(testDir, { TOKEN: "val'ue$(whoami)" });
    const content = readFileSync(join(testDir, AUTH_FILE_NAME), 'utf-8');
    expect(content).toContain("TOKEN='val'\\''ue$(whoami)'");
  });

  it('creates the file with 0600 permissions', () => {
    writeAuthFile(testDir, { TOKEN: 'secret' });
    const stats = statSync(join(testDir, AUTH_FILE_NAME));
    const mode = (stats.mode & 0o777).toString(8);
    expect(mode).toBe('600');
  });

  it('does not write file when env is empty', () => {
    writeAuthFile(testDir, {});
    expect(existsSync(join(testDir, AUTH_FILE_NAME))).toBe(false);
  });

  it('overwrites existing auth file', () => {
    writeAuthFile(testDir, { OLD: 'value' });
    writeAuthFile(testDir, { NEW: 'value' });
    const content = readFileSync(join(testDir, AUTH_FILE_NAME), 'utf-8');
    expect(content).not.toContain('OLD');
    expect(content).toContain("NEW='value'");
  });
});

describe('cleanupAuthFile', () => {
  it('removes the auth file if it exists', async () => {
    const { cleanupAuthFile } = await import('./container-auth-file.js');
    writeAuthFile(testDir, { TOKEN: 'secret' });
    expect(existsSync(join(testDir, AUTH_FILE_NAME))).toBe(true);
    cleanupAuthFile(testDir);
    expect(existsSync(join(testDir, AUTH_FILE_NAME))).toBe(false);
  });

  it('does not throw if auth file does not exist', async () => {
    const { cleanupAuthFile } = await import('./container-auth-file.js');
    expect(() => cleanupAuthFile(testDir)).not.toThrow();
  });
});
