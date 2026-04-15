let verbose = false;

export function setVerbose(enabled: boolean): void {
  verbose = enabled;
}

export function isVerbose(): boolean {
  return verbose;
}

export function debug(msg: string): void {
  if (!verbose) return;
  process.stderr.write(`[debug] ${msg}\n`);
}

export function debugExec(cmd: string, args: string[]): void {
  if (!verbose) return;
  process.stderr.write(`[debug] exec: ${cmd} ${args.join(' ')}\n`);
}

export function debugOutput(label: string, output: string): void {
  if (!verbose) return;
  process.stderr.write(`[debug] ${label}: ${output.trimEnd()}\n`);
}

export function debugTiming(label: string, ms: number): void {
  if (!verbose) return;
  process.stderr.write(`[debug] ${label}: ${ms}ms\n`);
}
