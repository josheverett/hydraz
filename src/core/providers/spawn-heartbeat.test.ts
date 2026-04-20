import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawnWithHeartbeat } from './spawn-heartbeat.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('spawnWithHeartbeat', () => {
  it('resolves with stdout and exit code 0 on success', async () => {
    const onHeartbeat = vi.fn();
    const promise = spawnWithHeartbeat('echo', ['hello'], {}, {
      label: 'Test',
      intervalMs: 1000,
      onHeartbeat,
    });
    vi.useRealTimers();
    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello');
  });

  it('rejects on non-zero exit code with stderr content', async () => {
    const onHeartbeat = vi.fn();
    const promise = spawnWithHeartbeat('sh', ['-c', 'echo fail >&2; exit 1'], {}, {
      label: 'Failing',
      intervalMs: 1000,
      onHeartbeat,
    });
    vi.useRealTimers();
    await expect(promise).rejects.toThrow('fail');
  });

  it('rejects on spawn error for nonexistent command', async () => {
    const onHeartbeat = vi.fn();
    const promise = spawnWithHeartbeat('__nonexistent_cmd_hydraz__', [], {}, {
      label: 'Bad',
      intervalMs: 1000,
      onHeartbeat,
    });
    vi.useRealTimers();
    await expect(promise).rejects.toThrow();
  });

  it('calls onHeartbeat at the configured interval with label and elapsed time', async () => {
    const onHeartbeat = vi.fn();
    const promise = spawnWithHeartbeat('sh', ['-c', 'sleep 999'], {}, {
      label: 'Provision',
      intervalMs: 5000,
      onHeartbeat,
    });

    await vi.advanceTimersByTimeAsync(5000);
    expect(onHeartbeat).toHaveBeenCalledTimes(1);
    expect(onHeartbeat).toHaveBeenCalledWith('Provision', expect.any(Number));
    expect(onHeartbeat.mock.calls[0]![1]).toBeGreaterThanOrEqual(4000);

    await vi.advanceTimersByTimeAsync(5000);
    expect(onHeartbeat).toHaveBeenCalledTimes(2);
    expect(onHeartbeat.mock.calls[1]![1]).toBeGreaterThanOrEqual(9000);

    // Kill the child so the promise settles
    const child = (promise as unknown as { _child?: { kill: () => void } })._child;
    if (child) child.kill();
    vi.useRealTimers();
    await promise.catch(() => {});
  });

  it('forwards stdout lines to onStdoutLine callback', async () => {
    const onHeartbeat = vi.fn();
    const lines: string[] = [];
    const promise = spawnWithHeartbeat(
      'sh', ['-c', 'echo line1; echo line2'],
      {},
      {
        label: 'Lines',
        intervalMs: 60000,
        onHeartbeat,
        onStdoutLine: (line) => lines.push(line),
      },
    );
    vi.useRealTimers();
    await promise;
    expect(lines).toContain('line1');
    expect(lines).toContain('line2');
  });

  it('clears the heartbeat interval after the process exits', async () => {
    const onHeartbeat = vi.fn();
    const promise = spawnWithHeartbeat('echo', ['done'], {}, {
      label: 'Quick',
      intervalMs: 1000,
      onHeartbeat,
    });
    vi.useRealTimers();
    await promise;

    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(5000);
    expect(onHeartbeat).not.toHaveBeenCalled();
  });

  it('passes spawn options through to the child process', async () => {
    const onHeartbeat = vi.fn();
    const promise = spawnWithHeartbeat('sh', ['-c', 'echo $MY_HEARTBEAT_TEST_VAR'], {
      env: { ...process.env, MY_HEARTBEAT_TEST_VAR: 'heartbeat-ok' },
    }, {
      label: 'Env',
      intervalMs: 60000,
      onHeartbeat,
    });
    vi.useRealTimers();
    const result = await promise;
    expect(result.stdout.trim()).toBe('heartbeat-ok');
  });

  it('collects stderr in the rejection error', async () => {
    const onHeartbeat = vi.fn();
    const promise = spawnWithHeartbeat(
      'sh', ['-c', 'echo "error details" >&2; exit 2'],
      {},
      { label: 'Err', intervalMs: 1000, onHeartbeat },
    );
    vi.useRealTimers();
    try {
      await promise;
      expect.unreachable('should have rejected');
    } catch (err) {
      expect((err as Error).message).toContain('error details');
    }
  });
});
