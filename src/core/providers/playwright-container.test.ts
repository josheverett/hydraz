import type { ChildProcess } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpawnHeartbeatPromise } from './spawn-heartbeat.js';

vi.mock('./devpod.js', () => ({
  sshExec: vi.fn(() => 'unhealthy\n'),
}));

vi.mock('./spawn-heartbeat.js', () => ({
  spawnWithHeartbeat: vi.fn(() => fakeSpawnPromise()),
}));

import { sshExec } from './devpod.js';
import { spawnWithHeartbeat } from './spawn-heartbeat.js';
import { ensurePlaywrightContainerRuntime } from './playwright-container.js';

const mockSshExec = vi.mocked(sshExec);
const mockSpawnWithHeartbeat = vi.mocked(spawnWithHeartbeat);

function fakeSpawnPromise(): SpawnHeartbeatPromise {
  return Object.assign(
    Promise.resolve({ stdout: '', exitCode: 0 }),
    { _child: {} as ChildProcess },
  ) as SpawnHeartbeatPromise;
}

function captureCommands(containerHome = '/home/codex'): {
  healthCommand: string;
  provisionCommand: string;
} {
  void ensurePlaywrightContainerRuntime('hydraz-session', containerHome);
  return {
    healthCommand: mockSshExec.mock.calls.at(-1)?.[1] ?? '',
    provisionCommand: String(mockSpawnWithHeartbeat.mock.calls.at(-1)?.[1]?.[1] ?? ''),
  };
}

function createHealthyRuntime(containerHome: string): {
  executablePath: string;
  exposedExecutable: string;
} {
  const runtimeRoot = join(
    containerHome,
    '.hydraz',
    'runtimes',
    'playwright',
    '1.61.1',
  );
  const cliPath = join(runtimeRoot, 'node_modules', 'playwright', 'cli.js');
  const executablePath = join(runtimeRoot, 'node_modules', '.bin', 'playwright');
  const exposedExecutable = join(containerHome, '.hydraz', 'bin', 'playwright');

  mkdirSync(dirname(cliPath), { recursive: true });
  mkdirSync(dirname(executablePath), { recursive: true });
  writeFileSync(join(runtimeRoot, '.hydraz-ready'), '');
  writeFileSync(cliPath, '');
  writeFileSync(executablePath, '#!/bin/sh\nexit 0\n');
  chmodSync(executablePath, 0o755);
  writeFileSync(join(runtimeRoot, 'smoke.mjs'), 'process.exit(0);\n');

  return { executablePath, exposedExecutable };
}

function runShell(command: string, env = process.env) {
  return spawnSync('/bin/sh', ['-c', command], {
    encoding: 'utf8',
    env,
  });
}

describe('ensurePlaywrightContainerRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSshExec.mockReturnValue('unhealthy\n');
    mockSpawnWithHeartbeat.mockReturnValue(fakeSpawnPromise());
  });

  it('extracts a fresh packaged runtime into exact versioned Hydraz paths', async () => {
    const runtime = await ensurePlaywrightContainerRuntime('hydraz-session', '/home/codex');

    expect(runtime).toEqual({
      runtimeRoot: '/home/codex/.hydraz/runtimes/playwright/1.61.1',
      browsersPath: '/home/codex/.hydraz/browsers/playwright-1.61.1',
      binDir: '/home/codex/.hydraz/bin',
    });
    const command = String(mockSpawnWithHeartbeat.mock.calls[0]?.[1]?.[1] ?? '');
    expect(command).toContain('/tmp/hydraz-dist/runtime/playwright-runtime.tar.gz');
    expect(command).toContain("tar -xzf '/tmp/hydraz-dist/runtime/playwright-runtime.tar.gz'");
    expect(command).toContain("-C '/home/codex/.hydraz/runtimes/playwright/1.61.1'");
  });

  it('installs matching Chromium and dependencies into the versioned browser cache', async () => {
    await ensurePlaywrightContainerRuntime('hydraz-session', '/home/codex');

    const command = String(mockSpawnWithHeartbeat.mock.calls[0]?.[1]?.[1] ?? '');
    expect(command).toContain(
      "PLAYWRIGHT_BROWSERS_PATH='/home/codex/.hydraz/browsers/playwright-1.61.1' " +
      "node '/home/codex/.hydraz/runtimes/playwright/1.61.1/node_modules/playwright/cli.js' " +
      'install --with-deps chromium',
    );
  });

  it('runs long provisioning through SSH with a 900-second timeout and heartbeats', async () => {
    const onHeartbeat = vi.fn();

    await ensurePlaywrightContainerRuntime('hydraz-session', '/home/codex', onHeartbeat);

    expect(mockSpawnWithHeartbeat).toHaveBeenCalledWith(
      'ssh',
      ['hydraz-session.devpod', expect.any(String)],
      { timeout: 900_000 },
      {
        label: 'Provisioning Playwright',
        intervalMs: 15_000,
        onHeartbeat,
      },
    );
  });

  it('validates Chromium before marking/linking the runtime and propagates setup failures', async () => {
    await ensurePlaywrightContainerRuntime('hydraz-session', '/home/codex');

    const command = String(mockSpawnWithHeartbeat.mock.calls[0]?.[1]?.[1] ?? '');
    const smokeIndex = command.indexOf("node '/home/codex/.hydraz/runtimes/playwright/1.61.1/smoke.mjs'");
    const markerIndex = command.indexOf("touch '/home/codex/.hydraz/runtimes/playwright/1.61.1/.hydraz-ready'");
    const linkIndex = command.indexOf("ln -s '/home/codex/.hydraz/runtimes/playwright/1.61.1/node_modules/.bin/playwright'");
    expect(smokeIndex).toBeGreaterThan(-1);
    expect(linkIndex).toBeGreaterThan(smokeIndex);
    expect(markerIndex).toBeGreaterThan(linkIndex);

    mockSpawnWithHeartbeat.mockRejectedValueOnce(new Error('chromium install failed'));
    await expect(
      ensurePlaywrightContainerRuntime('hydraz-session', '/home/codex'),
    ).rejects.toThrow('chromium install failed');
  });

  it('revalidates a healthy runtime and repairs its executable link without reinstalling', async () => {
    mockSshExec.mockReturnValue('healthy\n');

    const runtime = await ensurePlaywrightContainerRuntime('hydraz-session', '/home/codex');

    expect(runtime.binDir).toBe('/home/codex/.hydraz/bin');
    expect(mockSpawnWithHeartbeat).not.toHaveBeenCalled();
    const healthCommand = mockSshExec.mock.calls[0]?.[1] ?? '';
    expect(healthCommand).toContain("node '/home/codex/.hydraz/runtimes/playwright/1.61.1/smoke.mjs'");
    expect(healthCommand).toContain("ln -s '/home/codex/.hydraz/runtimes/playwright/1.61.1/node_modules/.bin/playwright'");
  });

  it('treats an incomplete or failed health probe as unhealthy and performs full repair', async () => {
    await ensurePlaywrightContainerRuntime('hydraz-session', '/home/codex');

    const healthCommand = mockSshExec.mock.calls[0]?.[1] ?? '';
    expect(healthCommand).toContain("test -f '/home/codex/.hydraz/runtimes/playwright/1.61.1/.hydraz-ready'");
    expect(healthCommand).toContain("test -f '/home/codex/.hydraz/runtimes/playwright/1.61.1/node_modules/playwright/cli.js'");
    expect(healthCommand).toContain("test -x '/home/codex/.hydraz/runtimes/playwright/1.61.1/node_modules/.bin/playwright'");
    expect(healthCommand).toContain("test -f '/home/codex/.hydraz/runtimes/playwright/1.61.1/smoke.mjs'");
    expect(mockSpawnWithHeartbeat).toHaveBeenCalledTimes(1);
  });

  it('builds a health probe that parses as a complete POSIX shell program', () => {
    const { healthCommand } = captureCommands();

    const result = spawnSync('/bin/sh', ['-n', '-c', healthCommand], { encoding: 'utf8' });

    expect(result.status, result.stderr).toBe(0);
  });

  it('executes the healthy branch and exposes the validated executable', () => {
    const root = mkdtempSync(join(tmpdir(), "hydraz playwright 'healthy "));
    const containerHome = join(root, "home with 'quote");
    try {
      const { executablePath, exposedExecutable } = createHealthyRuntime(containerHome);
      const { healthCommand } = captureCommands(containerHome);

      const result = runShell(healthCommand);

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe('healthy');
      expect(lstatSync(exposedExecutable).isSymbolicLink()).toBe(true);
      expect(readlinkSync(exposedExecutable)).toBe(executablePath);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('executes the unhealthy branch without failing the health probe', () => {
    const root = mkdtempSync(join(tmpdir(), 'hydraz-playwright-unhealthy-'));
    try {
      const { healthCommand } = captureCommands(join(root, 'home'));

      const result = runShell(healthCommand);

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe('unhealthy');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('replaces a directory collision at the exposed executable path', () => {
    const root = mkdtempSync(join(tmpdir(), 'hydraz-playwright-collision-'));
    const containerHome = join(root, 'home');
    try {
      const { executablePath, exposedExecutable } = createHealthyRuntime(containerHome);
      mkdirSync(exposedExecutable, { recursive: true });
      writeFileSync(join(exposedExecutable, 'stale'), 'stale');
      const { healthCommand } = captureCommands(containerHome);

      const result = runShell(healthCommand);

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe('healthy');
      expect(lstatSync(exposedExecutable).isSymbolicLink()).toBe(true);
      expect(readlinkSync(exposedExecutable)).toBe(executablePath);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not report healthy when linking succeeds without exposing an executable', () => {
    const root = mkdtempSync(join(tmpdir(), 'hydraz-playwright-link-'));
    const containerHome = join(root, 'home');
    try {
      createHealthyRuntime(containerHome);
      const fakeBin = join(root, 'fake-bin');
      mkdirSync(fakeBin);
      writeFileSync(join(fakeBin, 'ln'), '#!/bin/sh\nexit 0\n');
      chmodSync(join(fakeBin, 'ln'), 0o755);
      const { healthCommand } = captureCommands(containerHome);

      const result = runShell(healthCommand, {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      });

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe('unhealthy');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('builds a provisioning program that parses as POSIX shell', () => {
    const { provisionCommand } = captureCommands();

    const result = spawnSync('/bin/sh', ['-n', '-c', provisionCommand], { encoding: 'utf8' });

    expect(result.status, result.stderr).toBe(0);
  });

  it('removes stale readiness first and recreates the marker only after link validation', () => {
    const { provisionCommand } = captureCommands();
    const markerPath = "'/home/codex/.hydraz/runtimes/playwright/1.61.1/.hydraz-ready'";
    const exposedExecutable = "'/home/codex/.hydraz/bin/playwright'";
    const removeMarkerIndex = provisionCommand.indexOf(`rm -rf ${markerPath}`);
    const smokeIndex = provisionCommand.indexOf(
      "node '/home/codex/.hydraz/runtimes/playwright/1.61.1/smoke.mjs'",
    );
    const linkIndex = provisionCommand.indexOf(
      "ln -s '/home/codex/.hydraz/runtimes/playwright/1.61.1/node_modules/.bin/playwright'",
    );
    const validateLinkIndex = provisionCommand.indexOf(`test -x ${exposedExecutable}`);
    const createMarkerIndex = provisionCommand.indexOf(`touch ${markerPath}`);

    expect(removeMarkerIndex).toBeGreaterThan(-1);
    expect(smokeIndex).toBeGreaterThan(removeMarkerIndex);
    expect(linkIndex).toBeGreaterThan(smokeIndex);
    expect(validateLinkIndex).toBeGreaterThan(linkIndex);
    expect(createMarkerIndex).toBeGreaterThan(validateLinkIndex);
  });
});
