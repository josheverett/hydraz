import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CodexRunnerOptions } from './runner.js';
import {
  loadRunnerOptionsFile,
  RUNNER_OPTIONS_FILE_ENV,
  RUNNER_OPTIONS_FILENAME,
  writeRunnerOptionsFile,
} from './runner-options.js';

function makeOptions(goal: string): CodexRunnerOptions {
  return {
    attemptId: 'attempt-1',
    repoRoot: '/repo',
    sessionId: 'session-1',
    sessionName: 'large-goal',
    branchName: 'hydraz/large-goal',
    goal,
    workingDirectory: '/repo',
    codexDir: '/tmp/codex',
    config: {
      executionTarget: 'cloud',
      branchNaming: { prefix: 'hydraz/' },
      github: { token: 'github_pat_bootstrap_test' },
      codex: {
        command: 'codex',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'max',
        speed: 'fast',
        sandbox: 'workspace-write',
        search: false,
      },
      retention: { keepTranscripts: false, keepTestLogs: false },
      displayVerbosity: 'compact',
    },
  };
}

describe('runner options file', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'hydraz-runner-options-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes a 256 KiB payload to a mode-0600 file', () => {
    const options = makeOptions(`Goal ' "$() \n${'x'.repeat(256 * 1024)}`);

    const path = writeRunnerOptionsFile(root, options);

    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(options);
    if (process.platform !== 'win32') {
      expect((statSync(path).mode & 0o777)).toBe(0o600);
      expect((statSync(root).mode & 0o777)).toBe(0o700);
    }
  });

  it('loads and immediately deletes the bootstrap file', () => {
    const options = makeOptions('Do it');
    const path = join(root, RUNNER_OPTIONS_FILENAME);
    writeFileSync(path, JSON.stringify(options), { mode: 0o600 });

    const loaded = loadRunnerOptionsFile({ [RUNNER_OPTIONS_FILE_ENV]: path });

    expect(loaded).toEqual(options);
    expect(existsSync(path)).toBe(false);
  });

  it('deletes corrupt input and reports a generic error', () => {
    const path = join(root, RUNNER_OPTIONS_FILENAME);
    writeFileSync(path, '{"goal":"TOP_SECRET_GOAL","token":"github_pat_corrupt_test"', {
      mode: 0o600,
    });

    expect(() => loadRunnerOptionsFile({ [RUNNER_OPTIONS_FILE_ENV]: path })).toThrow(
      'Failed to load runner options.',
    );
    expect(existsSync(path)).toBe(false);
    try {
      loadRunnerOptionsFile({ [RUNNER_OPTIONS_FILE_ENV]: path });
    } catch (error) {
      expect(String(error)).not.toContain('TOP_SECRET_GOAL');
      expect(String(error)).not.toContain('github_pat_corrupt_test');
    }
  });

  it('rejects a missing bootstrap file environment variable', () => {
    expect(() => loadRunnerOptionsFile({})).toThrow('Missing runner options file.');
  });

  it('does not fall back to inline runner options JSON', () => {
    expect(() => loadRunnerOptionsFile({
      HYDRAZ_CODEX_RUNNER_OPTIONS: JSON.stringify(makeOptions('inline')),
    })).toThrow('Missing runner options file.');
  });
});
