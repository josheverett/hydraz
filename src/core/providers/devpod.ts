import { execFileSync, spawn, type ExecFileSyncOptions } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { basename, dirname, join, posix, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import * as sea from 'node:sea';
import { shellEscape } from '../shell.js';
import { isVerbose, debugExec, debugOutput, debugTiming } from '../debug.js';
import { spawnWithHeartbeat } from './spawn-heartbeat.js';
import type { GitHubGitIdentity } from '../github/api.js';
import type { CodexContainerImportPlan } from '../codex/container-import.js';
import { PLAYWRIGHT_RUNTIME_ASSET } from './playwright-runtime.js';
import {
  buildExactDestinationExtractionCommand,
  buildFilesExtractionCommand,
  buildTarArguments,
  streamTarToSsh,
} from './tar-ssh-transfer.js';

export interface DevPodWorkspace {
  name: string;
  sourceDir: string;
}

export interface DevPodCheckResult {
  available: boolean;
  version?: string;
  error?: string;
}

const EXEC_OPTIONS: ExecFileSyncOptions = { stdio: 'pipe', timeout: 120_000 };
const SEA_RUNNER_ASSET = 'core/codex/runner.js';

let cachedSeaDistRoot: string | null = null;

export interface SeaDistRootOptions {
  isSea?: () => boolean;
  getAsset?: (key: string, encoding?: 'utf8') => string | ArrayBuffer | Uint8Array;
  tmpDir?: () => string;
  mkdtemp?: (prefix: string) => string;
  mkdir?: typeof mkdirSync;
  writeFile?: typeof writeFileSync;
}

export function checkDevPodAvailability(): DevPodCheckResult {
  debugExec('devpod', ['version']);
  const start = Date.now();
  try {
    const output = execFileSync('devpod', ['version'], { ...EXEC_OPTIONS, encoding: 'utf-8' });
    debugOutput('devpod version stdout', output);
    debugTiming('devpod version', Date.now() - start);
    return { available: true, version: output.trim() };
  } catch {
    debugTiming('devpod version (failed)', Date.now() - start);
    return { available: false, error: 'DevPod CLI is not available on PATH' };
  }
}

export function checkDockerAvailability(): boolean {
  debugExec('docker', ['info']);
  const start = Date.now();
  try {
    execFileSync('docker', ['info'], EXEC_OPTIONS);
    debugTiming('docker info', Date.now() - start);
    return true;
  } catch {
    debugTiming('docker info (failed)', Date.now() - start);
    return false;
  }
}

export function hasDevcontainerJson(repoDir: string): boolean {
  return existsSync(join(repoDir, '.devcontainer', 'devcontainer.json'));
}

export interface DevcontainerPlatformCheck {
  ok: boolean;
  forced?: string;
  host?: string;
  message?: string;
}

export function checkDevcontainerPlatform(repoDir: string, hostArch?: string): DevcontainerPlatformCheck {
  const devcontainerPath = join(repoDir, '.devcontainer', 'devcontainer.json');
  if (!existsSync(devcontainerPath)) {
    return { ok: true };
  }

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(readFileSync(devcontainerPath, 'utf-8'));
  } catch {
    return { ok: true };
  }

  const runArgs = config.runArgs;
  if (!Array.isArray(runArgs)) {
    return { ok: true };
  }

  const platformArg = runArgs.find(
    (arg): arg is string => typeof arg === 'string' && arg.startsWith('--platform='),
  );
  if (!platformArg) {
    return { ok: true };
  }

  const forced = platformArg.slice('--platform='.length);
  const arch = hostArch ?? process.arch;
  const host = arch === 'arm64' ? 'linux/arm64' : 'linux/amd64';

  if (forced !== host) {
    return {
      ok: false,
      forced,
      host,
      message:
        `devcontainer.json forces --platform=${forced} via runArgs, but this host is ${host}. ` +
        `DevPod builds images for the host architecture, creating a build/run platform mismatch. ` +
        `Remove "--platform=${forced}" from runArgs in .devcontainer/devcontainer.json.`,
    };
  }

  return { ok: true, forced, host };
}

export async function devpodUp(
  source: string,
  workspaceName: string,
  provider?: string,
  branch?: string,
  onHeartbeat?: (label: string, elapsedMs: number) => void,
  env?: Record<string, string>,
  providerOptions?: Record<string, string>,
): Promise<void> {
  const devpodSource = branch ? `${source}@${branch}` : source;
  const args = ['up', devpodSource, '--ide', 'none', '--id', workspaceName, '--git-clone-strategy', 'shallow'];
  if (provider) {
    args.push('--provider', provider);
  }
  for (const [key, value] of Object.entries(providerOptions ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    args.push('--provider-option', `${key}=${value}`);
  }

  let envFilePath: string | undefined;
  if (env && Object.keys(env).length > 0) {
    envFilePath = join(tmpdir(), `hydraz-env-${workspaceName}`);
    const content = Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n');
    writeFileSync(envFilePath, content, { mode: 0o600 });
    args.push('--workspace-env-file', envFilePath);
  }

  if (isVerbose()) {
    args.push('--debug');
  }
  debugExec('devpod', args);
  const start = Date.now();
  const spawnEnv = env ? { ...process.env, ...env } : undefined;
  try {
    await spawnWithHeartbeat('devpod', args, { timeout: 900_000, env: spawnEnv }, {
      label: 'DevPod provisioning',
      intervalMs: 15_000,
      onHeartbeat: onHeartbeat ?? (() => {}),
      onStdoutLine: isVerbose() ? (line) => debugOutput('devpod up stdout', line) : undefined,
    });
    debugTiming('devpod up', Date.now() - start);
  } finally {
    if (envFilePath) {
      try { unlinkSync(envFilePath); } catch { /* best-effort cleanup */ }
    }
  }
}

export function devpodDelete(workspaceName: string, force?: boolean): void {
  const args = force
    ? ['delete', '--force', workspaceName]
    : ['delete', workspaceName];
  debugExec('devpod', args);
  const start = Date.now();
  execFileSync('devpod', args, EXEC_OPTIONS);
  debugTiming('devpod delete', Date.now() - start);
}

export interface DevPodListEntry {
  name: string;
  status: string;
}

export function devpodList(): DevPodListEntry[] {
  debugExec('devpod', ['list', '--output', 'json']);
  const start = Date.now();
  try {
    const output = execFileSync('devpod', ['list', '--output', 'json'], {
      ...EXEC_OPTIONS,
      encoding: 'utf-8',
    });
    debugTiming('devpod list', Date.now() - start);

    const parsed = JSON.parse(output);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((entry: Record<string, unknown>) => typeof entry.id === 'string')
      .map((entry: Record<string, unknown>) => ({
        name: entry.id as string,
        status: typeof entry.status === 'string' ? entry.status : 'Unknown',
      }));
  } catch {
    debugTiming('devpod list (failed)', Date.now() - start);
    return [];
  }
}

export function devpodStatus(workspaceName: string): 'Running' | 'Stopped' | 'NotFound' {
  debugExec('devpod', ['status', workspaceName]);
  const start = Date.now();
  try {
    const output = execFileSync('devpod', ['status', workspaceName], {
      ...EXEC_OPTIONS,
      encoding: 'utf-8',
    });
    debugOutput('devpod status stdout', output);
    debugTiming('devpod status', Date.now() - start);
    if (output.includes('Running')) return 'Running';
    return 'Stopped';
  } catch {
    debugTiming('devpod status (failed)', Date.now() - start);
    return 'NotFound';
  }
}

export function buildSshCommand(workspaceName: string, command: string): { cmd: string; args: string[] } {
  return {
    cmd: 'ssh',
    args: [`${workspaceName}.devpod`, command],
  };
}

export function sshExec(workspaceName: string, command: string): string {
  debugExec('ssh', [`${workspaceName}.devpod`, command]);
  const start = Date.now();
  const output = execFileSync('ssh', [`${workspaceName}.devpod`, command], {
    ...EXEC_OPTIONS,
    encoding: 'utf-8',
  });
  debugOutput('ssh stdout', output);
  debugTiming('sshExec', Date.now() - start);
  return output;
}

export interface SshStreamOptions {
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export function sshStream(
  workspaceName: string,
  command: string,
  options: SshStreamOptions = {},
): Promise<void> {
  debugExec('ssh', [`${workspaceName}.devpod`, command]);
  const child = spawn('ssh', [`${workspaceName}.devpod`, command], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  child.stdout?.on('data', (chunk) => {
    stdout.write(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    stderr.write(chunk);
  });

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    child.once('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`SSH exited with code ${code ?? 'unknown'}`));
      }
    });
  });
}

export function getContainerHome(workspaceName: string): string {
  return sshExec(workspaceName, 'echo $HOME').trim();
}

export function devpodSsh(workspaceName: string): Promise<number> {
  debugExec('devpod', ['ssh', workspaceName]);
  const child = spawn('devpod', ['ssh', workspaceName], { stdio: 'inherit' });

  return new Promise<number>((resolve, reject) => {
    child.on('close', (code) => {
      resolve(code ?? 1);
    });
    child.on('error', (err) => {
      reject(err);
    });
  });
}

export function createWorktreeInContainer(
  workspaceName: string,
  containerRepoPath: string,
  branchName: string,
  sessionId: string,
): string {
  const worktreePath = `/tmp/hydraz-worktrees/${sessionId}`;
  const command = `mkdir -p /tmp/hydraz-worktrees && cd ${shellEscape(containerRepoPath)} && git worktree add -b ${shellEscape(branchName)} ${shellEscape(worktreePath)}`;
  debugExec('ssh', [`${workspaceName}.devpod`, command]);
  const start = Date.now();
  execFileSync('ssh', [`${workspaceName}.devpod`, command], EXEC_OPTIONS);
  debugTiming('createWorktreeInContainer', Date.now() - start);
  return worktreePath;
}

export function copyWorktreeIncludesInContainer(
  workspaceName: string,
  containerRepoPath: string,
  containerWorktreePath: string,
  files: string[],
): void {
  if (files.length === 0) {
    return;
  }

  const command = [
    'set -eu',
    `cd ${shellEscape(containerRepoPath)}`,
  ];
  for (const file of files) {
    const destDir = `${containerWorktreePath}/${posix.dirname(file)}`;
    const destFile = `${containerWorktreePath}/${file}`;
    command.push(`mkdir -p ${shellEscape(destDir)}`);
    command.push(`cp -- ${shellEscape(file)} ${shellEscape(destFile)}`);
  }
  const joined = command.join('\n');
  debugExec('ssh', [`${workspaceName}.devpod`, joined]);
  const start = Date.now();
  execFileSync('ssh', [`${workspaceName}.devpod`, joined], EXEC_OPTIONS);
  debugTiming('copyWorktreeIncludesInContainer', Date.now() - start);
}

export function configureGitIdentityInContainer(
  workspaceName: string,
  containerWorktreePath: string,
  identity: GitHubGitIdentity,
): void {
  const command = [
    'set -eu',
    `cd ${shellEscape(containerWorktreePath)}`,
    `git config user.name ${shellEscape(identity.name)}`,
    `git config user.email ${shellEscape(identity.email)}`,
  ].join('\n');
  debugExec('ssh', [`${workspaceName}.devpod`, command]);
  const start = Date.now();
  execFileSync('ssh', [`${workspaceName}.devpod`, command], EXEC_OPTIONS);
  debugTiming('configureGitIdentityInContainer', Date.now() - start);
}

export function verifyBranchPushed(
  workspaceName: string,
  worktreePath: string,
  branchName: string,
): boolean {
  const sshArgs = [
    `${workspaceName}.devpod`,
    `cd ${shellEscape(worktreePath)} && git ls-remote --heads origin ${shellEscape(branchName)}`,
  ];
  debugExec('ssh', sshArgs);
  const start = Date.now();
  try {
    const output = execFileSync('ssh', sshArgs, { ...EXEC_OPTIONS, encoding: 'utf-8' });
    debugOutput('verifyBranchPushed stdout', output);
    debugTiming('verifyBranchPushed', Date.now() - start);
    return output.trim().length > 0;
  } catch {
    debugTiming('verifyBranchPushed (failed)', Date.now() - start);
    return false;
  }
}

export function getDistRoot(): string {
  const seaDistRoot = resolveSeaDistRoot();
  if (seaDistRoot) return seaDistRoot;

  try {
    const thisFile = fileURLToPath(import.meta.url);
    return resolve(dirname(thisFile), '..', '..');
  } catch {
    throw new Error('Cannot determine dist root: import.meta.url unavailable (SEA binary does not support container mode)');
  }
}

export function resolveSeaDistRoot(options: SeaDistRootOptions = {}): string | null {
  const isSea = options.isSea ?? (() => sea.isSea());
  if (!isSea()) return null;

  if (!options.isSea && cachedSeaDistRoot) {
    return cachedSeaDistRoot;
  }

  const root = (options.mkdtemp ?? mkdtempSync)(join(options.tmpDir?.() ?? tmpdir(), 'hydraz-sea-dist-'));
  const runnerDir = join(root, 'core', 'codex');
  const runnerPath = join(runnerDir, 'runner.js');
  const runtimeDir = join(root, 'runtime');
  const runtimePath = join(root, PLAYWRIGHT_RUNTIME_ASSET);
  const getAsset = options.getAsset ?? ((key: string, encoding?: 'utf8') => (
    encoding === undefined ? sea.getAsset(key) : sea.getAsset(key, encoding)
  ));
  const runnerAsset = getAsset(SEA_RUNNER_ASSET, 'utf8');
  const runnerSource = typeof runnerAsset === 'string'
    ? runnerAsset
    : Buffer.from(runnerAsset instanceof ArrayBuffer ? new Uint8Array(runnerAsset) : runnerAsset).toString('utf8');

  (options.mkdir ?? mkdirSync)(runnerDir, { recursive: true });
  (options.writeFile ?? writeFileSync)(runnerPath, runnerSource, { mode: 0o600 });
  const runtimeAsset = getAsset(PLAYWRIGHT_RUNTIME_ASSET);
  const runtimeBytes = Buffer.from(
    runtimeAsset instanceof ArrayBuffer
      ? new Uint8Array(runtimeAsset)
      : runtimeAsset,
  );
  (options.mkdir ?? mkdirSync)(runtimeDir, { recursive: true });
  (options.writeFile ?? writeFileSync)(runtimePath, runtimeBytes, { mode: 0o600 });

  if (!options.isSea) {
    cachedSeaDistRoot = root;
  }

  return root;
}

export async function scpToContainer(
  workspaceName: string,
  localPath: string,
  remotePath: string,
  onHeartbeat?: (label: string, elapsedMs: number) => void,
): Promise<void> {
  const isFile = existsSync(localPath) && !statSync(localPath).isDirectory();
  const archivedEntry = isFile ? basename(localPath) : undefined;
  const tarArgs = buildTarArguments(
    isFile ? dirname(localPath) : localPath,
    [archivedEntry ?? '.'],
  );
  const remoteCommand = buildExactDestinationExtractionCommand(
    remotePath,
    archivedEntry,
    !isFile,
  );
  const start = Date.now();
  await streamTarToSsh({
    workspaceName,
    tarArgs,
    remoteCommand,
    onHeartbeat,
  });
  debugTiming('scpToContainer', Date.now() - start);
}

export async function stageCodexContainerImport(
  workspaceName: string,
  codexHome: string,
  plan: CodexContainerImportPlan,
  onHeartbeat?: (label: string, elapsedMs: number) => void,
): Promise<void> {
  sshExec(workspaceName, `mkdir -p ${shellEscape(codexHome)}`);

  let generatedConfigDir: string | undefined;
  try {
    if (plan.configToml !== undefined) {
      generatedConfigDir = mkdtempSync(join(tmpdir(), 'hydraz-codex-config-'));
      const generatedConfigPath = join(generatedConfigDir, 'config.toml');
      writeFileSync(generatedConfigPath, plan.configToml, { mode: 0o600 });
      await scpToContainer(
        workspaceName,
        generatedConfigPath,
        posix.join(codexHome, 'config.toml'),
        onHeartbeat,
      );
    }

    for (const file of plan.files) {
      await scpToContainer(
        workspaceName,
        file.sourcePath,
        posix.join(codexHome, file.targetRelativePath),
        onHeartbeat,
      );
    }

    for (const directory of plan.directories) {
      await scpCodexDirectoryToContainer(
        workspaceName,
        directory.sourcePath,
        posix.join(codexHome, directory.targetRelativePath),
        directory.excludedDirectoryNames,
        onHeartbeat,
      );
    }
  } finally {
    if (generatedConfigDir !== undefined) {
      rmSync(generatedConfigDir, { recursive: true, force: true });
    }
  }
}

async function scpCodexDirectoryToContainer(
  workspaceName: string,
  localPath: string,
  remotePath: string,
  excludedDirectoryNames: readonly string[],
  onHeartbeat?: (label: string, elapsedMs: number) => void,
): Promise<void> {
  const tarArgs = buildTarArguments(localPath, ['.'], excludedDirectoryNames);
  const remoteCommand = buildExactDestinationExtractionCommand(remotePath, undefined);
  const start = Date.now();
  await streamTarToSsh({
    workspaceName,
    tarArgs,
    remoteCommand,
    onHeartbeat,
  });
  debugTiming('stageCodexContainerImport', Date.now() - start);
}

export async function scpFilesToContainer(
  workspaceName: string,
  hostRepoRoot: string,
  containerRepoPath: string,
  files: string[],
): Promise<void> {
  if (files.length === 0) {
    return;
  }

  const tarArgs = buildTarArguments(hostRepoRoot, files);
  const remoteCommand = buildFilesExtractionCommand(containerRepoPath, files);
  const start = Date.now();
  await streamTarToSsh({
    workspaceName,
    tarArgs,
    remoteCommand,
    timeoutMs: 120_000,
  });
  debugTiming('scpFilesToContainer', Date.now() - start);
}

export function verifyCodexInContainer(workspaceName: string): DevPodCheckResult {
  debugExec('ssh', [`${workspaceName}.devpod`, 'codex --version']);
  const start = Date.now();
  try {
    const output = execFileSync('ssh', [`${workspaceName}.devpod`, 'codex --version'], {
      ...EXEC_OPTIONS,
      encoding: 'utf-8',
    });
    debugOutput('codex --version stdout', output);
    debugTiming('verifyCodexInContainer', Date.now() - start);
    return { available: true, version: output.trim() };
  } catch {
    debugTiming('verifyCodexInContainer (failed)', Date.now() - start);
    return {
      available: false,
      error: 'Codex CLI is not available inside the container. Ensure your devcontainer includes Codex.',
    };
  }
}
