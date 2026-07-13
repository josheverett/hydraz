export interface CodexContainerImportFile {
  sourcePath: string;
  targetRelativePath: 'auth.json' | 'AGENTS.md';
}

export interface CodexContainerImportDirectory {
  sourcePath: string;
  targetRelativePath: 'rules' | 'skills';
  excludedDirectoryNames: readonly string[];
}

export interface CodexContainerImportPlan {
  sourceCodexHome: string;
  configToml?: string;
  files: CodexContainerImportFile[];
  directories: CodexContainerImportDirectory[];
}

export interface BuildCodexContainerImportPlanOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

export class CodexContainerImportError extends Error {
  constructor(message: string, readonly filePath?: string) {
    super(message);
    this.name = 'CodexContainerImportError';
  }
}

const PORTABLE_CONFIG_PATHS = [
  ['model'],
  ['model_reasoning_effort'],
  ['model_reasoning_summary'],
  ['model_supports_reasoning_summaries'],
  ['plan_mode_reasoning_effort'],
  ['model_verbosity'],
  ['personality'],
  ['service_tier'],
  ['web_search'],
  ['project_doc_max_bytes'],
  ['project_doc_fallback_filenames'],
  ['tools', 'view_image'],
  ['tools', 'web_search'],
] as const;

const MACOS_PATH_SIGNATURES = ['/Users/', '/Applications/', '~/Library'] as const;
const SKILL_DEPENDENCY_DIRECTORIES = ['.system', 'node_modules', '.venv', 'venv'] as const;

function isMergeableObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => cloneValue(entry)) as T;
  if (isMergeableObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]),
    ) as T;
  }
  return value;
}

function getPath(object: Record<string, unknown>, path: readonly string[]): unknown {
  let current: unknown = object;
  for (const segment of path) {
    if (!isMergeableObject(current) || !(segment in current)) return undefined;
    current = current[segment];
  }
  return current;
}

function setPath(object: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let current = object;
  for (const segment of path.slice(0, -1)) {
    if (!isMergeableObject(current[segment])) current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  }
  const finalSegment = path.at(-1);
  if (finalSegment !== undefined) current[finalSegment] = cloneValue(value);
}

function selectPortableConfig(hostConfig: TomlTableWithoutBigInt): Record<string, unknown> {
  const selected: Record<string, unknown> = {};
  for (const path of PORTABLE_CONFIG_PATHS) {
    const value = getPath(hostConfig, path);
    if (value !== undefined) setPath(selected, path, value);
  }
  return selected;
}

function mergeConfig(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const merged = cloneValue(base);
  for (const [key, overlayValue] of Object.entries(overlay)) {
    const baseValue = merged[key];
    merged[key] = isMergeableObject(baseValue) && isMergeableObject(overlayValue)
      ? mergeConfig(baseValue, overlayValue)
      : cloneValue(overlayValue);
  }
  return merged;
}

function parseTomlFile(filePath: string): TomlTableWithoutBigInt {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CodexContainerImportError(`${filePath}: unable to read TOML: ${detail}`, filePath);
  }

  try {
    return parse(raw) as TomlTableWithoutBigInt;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CodexContainerImportError(`${filePath}: invalid TOML: ${detail}`, filePath);
  }
}

function assertNoMacosPaths(value: unknown, path: string[] = []): void {
  if (typeof value === 'string') {
    const signature = MACOS_PATH_SIGNATURES.find((candidate) => value.includes(candidate));
    if (signature !== undefined) {
      throw new CodexContainerImportError(
        `Generated Codex config contains macOS path signature ${signature} at ${path.join('.')}`,
      );
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoMacosPaths(entry, [...path, String(index)]));
    return;
  }

  if (!isMergeableObject(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    const signature = MACOS_PATH_SIGNATURES.find((candidate) => key.includes(candidate));
    if (signature !== undefined) {
      throw new CodexContainerImportError(
        `Generated Codex config contains macOS path signature ${signature} at ${[...path, key].join('.')}`,
      );
    }
    assertNoMacosPaths(entry, [...path, key]);
  }
}

export function resolveHostCodexHome(
  env: NodeJS.ProcessEnv = process.env,
  homeDir = homedir(),
): string {
  const configured = env['CODEX_HOME']?.trim();
  return configured ? resolve(configured) : join(homeDir, '.codex');
}

export function buildCodexContainerImportPlan(
  repoRoot: string,
  options: BuildCodexContainerImportPlanOptions = {},
): CodexContainerImportPlan {
  const sourceCodexHome = resolveHostCodexHome(options.env, options.homeDir);
  const hostConfigPath = join(sourceCodexHome, 'config.toml');
  const overlayPath = join(repoRoot, '.hydraz', 'codex.container.toml');
  let generatedConfig: Record<string, unknown> = {};

  if (existsSync(hostConfigPath)) {
    generatedConfig = selectPortableConfig(parseTomlFile(hostConfigPath));
  }
  if (existsSync(overlayPath)) {
    generatedConfig = mergeConfig(generatedConfig, parseTomlFile(overlayPath));
  }

  assertNoMacosPaths(generatedConfig);
  const configToml = Object.keys(generatedConfig).length === 0
    ? undefined
    : `${stringify(generatedConfig).trimEnd()}\n`;

  const files: CodexContainerImportFile[] = [];
  const authPath = join(sourceCodexHome, 'auth.json');
  const instructionsPath = join(sourceCodexHome, 'AGENTS.md');
  if (existsSync(authPath)) files.push({ sourcePath: authPath, targetRelativePath: 'auth.json' });
  if (existsSync(instructionsPath)) {
    files.push({ sourcePath: instructionsPath, targetRelativePath: 'AGENTS.md' });
  }

  const directories: CodexContainerImportDirectory[] = [];
  const rulesPath = join(sourceCodexHome, 'rules');
  const skillsPath = join(sourceCodexHome, 'skills');
  if (existsSync(rulesPath)) {
    directories.push({
      sourcePath: rulesPath,
      targetRelativePath: 'rules',
      excludedDirectoryNames: [],
    });
  }
  if (existsSync(skillsPath)) {
    directories.push({
      sourcePath: skillsPath,
      targetRelativePath: 'skills',
      excludedDirectoryNames: [...SKILL_DEPENDENCY_DIRECTORIES],
    });
  }

  return {
    sourceCodexHome,
    ...(configToml === undefined ? {} : { configToml }),
    files,
    directories,
  };
}
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse, stringify, type TomlTableWithoutBigInt } from 'smol-toml';
