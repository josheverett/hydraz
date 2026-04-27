import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadRepoConfig, readRepoPromptContent, expandTilde, processHydrazIncludes, type ScpFunction } from './repo-config.js';

let repoRoot: string;

afterEach(() => {
  if (repoRoot) {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

function setupRepoRoot(): string {
  repoRoot = mkdtempSync(join(tmpdir(), 'hydraz-repo-config-test-'));
  return repoRoot;
}

function writeHydrazConfig(root: string, content: string): void {
  const dir = join(root, '.hydraz');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), content, 'utf-8');
}

function writeHydrazPrompt(root: string, content: string): void {
  const dir = join(root, '.hydraz');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'HYDRAZ.md'), content, 'utf-8');
}

describe('loadRepoConfig', () => {
  it('should return parsed config when .hydraz/config.json exists with valid content', () => {
    const root = setupRepoRoot();
    writeHydrazConfig(root, JSON.stringify({
      hydrazincludes: [
        { host: '~/.aigl', container: '~/.aigl' },
      ],
    }));

    const config = loadRepoConfig(root);

    expect(config).not.toBeNull();
    expect(config!.hydrazincludes).toHaveLength(1);
    expect(config!.hydrazincludes![0]).toEqual({ host: '~/.aigl', container: '~/.aigl' });
  });

  it('should return null when .hydraz/config.json does not exist', () => {
    const root = setupRepoRoot();

    const config = loadRepoConfig(root);

    expect(config).toBeNull();
  });

  it('should return null when .hydraz directory does not exist', () => {
    const root = setupRepoRoot();

    const config = loadRepoConfig(root);

    expect(config).toBeNull();
  });

  it('should return null when config.json contains malformed JSON', () => {
    const root = setupRepoRoot();
    writeHydrazConfig(root, '{ not valid json !!!');

    const config = loadRepoConfig(root);

    expect(config).toBeNull();
  });

  it('should return config with empty hydrazincludes array', () => {
    const root = setupRepoRoot();
    writeHydrazConfig(root, JSON.stringify({ hydrazincludes: [] }));

    const config = loadRepoConfig(root);

    expect(config).not.toBeNull();
    expect(config!.hydrazincludes).toEqual([]);
  });

  it('should return config when hydrazincludes key is absent', () => {
    const root = setupRepoRoot();
    writeHydrazConfig(root, JSON.stringify({}));

    const config = loadRepoConfig(root);

    expect(config).not.toBeNull();
    expect(config!.hydrazincludes).toBeUndefined();
  });

  it('should return null when hydrazincludes is not an array', () => {
    const root = setupRepoRoot();
    writeHydrazConfig(root, JSON.stringify({ hydrazincludes: 'not-an-array' }));

    const config = loadRepoConfig(root);

    expect(config).toBeNull();
  });

  it('should return null when hydrazincludes entries lack required fields', () => {
    const root = setupRepoRoot();
    writeHydrazConfig(root, JSON.stringify({
      hydrazincludes: [{ host: '~/.aigl' }],
    }));

    const config = loadRepoConfig(root);

    expect(config).toBeNull();
  });

  it('should handle multiple hydrazincludes entries', () => {
    const root = setupRepoRoot();
    writeHydrazConfig(root, JSON.stringify({
      hydrazincludes: [
        { host: '~/.aigl', container: '~/.aigl' },
        { host: '~/.config/special', container: '/opt/special' },
      ],
    }));

    const config = loadRepoConfig(root);

    expect(config).not.toBeNull();
    expect(config!.hydrazincludes).toHaveLength(2);
    expect(config!.hydrazincludes![1]).toEqual({ host: '~/.config/special', container: '/opt/special' });
  });
});

describe('readRepoPromptContent', () => {
  it('should return file content when .hydraz/HYDRAZ.md exists', () => {
    const root = setupRepoRoot();
    const content = '## Tip: Read CLAUDE.md files\n\nAlways read relevant CLAUDE.md files.';
    writeHydrazPrompt(root, content);

    const result = readRepoPromptContent(root);

    expect(result).toBe(content);
  });

  it('should return null when .hydraz/HYDRAZ.md does not exist', () => {
    const root = setupRepoRoot();

    const result = readRepoPromptContent(root);

    expect(result).toBeNull();
  });

  it('should return null when .hydraz directory does not exist', () => {
    const root = setupRepoRoot();

    const result = readRepoPromptContent(root);

    expect(result).toBeNull();
  });

  it('should preserve whitespace and newlines in content', () => {
    const root = setupRepoRoot();
    const content = '## Section 1\n\nParagraph with trailing newline.\n\n## Section 2\n\nMore content.\n';
    writeHydrazPrompt(root, content);

    const result = readRepoPromptContent(root);

    expect(result).toBe(content);
  });
});

describe('expandTilde', () => {
  it('should expand leading ~ to the home directory', () => {
    const result = expandTilde('~/.aigl');

    expect(result).toBe(join(homedir(), '.aigl'));
  });

  it('should expand bare ~ to the home directory', () => {
    const result = expandTilde('~');

    expect(result).toBe(homedir());
  });

  it('should not expand ~ that is not at the start', () => {
    const result = expandTilde('/home/user/~/.config');

    expect(result).toBe('/home/user/~/.config');
  });

  it('should return absolute paths unchanged', () => {
    const result = expandTilde('/absolute/path');

    expect(result).toBe('/absolute/path');
  });

  it('should return relative paths without tilde unchanged', () => {
    const result = expandTilde('relative/path');

    expect(result).toBe('relative/path');
  });
});

describe('processHydrazIncludes', () => {
  it('should call scp for each hydrazincludes entry with expanded paths', () => {
    const root = setupRepoRoot();
    const hostDir = join(root, 'fake-aigl');
    mkdirSync(hostDir, { recursive: true });
    writeFileSync(join(hostDir, 'marker'), 'test', 'utf-8');

    writeHydrazConfig(root, JSON.stringify({
      hydrazincludes: [
        { host: hostDir, container: '/home/user/.aigl' },
      ],
    }));

    const mockScp = vi.fn<ScpFunction>();
    processHydrazIncludes(root, 'hydraz-test-ws', mockScp);

    expect(mockScp).toHaveBeenCalledTimes(1);
    expect(mockScp).toHaveBeenCalledWith('hydraz-test-ws', hostDir, '/home/user/.aigl');
  });

  it('should skip entries where host path does not exist and emit a warning', () => {
    const root = setupRepoRoot();
    writeHydrazConfig(root, JSON.stringify({
      hydrazincludes: [
        { host: '/nonexistent/path/that/will/never/exist', container: '/container/path' },
      ],
    }));

    const mockScp = vi.fn<ScpFunction>();
    const events: string[] = [];
    processHydrazIncludes(root, 'hydraz-test-ws', mockScp, (msg) => events.push(msg));

    expect(mockScp).not.toHaveBeenCalled();
    expect(events.some(e => e.includes('skipping') || e.includes('not found'))).toBe(true);
  });

  it('should do nothing when .hydraz/config.json does not exist', () => {
    const root = setupRepoRoot();

    const mockScp = vi.fn<ScpFunction>();
    processHydrazIncludes(root, 'hydraz-test-ws', mockScp);

    expect(mockScp).not.toHaveBeenCalled();
  });

  it('should do nothing when hydrazincludes is empty', () => {
    const root = setupRepoRoot();
    writeHydrazConfig(root, JSON.stringify({ hydrazincludes: [] }));

    const mockScp = vi.fn<ScpFunction>();
    processHydrazIncludes(root, 'hydraz-test-ws', mockScp);

    expect(mockScp).not.toHaveBeenCalled();
  });

  it('should handle multiple entries and skip only missing ones', () => {
    const root = setupRepoRoot();
    const existingDir = join(root, 'existing-dir');
    mkdirSync(existingDir, { recursive: true });

    writeHydrazConfig(root, JSON.stringify({
      hydrazincludes: [
        { host: existingDir, container: '/container/existing' },
        { host: '/nonexistent/never', container: '/container/missing' },
        { host: existingDir, container: '/container/another' },
      ],
    }));

    const mockScp = vi.fn<ScpFunction>();
    const events: string[] = [];
    processHydrazIncludes(root, 'hydraz-test-ws', mockScp, (msg) => events.push(msg));

    expect(mockScp).toHaveBeenCalledTimes(2);
    expect(mockScp).toHaveBeenCalledWith('hydraz-test-ws', existingDir, '/container/existing');
    expect(mockScp).toHaveBeenCalledWith('hydraz-test-ws', existingDir, '/container/another');
    expect(events.some(e => e.includes('not found') || e.includes('skipping'))).toBe(true);
  });

  it('should expand tilde in host paths', () => {
    const root = setupRepoRoot();
    const homeAigl = join(homedir(), '.aigl-hydraz-test-' + Date.now());
    mkdirSync(homeAigl, { recursive: true });

    try {
      const tildeRelative = homeAigl.replace(homedir(), '~');
      writeHydrazConfig(root, JSON.stringify({
        hydrazincludes: [
          { host: tildeRelative, container: '~/.aigl' },
        ],
      }));

      const mockScp = vi.fn<ScpFunction>();
      processHydrazIncludes(root, 'hydraz-test-ws', mockScp);

      expect(mockScp).toHaveBeenCalledTimes(1);
      expect(mockScp.mock.calls[0]![1]).toBe(homeAigl);
    } finally {
      rmSync(homeAigl, { recursive: true, force: true });
    }
  });

  it('should expand tilde in container paths', () => {
    const root = setupRepoRoot();
    const existingDir = join(root, 'some-dir');
    mkdirSync(existingDir, { recursive: true });

    writeHydrazConfig(root, JSON.stringify({
      hydrazincludes: [
        { host: existingDir, container: '~/.config/tool' },
      ],
    }));

    const mockScp = vi.fn<ScpFunction>();
    processHydrazIncludes(root, 'hydraz-test-ws', mockScp);

    expect(mockScp).toHaveBeenCalledTimes(1);
    expect(mockScp.mock.calls[0]![2]).toBe(join(homedir(), '.config/tool'));
  });

  it('should await async scp calls before resolving', async () => {
    const root = setupRepoRoot();
    const existingDir = join(root, 'async-dir');
    mkdirSync(existingDir, { recursive: true });

    writeHydrazConfig(root, JSON.stringify({
      hydrazincludes: [{ host: existingDir, container: '/dest' }],
    }));

    let callCompleted = false;
    const asyncScp = vi.fn().mockImplementation(
      () => new Promise<void>(resolve => {
        setTimeout(() => { callCompleted = true; resolve(); }, 50);
      }),
    );

    await processHydrazIncludes(root, 'hydraz-test-ws', asyncScp);

    expect(asyncScp).toHaveBeenCalledTimes(1);
    expect(callCompleted).toBe(true);
  });

  it('should propagate errors from async scp calls', async () => {
    const root = setupRepoRoot();
    const existingDir = join(root, 'err-dir');
    mkdirSync(existingDir, { recursive: true });

    writeHydrazConfig(root, JSON.stringify({
      hydrazincludes: [{ host: existingDir, container: '/dest' }],
    }));

    const error = new Error('scp failed: connection refused');
    const asyncScp = vi.fn().mockImplementation(() => {
      const p = Promise.reject(error);
      p.catch(() => {});
      return p;
    });

    let caught: Error | undefined;
    try {
      await processHydrazIncludes(root, 'hydraz-test-ws', asyncScp);
    } catch (err) {
      caught = err as Error;
    }

    expect(caught).toBeDefined();
    expect(caught!.message).toContain('scp failed');
  });

  it('should process multiple async scp calls sequentially', async () => {
    const root = setupRepoRoot();
    const dir1 = join(root, 'seq-dir-1');
    const dir2 = join(root, 'seq-dir-2');
    mkdirSync(dir1, { recursive: true });
    mkdirSync(dir2, { recursive: true });

    writeHydrazConfig(root, JSON.stringify({
      hydrazincludes: [
        { host: dir1, container: '/dest1' },
        { host: dir2, container: '/dest2' },
      ],
    }));

    const order: string[] = [];
    const asyncScp = vi.fn().mockImplementation(
      (_ws: string, _local: string, remote: string) => new Promise<void>(resolve => {
        const delay = remote === '/dest1' ? 50 : 10;
        setTimeout(() => { order.push(remote); resolve(); }, delay);
      }),
    );

    await processHydrazIncludes(root, 'hydraz-test-ws', asyncScp);

    expect(asyncScp).toHaveBeenCalledTimes(2);
    expect(order).toEqual(['/dest1', '/dest2']);
  });
});
