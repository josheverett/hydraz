import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = join(repoRoot, 'packages', 'playwright-runtime');
const workspaceManifestPath = join(workspaceRoot, 'package.json');
const workspaceManifest = JSON.parse(readFileSync(workspaceManifestPath, 'utf8'));
const pinnedVersion = workspaceManifest.dependencies?.playwright;
if (typeof pinnedVersion !== 'string') {
  throw new Error('Playwright runtime workspace must pin a Playwright dependency');
}

const workspaceRequire = createRequire(workspaceManifestPath);
const playwrightManifestPath = realpathSync(workspaceRequire.resolve('playwright/package.json'));
const playwrightManifest = JSON.parse(readFileSync(playwrightManifestPath, 'utf8'));
const playwrightRequire = createRequire(playwrightManifestPath);
const coreManifestPath = realpathSync(playwrightRequire.resolve('playwright-core/package.json'));
const coreManifest = JSON.parse(readFileSync(coreManifestPath, 'utf8'));
if (
  playwrightManifest.version !== pinnedVersion ||
  playwrightManifest.dependencies?.['playwright-core'] !== pinnedVersion ||
  coreManifest.version !== pinnedVersion
) {
  throw new Error(`Playwright runtime dependency mismatch; expected Playwright ${pinnedVersion}`);
}

const outputDir = process.env.HYDRAZ_PLAYWRIGHT_RUNTIME_OUTPUT
  ? resolve(process.env.HYDRAZ_PLAYWRIGHT_RUNTIME_OUTPUT)
  : join(repoRoot, 'dist', 'runtime');
const archivePath = join(outputDir, 'playwright-runtime.tar.gz');
const tempRoot = mkdtempSync(join(tmpdir(), 'hydraz-playwright-runtime-build-'));
const stagingDir = join(tempRoot, 'runtime');
const nodeModulesDir = join(stagingDir, 'node_modules');

try {
  mkdirSync(outputDir, { recursive: true });
  rmSync(archivePath, { force: true });
  mkdirSync(nodeModulesDir, { recursive: true });
  cpSync(dirname(playwrightManifestPath), join(nodeModulesDir, 'playwright'), {
    recursive: true,
    dereference: true,
  });
  cpSync(dirname(coreManifestPath), join(nodeModulesDir, 'playwright-core'), {
    recursive: true,
    dereference: true,
  });
  copyFileSync(workspaceManifestPath, join(stagingDir, 'package.json'));
  copyFileSync(join(workspaceRoot, 'smoke.mjs'), join(stagingDir, 'smoke.mjs'));
  const binDir = join(nodeModulesDir, '.bin');
  mkdirSync(binDir);
  symlinkSync('../playwright/cli.js', join(binDir, 'playwright'));

  execFileSync('tar', ['-czf', archivePath, '-C', stagingDir, '.'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
