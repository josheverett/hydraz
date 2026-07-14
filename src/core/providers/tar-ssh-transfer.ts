import { spawn, type ChildProcess } from 'node:child_process';
import { posix } from 'node:path';
import { debugExec, debugTiming } from '../debug.js';
import { shellEscape } from '../shell.js';

export interface TarToSshTransferOptions {
  workspaceName: string;
  tarArgs: string[];
  remoteCommand: string;
  onHeartbeat?: (label: string, elapsedMs: number) => void;
  timeoutMs?: number;
}

export type TransferProcessSpawner = (
  command: string,
  args: string[],
) => ChildProcess;

export function buildExactDestinationExtractionCommand(
  remotePath: string,
  archivedEntry: string | undefined,
  injectPackageJson = false,
): string {
  const remoteParent = posix.dirname(remotePath);
  const lines = [
    'set -eu',
    `destination=${shellEscape(remotePath)}`,
    `parent=${shellEscape(remoteParent)}`,
    'mkdir -p -- "$parent"',
    'stage=$(mktemp -d "$parent/.hydraz-transfer.XXXXXX")',
    'cleanup() { rm -rf -- "$stage"; }',
    'trap cleanup EXIT HUP INT TERM',
    'tar -C "$stage" -xf -',
  ];

  if (archivedEntry !== undefined) {
    lines.push(
      `extracted="$stage"/${shellEscape(archivedEntry)}`,
      'if [ ! -e "$extracted" ] && [ ! -L "$extracted" ]; then',
      "  printf '%s\\n' 'Hydraz transfer archive did not contain the expected entry' >&2",
      '  exit 1',
      'fi',
    );
  } else if (injectPackageJson) {
    lines.push(`printf '%s\\n' '{"type":"module"}' > "$stage/package.json"`);
  }

  lines.push('rm -rf -- "$destination"');
  if (archivedEntry === undefined) {
    lines.push('mv -- "$stage" "$destination"');
  } else {
    lines.push(
      'mv -- "$extracted" "$destination"',
      'rm -rf -- "$stage"',
    );
  }
  lines.push('trap - EXIT HUP INT TERM');

  return lines.join('\n');
}

export function buildFilesExtractionCommand(
  remoteRoot: string,
  files: readonly string[],
): string {
  const remoteParent = posix.dirname(remoteRoot);
  const lines = [
    'set -eu',
    `remote_root=${shellEscape(remoteRoot)}`,
    `parent=${shellEscape(remoteParent)}`,
    'mkdir -p -- "$parent" "$remote_root"',
    'stage=$(mktemp -d "$parent/.hydraz-transfer.XXXXXX")',
    'cleanup() { rm -rf -- "$stage"; }',
    'trap cleanup EXIT HUP INT TERM',
    'tar -C "$stage" -xf -',
  ];

  for (const file of files) {
    lines.push(
      `source_path="$stage"/${shellEscape(file)}`,
      'if [ ! -e "$source_path" ] && [ ! -L "$source_path" ]; then',
      `  printf '%s\\n' ${shellEscape(`Hydraz transfer archive did not contain ${file}`)} >&2`,
      '  exit 1',
      'fi',
    );
  }

  for (const file of files) {
    lines.push(
      `source_path="$stage"/${shellEscape(file)}`,
      `destination="$remote_root"/${shellEscape(file)}`,
      'mkdir -p -- "$(dirname -- "$destination")"',
      'rm -rf -- "$destination"',
      'mv -- "$source_path" "$destination"',
    );
  }

  lines.push(
    'rm -rf -- "$stage"',
    'trap - EXIT HUP INT TERM',
  );
  return lines.join('\n');
}

export function buildTarArguments(
  localRoot: string,
  entries: readonly string[],
  excludedDirectoryNames: readonly string[] = [],
): string[] {
  const excludeArgs = excludedDirectoryNames.flatMap((name) => [
    `--exclude=${name}`,
    `--exclude=*/${name}`,
  ]);
  return [
    '-C',
    localRoot,
    '--no-xattrs',
    ...excludeArgs,
    '-cf',
    '-',
    '--',
    ...entries,
  ];
}

export async function streamTarToSsh(
  options: TarToSshTransferOptions,
  spawnProcess: TransferProcessSpawner = defaultSpawnProcess,
): Promise<void> {
  const sshArgs = [`${options.workspaceName}.devpod`, options.remoteCommand];
  debugExec('tar', options.tarArgs);
  debugExec('ssh', sshArgs);
  const start = Date.now();

  let tarProcess: ChildProcess | undefined;
  let sshProcess: ChildProcess | undefined;
  try {
    tarProcess = spawnProcess('tar', options.tarArgs);
    sshProcess = spawnProcess('ssh', sshArgs);
  } catch (error) {
    tarProcess?.kill();
    sshProcess?.kill();
    throw error;
  }

  if (!tarProcess.stdout || !tarProcess.stderr || !sshProcess.stdin || !sshProcess.stderr) {
    tarProcess.kill();
    sshProcess.kill();
    throw new Error('Unable to create the tar-to-SSH transfer streams');
  }

  // A consumer that exits before tar finishes can close its stdin with EPIPE.
  // The SSH status below is the useful failure, so prevent an unhandled stream error.
  sshProcess.stdin.on('error', () => {});
  tarProcess.once('error', () => sshProcess.stdin?.end());
  sshProcess.once('error', () => tarProcess.kill());
  sshProcess.once('close', () => {
    if (tarProcess.exitCode === null && tarProcess.signalCode === null) {
      tarProcess.kill();
    }
  });
  sshProcess.stdout?.resume();
  tarProcess.stdout.pipe(sshProcess.stdin);

  const heartbeat = options.onHeartbeat === undefined
    ? undefined
    : setInterval(() => {
      options.onHeartbeat?.('Copying to container', Date.now() - start);
    }, 10_000);
  heartbeat?.unref();
  let timedOut = false;
  const timeout = options.timeoutMs === undefined
    ? undefined
    : setTimeout(() => {
      timedOut = true;
      tarProcess.kill();
      sshProcess.kill();
    }, options.timeoutMs);
  timeout?.unref();

  try {
    const [tarResult, sshResult] = await Promise.all([
      waitForProcess(tarProcess),
      waitForProcess(sshProcess),
    ]);
    const failures: string[] = [];
    if (timedOut) {
      throw new Error(`Copying to container timed out after ${options.timeoutMs}ms`);
    }
    if (tarResult.error !== undefined || tarResult.exitCode !== 0) {
      failures.push(formatFailure('tar', tarResult));
    }
    if (sshResult.error !== undefined || sshResult.exitCode !== 0) {
      failures.push(formatFailure('ssh', sshResult));
    }
    if (failures.length > 0) {
      throw new Error(`Copying to container failed: ${failures.join('; ')}`);
    }
    debugTiming('streamTarToSsh', Date.now() - start);
  } finally {
    if (heartbeat !== undefined) clearInterval(heartbeat);
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

interface ProcessResult {
  exitCode: number | null;
  stderr: string;
  error?: Error;
}

function defaultSpawnProcess(command: string, args: string[]): ChildProcess {
  return spawn(command, args, {
    stdio: command === 'tar'
      ? ['ignore', 'pipe', 'pipe']
      : ['pipe', 'pipe', 'pipe'],
  });
}

function waitForProcess(child: ChildProcess): Promise<ProcessResult> {
  return new Promise((resolve) => {
    let settled = false;
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      resolve({ exitCode: null, stderr: stderr.trim(), error });
    });
    child.once('close', (exitCode) => {
      if (settled) return;
      settled = true;
      resolve({ exitCode, stderr: stderr.trim() });
    });
  });
}

function formatFailure(processName: string, result: ProcessResult): string {
  const detail = result.stderr || result.error?.message || `exit code ${result.exitCode ?? 'unknown'}`;
  return `${processName} failed: ${detail}`;
}
