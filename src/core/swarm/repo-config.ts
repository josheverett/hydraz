import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface HydrazInclude {
  host: string;
  container: string;
}

export interface HydrazRepoConfig {
  hydrazincludes?: HydrazInclude[];
}

const HYDRAZ_DIR = '.hydraz';
const CONFIG_FILE = 'config.json';
const PROMPT_FILE = 'HYDRAZ.md';

function isValidInclude(entry: unknown): entry is HydrazInclude {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    typeof (entry as Record<string, unknown>).host === 'string' &&
    typeof (entry as Record<string, unknown>).container === 'string'
  );
}

function validateRepoConfig(data: unknown): HydrazRepoConfig | null {
  if (typeof data !== 'object' || data === null) return null;

  const obj = data as Record<string, unknown>;

  if ('hydrazincludes' in obj) {
    if (!Array.isArray(obj.hydrazincludes)) return null;
    for (const entry of obj.hydrazincludes) {
      if (!isValidInclude(entry)) return null;
    }
  }

  return data as HydrazRepoConfig;
}

export function loadRepoConfig(repoRoot: string): HydrazRepoConfig | null {
  const configPath = join(repoRoot, HYDRAZ_DIR, CONFIG_FILE);

  if (!existsSync(configPath)) return null;

  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  return validateRepoConfig(parsed);
}

export function readRepoPromptContent(repoRoot: string): string | null {
  const promptPath = join(repoRoot, HYDRAZ_DIR, PROMPT_FILE);

  if (!existsSync(promptPath)) return null;

  try {
    return readFileSync(promptPath, 'utf-8');
  } catch {
    return null;
  }
}

export function expandTilde(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

export type ScpFunction = (workspaceName: string, localPath: string, remotePath: string) => void;

export function processHydrazIncludes(
  repoRoot: string,
  workspaceName: string,
  scp: ScpFunction,
  onEvent?: (message: string) => void,
): void {
  const config = loadRepoConfig(repoRoot);
  if (!config?.hydrazincludes?.length) return;

  for (const include of config.hydrazincludes) {
    const hostPath = expandTilde(include.host);
    if (!existsSync(hostPath)) {
      onEvent?.(`hydrazincludes: skipping ${include.host} (not found at ${hostPath})`);
      continue;
    }
    const containerPath = expandTilde(include.container);
    onEvent?.(`hydrazincludes: copying ${include.host} → ${include.container}`);
    scp(workspaceName, hostPath, containerPath);
  }
}
