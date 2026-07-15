import { redactSecrets } from './display/sanitize.js';

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
  process.stderr.write(`[debug ${ts()}] ${redactSecrets(msg)}\n`);
}

export function debugExec(cmd: string, args: string[]): void {
  if (!verbose) return;
  const safeArgs = args.map(omitSerializedRunnerOptions);
  process.stderr.write(`[debug ${ts()}] ${redactSecrets(`exec: ${cmd} ${safeArgs.join(' ')}`)}\n`);
}

export function debugOutput(label: string, output: string): void {
  if (!verbose) return;
  process.stderr.write(`[debug ${ts()}] ${redactSecrets(`${label}: ${output.trimEnd()}`)}\n`);
}

export function debugTiming(label: string, ms: number): void {
  if (!verbose) return;
  process.stderr.write(`[debug ${ts()}] ${redactSecrets(label)}: ${ms}ms\n`);
}

function omitSerializedRunnerOptions(arg: string): string {
  const marker = 'HYDRAZ_CODEX_RUNNER_OPTIONS=';
  const markerIndex = arg.indexOf(marker);
  if (markerIndex === -1) return arg;
  return `${arg.slice(0, markerIndex)}${marker}[OMITTED]`;
}
