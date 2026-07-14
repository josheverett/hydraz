import { posix } from 'node:path';
import { debugExec, debugTiming } from '../debug.js';
import { shellEscape } from '../shell.js';
import { sshExec } from './devpod.js';
import { PLAYWRIGHT_RUNTIME_ASSET, PLAYWRIGHT_VERSION } from './playwright-runtime.js';
import { spawnWithHeartbeat } from './spawn-heartbeat.js';

export interface PlaywrightContainerRuntime {
  runtimeRoot: string;
  browsersPath: string;
  binDir: string;
}

export async function ensurePlaywrightContainerRuntime(
  workspaceName: string,
  containerHome: string,
  onHeartbeat: (label: string, elapsedMs: number) => void = () => {},
): Promise<PlaywrightContainerRuntime> {
  const hydrazHome = posix.join(containerHome, '.hydraz');
  const runtimeRoot = posix.join(hydrazHome, 'runtimes', 'playwright', PLAYWRIGHT_VERSION);
  const browsersPath = posix.join(hydrazHome, 'browsers', `playwright-${PLAYWRIGHT_VERSION}`);
  const binDir = posix.join(hydrazHome, 'bin');
  const markerPath = posix.join(runtimeRoot, '.hydraz-ready');
  const cliPath = posix.join(runtimeRoot, 'node_modules', 'playwright', 'cli.js');
  const executablePath = posix.join(runtimeRoot, 'node_modules', '.bin', 'playwright');
  const smokePath = posix.join(runtimeRoot, 'smoke.mjs');
  const exposedExecutable = posix.join(binDir, 'playwright');
  const browserEnv = `PLAYWRIGHT_BROWSERS_PATH=${shellEscape(browsersPath)}`;
  const runtime = { runtimeRoot, browsersPath, binDir };

  const healthCommand = [
    'set -eu',
    `if test -f ${shellEscape(markerPath)} && test -f ${shellEscape(cliPath)} && test -x ${shellEscape(executablePath)} && test -f ${shellEscape(smokePath)}; then`,
    `  if ${browserEnv} node ${shellEscape(smokePath)} >/dev/null 2>&1; then`,
    `    if mkdir -p ${shellEscape(binDir)} && rm -rf ${shellEscape(exposedExecutable)} && ln -s ${shellEscape(executablePath)} ${shellEscape(exposedExecutable)} && test -x ${shellEscape(exposedExecutable)}; then`,
    "      printf '%s' healthy",
    '    else',
    "      printf '%s' unhealthy",
    '    fi',
    '  else',
    "    printf '%s' unhealthy",
    '  fi',
    'else',
    "  printf '%s' unhealthy",
    'fi',
  ].join('\n');
  if (sshExec(workspaceName, healthCommand).trim() === 'healthy') {
    return runtime;
  }

  const archivePath = posix.join('/tmp/hydraz-dist', PLAYWRIGHT_RUNTIME_ASSET);
  const provisionCommand = [
    'set -eu',
    `rm -rf ${shellEscape(markerPath)}`,
    `rm -rf ${shellEscape(runtimeRoot)}`,
    `mkdir -p ${shellEscape(runtimeRoot)} ${shellEscape(browsersPath)} ${shellEscape(binDir)}`,
    `tar -xzf ${shellEscape(archivePath)} -C ${shellEscape(runtimeRoot)}`,
    `test -x ${shellEscape(executablePath)}`,
    `${browserEnv} node ${shellEscape(cliPath)} install --with-deps chromium`,
    `${browserEnv} node ${shellEscape(smokePath)}`,
    `rm -rf ${shellEscape(exposedExecutable)}`,
    `ln -s ${shellEscape(executablePath)} ${shellEscape(exposedExecutable)}`,
    `test -x ${shellEscape(exposedExecutable)}`,
    `touch ${shellEscape(markerPath)}`,
  ].join('\n');

  const sshTarget = `${workspaceName}.devpod`;
  debugExec('ssh', [sshTarget, provisionCommand]);
  const start = Date.now();
  await spawnWithHeartbeat(
    'ssh',
    [sshTarget, provisionCommand],
    { timeout: 900_000 },
    {
      label: 'Provisioning Playwright',
      intervalMs: 15_000,
      onHeartbeat,
    },
  );
  debugTiming('ensurePlaywrightContainerRuntime', Date.now() - start);

  return runtime;
}
