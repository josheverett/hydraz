import { execFileSync, spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PLAYWRIGHT_RUNTIME_ASSET,
  PLAYWRIGHT_VERSION,
  resolvePlaywrightRuntimeArchive,
} from './playwright-runtime.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hydraz-playwright-runtime-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('Playwright runtime asset', () => {
  it('resolves the packaged archive from a dist root', () => {
    const distRoot = makeTempDir();
    const archive = join(distRoot, PLAYWRIGHT_RUNTIME_ASSET);
    mkdirSync(dirname(archive), { recursive: true });
    writeFileSync(archive, 'archive');

    expect(resolvePlaywrightRuntimeArchive(distRoot)).toBe(archive);
  });

  it('fails with an actionable diagnostic when the packaged archive is missing', () => {
    const distRoot = makeTempDir();

    expect(() => resolvePlaywrightRuntimeArchive(distRoot)).toThrow(
      `Missing packaged Playwright ${PLAYWRIGHT_VERSION} runtime`,
    );
    expect(() => resolvePlaywrightRuntimeArchive(distRoot)).toThrow(
      /before using container or cloud mode/,
    );
  });

  it('builds an archive containing the pinned CLI and smoke script', () => {
    const outputDir = makeTempDir();
    const repoRoot = resolve(import.meta.dirname, '..', '..', '..');

    execFileSync(process.execPath, [join(repoRoot, 'scripts', 'build-playwright-runtime.mjs')], {
      cwd: repoRoot,
      env: { ...process.env, HYDRAZ_PLAYWRIGHT_RUNTIME_OUTPUT: outputDir },
      stdio: 'pipe',
    });

    const archive = join(outputDir, 'playwright-runtime.tar.gz');
    expect(existsSync(archive)).toBe(true);
    const listing = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' });
    expect(listing).toContain('node_modules/playwright/cli.js');
    expect(listing).toContain('node_modules/.bin/playwright');
    expect(listing).toContain('smoke.mjs');

    const manifest = execFileSync('tar', ['-xOzf', archive, './package.json'], { encoding: 'utf8' });
    expect(JSON.parse(manifest).dependencies.playwright).toBe(PLAYWRIGHT_VERSION);
    expect(readFileSync(join(repoRoot, 'packages', 'playwright-runtime', 'smoke.mjs'), 'utf8'))
      .toContain("from 'playwright'");

    const extractedDir = join(outputDir, 'extracted');
    mkdirSync(extractedDir);
    execFileSync('tar', ['-xzf', archive, '-C', extractedDir]);
    expect(
      readdirSync(join(extractedDir, 'node_modules'))
        .filter((entry) => !entry.startsWith('.'))
        .sort(),
    ).toEqual(['playwright', 'playwright-core']);
    const importProbe = spawnSync(
      process.execPath,
      ['-e', 'require(process.argv[1])', join(extractedDir, 'node_modules', 'playwright')],
      { encoding: 'utf8' },
    );
    expect(importProbe.status, importProbe.stderr).toBe(0);
    expect(() => accessSync(
      join(extractedDir, 'node_modules', '.bin', 'playwright'),
      constants.X_OK,
    )).not.toThrow();
  }, 20_000);
});
