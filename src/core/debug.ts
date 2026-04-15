let verbose = false;

function ts(): string {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

export function setVerbose(enabled: boolean): void {
  verbose = enabled;
}

export function isVerbose(): boolean {
  return verbose;
}

export function debug(msg: string): void {
  if (!verbose) return;
  process.stderr.write(`[debug ${ts()}] ${msg}\n`);
}

export function debugExec(cmd: string, args: string[]): void {
  if (!verbose) return;
  process.stderr.write(`[debug ${ts()}] exec: ${cmd} ${args.join(' ')}\n`);
}

export function debugOutput(label: string, output: string): void {
  if (!verbose) return;
  process.stderr.write(`[debug ${ts()}] ${label}: ${output.trimEnd()}\n`);
}

export function debugTiming(label: string, ms: number): void {
  if (!verbose) return;
  process.stderr.write(`[debug ${ts()}] ${label}: ${ms}ms\n`);
}
