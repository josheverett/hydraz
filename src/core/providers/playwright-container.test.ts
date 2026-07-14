import type { ChildProcess } from 'node:child_process';
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
    const linkIndex = command.indexOf("ln -sfn '/home/codex/.hydraz/runtimes/playwright/1.61.1/node_modules/.bin/playwright'");
    expect(smokeIndex).toBeGreaterThan(-1);
    expect(markerIndex).toBeGreaterThan(smokeIndex);
    expect(linkIndex).toBeGreaterThan(markerIndex);

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
    expect(healthCommand).toContain("ln -sfn '/home/codex/.hydraz/runtimes/playwright/1.61.1/node_modules/.bin/playwright'");
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
});
