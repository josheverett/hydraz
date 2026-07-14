import { execFileSync, spawnSync, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildExactDestinationExtractionCommand,
  buildFilesExtractionCommand,
  buildTarArguments,
  streamTarToSsh,
  type TransferProcessSpawner,
} from './tar-ssh-transfer.js';

const tempDirs: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `hydraz-${label}-`));
  tempDirs.push(dir);
  return dir;
}

function assertParsesAsPosixShell(command: string): void {
  const parsed = spawnSync('sh', ['-n', '-c', command], { encoding: 'utf8' });
  expect(parsed.status, parsed.stderr).toBe(0);
}

function fakeProcess(exitCode: number, stderr = ''): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderrStream = new PassThrough();
  Object.assign(child, {
    stdin,
    stdout,
    stderr: stderrStream,
    exitCode: null,
    signalCode: null,
    kill: vi.fn(() => true),
  });
  queueMicrotask(() => {
    if (stderr) stderrStream.write(stderr);
    stderrStream.end();
    stdout.end();
    Object.assign(child, { exitCode, signalCode: null });
    child.emit('close', exitCode, null);
  });
  return child;
}

interface ControlledProcess {
  child: ChildProcess;
  close: (exitCode: number | null, signalCode?: NodeJS.Signals | null, stderr?: string) => void;
  kill: ReturnType<typeof vi.fn>;
}

function controlledProcess(): ControlledProcess {
  const child = new EventEmitter() as ChildProcess;
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderrStream = new PassThrough();
  let closed = false;
  const close = (
    exitCode: number | null,
    signalCode: NodeJS.Signals | null = null,
    stderr = '',
  ) => {
    if (closed) return;
    closed = true;
    if (stderr) stderrStream.write(stderr);
    stderrStream.end();
    stdout.end();
    stdin.end();
    Object.assign(child, { exitCode, signalCode });
    child.emit('close', exitCode, signalCode);
  };
  const kill = vi.fn((signal: NodeJS.Signals = 'SIGTERM') => {
    Object.assign(child, { killed: true });
    close(null, signal);
    return true;
  });
  Object.assign(child, {
    stdin,
    stdout,
    stderr: stderrStream,
    exitCode: null,
    signalCode: null,
    killed: false,
    kill,
  });
  return { child, close, kill };
}

function controlledSpawner(
  tar: ControlledProcess,
  ssh: ControlledProcess,
): TransferProcessSpawner {
  return vi.fn((command: string) => command === 'tar' ? tar.child : ssh.child);
}

function fakeSpawner(tarResult: [number, string?], sshResult: [number, string?]): TransferProcessSpawner {
  return vi.fn((command: string) => {
    const [code, stderr] = command === 'tar' ? tarResult : sshResult;
    return fakeProcess(code, stderr);
  });
}

describe('remote extraction commands', () => {
  it('parses an exact-destination program containing spaces and apostrophes', () => {
    assertParsesAsPosixShell(
      buildExactDestinationExtractionCommand(
        "/home/user's files/final config.toml",
        "source config.toml",
      ),
    );
  });

  it('parses a multi-file extraction program containing spaces and apostrophes', () => {
    assertParsesAsPosixShell(
      buildFilesExtractionCommand("/workspaces/user's repo", ["agent config/.env", "-private.env"]),
    );
  });

  it('installs a file at the requested basename after successful extraction', () => {
    const root = makeTempDir('exact-file');
    const sourceDir = join(root, 'source');
    const destination = join(root, "target dir", "renamed's config.toml");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, 'original config.toml'), 'model = "gpt-5"\n');
    const archive = execFileSync('tar', ['-C', sourceDir, '-cf', '-', '--', 'original config.toml']);

    const result = spawnSync(
      'sh',
      ['-c', buildExactDestinationExtractionCommand(destination, 'original config.toml')],
      { input: archive, encoding: 'utf8' },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(destination)).toBe(true);
    expect(readFileSync(destination, 'utf8')).toBe('model = "gpt-5"\n');
  });

  it('replaces a directory only after extracting its complete new contents', () => {
    const root = makeTempDir('exact-directory');
    const sourceDir = join(root, 'source');
    const destination = join(root, "target's directory");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(sourceDir, 'fresh.txt'), 'fresh');
    writeFileSync(join(destination, 'stale.txt'), 'stale');
    const archive = execFileSync('tar', ['-C', sourceDir, '-cf', '-', '--', '.']);

    const result = spawnSync(
      'sh',
      ['-c', buildExactDestinationExtractionCommand(destination, undefined)],
      { input: archive, encoding: 'utf8' },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(join(destination, 'fresh.txt'))).toBe(true);
    expect(readFileSync(join(destination, 'fresh.txt'), 'utf8')).toBe('fresh');
    expect(() => readFileSync(join(destination, 'stale.txt'), 'utf8')).toThrow();
  });

  it('places -- before archive operands including leading-dash filenames', () => {
    const args = buildTarArguments('/host/repo', ['-private.env', 'agent/.env']);
    expect(args).toEqual([
      '-C',
      '/host/repo',
      '--no-xattrs',
      '-cf',
      '-',
      '--',
      '-private.env',
      'agent/.env',
    ]);
  });
});

describe('streamTarToSsh', () => {
  const transfer = {
    workspaceName: 'my-ws',
    tarArgs: ['-C', '/host/repo', '-cf', '-', '--', '.'],
    remoteCommand: 'tar -C /tmp/target -xf -',
  };

  it('rejects a tar failure even when SSH exits successfully', async () => {
    await expect(
      streamTarToSsh(transfer, fakeSpawner([2, 'tar exploded'], [0])),
    ).rejects.toThrow(/tar failed.*tar exploded/i);
  });

  it('rejects an SSH failure even when tar exits successfully', async () => {
    await expect(
      streamTarToSsh(transfer, fakeSpawner([0], [255, 'connection refused'])),
    ).rejects.toThrow(/ssh failed.*connection refused/i);
  });

  it('resolves only after both tar and SSH succeed', async () => {
    const spawnProcess = fakeSpawner([0], [0]);
    await expect(streamTarToSsh(transfer, spawnProcess)).resolves.toBeUndefined();
    expect(spawnProcess).toHaveBeenNthCalledWith(1, 'tar', transfer.tarArgs);
    expect(spawnProcess).toHaveBeenNthCalledWith(
      2,
      'ssh',
      ['my-ws.devpod', transfer.remoteCommand],
    );
  });

  it('kills a still-running tar producer when SSH closes early', async () => {
    const tar = controlledProcess();
    const ssh = controlledProcess();
    const observed = streamTarToSsh(transfer, controlledSpawner(tar, ssh)).then(
      () => ({ status: 'resolved' as const }),
      (error: unknown) => ({
        status: 'rejected' as const,
        message: error instanceof Error ? error.message : String(error),
      }),
    );

    ssh.close(255, null, 'connection refused');
    const outcome = await Promise.race([
      observed,
      new Promise<{ status: 'hung' }>((resolve) => {
        setTimeout(() => resolve({ status: 'hung' }), 50);
      }),
    ]);

    expect(tar.kill).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({
      status: 'rejected',
      message: expect.stringMatching(/ssh failed.*connection refused/i),
    });
  });

  it('kills both child processes when the transfer times out', async () => {
    vi.useFakeTimers();
    const tar = controlledProcess();
    const ssh = controlledProcess();
    const observed = streamTarToSsh(
      { ...transfer, timeoutMs: 100 },
      controlledSpawner(tar, ssh),
    ).then(
      () => ({ status: 'resolved' as const }),
      (error: unknown) => ({
        status: 'rejected' as const,
        message: error instanceof Error ? error.message : String(error),
      }),
    );

    await vi.advanceTimersByTimeAsync(100);

    expect(tar.kill).toHaveBeenCalledTimes(1);
    expect(ssh.kill).toHaveBeenCalledTimes(1);
    await expect(observed).resolves.toEqual({
      status: 'rejected',
      message: 'Copying to container timed out after 100ms',
    });
  });
});
