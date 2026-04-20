import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

export interface HeartbeatConfig {
  label: string;
  intervalMs: number;
  onHeartbeat: (label: string, elapsedMs: number) => void;
  onStdoutLine?: (line: string) => void;
}

export interface SpawnResult {
  stdout: string;
  exitCode: number;
}

export type SpawnHeartbeatPromise = Promise<SpawnResult> & { _child: ChildProcess };

export function spawnWithHeartbeat(
  cmd: string,
  args: string[],
  options: SpawnOptions,
  heartbeat: HeartbeatConfig,
): SpawnHeartbeatPromise {
  const startTime = Date.now();
  const child = spawn(cmd, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'] });

  const interval = setInterval(() => {
    heartbeat.onHeartbeat(heartbeat.label, Date.now() - startTime);
  }, heartbeat.intervalMs);

  const promise = new Promise<SpawnResult>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let stdoutBuf = '';

    child.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;

      if (heartbeat.onStdoutLine) {
        stdoutBuf += chunk;
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop() ?? '';
        for (const line of lines) {
          if (line) heartbeat.onStdoutLine(line);
        }
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      clearInterval(interval);

      if (heartbeat.onStdoutLine && stdoutBuf) {
        heartbeat.onStdoutLine(stdoutBuf);
      }

      const exitCode = code ?? 1;
      if (exitCode !== 0) {
        reject(new Error(stderr.trim() || `Process exited with code ${exitCode}`));
      } else {
        resolve({ stdout, exitCode });
      }
    });

    child.on('error', (err) => {
      clearInterval(interval);
      reject(err);
    });
  });

  return Object.assign(promise, { _child: child });
}
