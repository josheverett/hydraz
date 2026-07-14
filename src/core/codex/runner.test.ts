import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./delivery.js', () => ({
  finalizeCodexDelivery: vi.fn(async () => ({
    action: 'preserved',
    committed: false,
    pushed: true,
    message: 'Workspace preserved after push',
  })),
}));

import { finalizeCodexDelivery } from './delivery.js';
import { createDefaultConfig } from '../config/schema.js';
import {
  CODEX_EVENTS_FILE,
  CODEX_FINAL_FILE,
  CODEX_RESULT_FILE,
  CODEX_STDERR_FILE,
  executeCodexRunner,
} from './runner.js';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'hydraz-codex-runner-test-'));
  tempRoots.push(root);
  return root;
}

function makeFakeCodex(root: string, body: string): string {
  const file = join(root, 'fake-codex.cjs');
  writeFileSync(file, `#!/usr/bin/env node\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

function makeOptions(root: string, codexCommand: string) {
  const config = createDefaultConfig();
  config.codex.command = codexCommand;
  return {
    repoRoot: root,
    sessionId: 'session-1',
    sessionName: 'v3',
    goal: 'Implement v3',
    workingDirectory: root,
    codexDir: join(root, 'codex'),
    config,
  };
}

describe('executeCodexRunner', () => {
  it('runs codex exec, captures thread id, and writes artifacts', async () => {
    const root = makeTempRoot();
    const codex = makeFakeCodex(root, `
const fs = require('node:fs');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('-o');
if (outputIndex >= 0) fs.writeFileSync(args[outputIndex + 1], 'final message');
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }));
console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 2 } }));
console.error('stderr note');
`);

    const result = await executeCodexRunner(makeOptions(root, codex));

    expect(result.success).toBe(true);
    expect(result.threadId).toBe('thread-1');
    expect(existsSync(join(root, 'codex', CODEX_EVENTS_FILE))).toBe(true);
    expect(readFileSync(join(root, 'codex', CODEX_STDERR_FILE), 'utf-8')).toContain('stderr note');
    expect(readFileSync(join(root, 'codex', CODEX_FINAL_FILE), 'utf-8')).toBe('final message');
    expect(JSON.parse(readFileSync(join(root, 'codex', CODEX_RESULT_FILE), 'utf-8'))).toMatchObject({
      success: true,
      threadId: 'thread-1',
      exitCode: 0,
    });
  });

  it('records a failed result when codex exits non-zero', async () => {
    const root = makeTempRoot();
    const codex = makeFakeCodex(root, `
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-fail' }));
console.error('boom');
process.exit(9);
`);

    const result = await executeCodexRunner(makeOptions(root, codex));

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(9);
    expect(result.threadId).toBe('thread-fail');
    expect(readFileSync(join(root, 'codex', CODEX_RESULT_FILE), 'utf-8')).toContain('"success": false');
  });

  it('sets the explicit container CODEX_HOME for the Codex child', async () => {
    const root = makeTempRoot();
    const envFile = join(root, 'codex-home.txt');
    const codex = makeFakeCodex(root, `
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(envFile)}, JSON.stringify({
  codexHome: process.env.CODEX_HOME ?? '',
  path: process.env.PATH ?? '',
  browsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH ?? '',
}));
`);

    const previousPath = process.env.PATH;
    const previousBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
    const inheritedPath = `/home/codex/.hydraz/bin:${dirname(process.execPath)}:/usr/bin`;
    process.env.PATH = inheritedPath;
    process.env.PLAYWRIGHT_BROWSERS_PATH = '/home/codex/.hydraz/browsers/playwright-1.61.1';

    try {
      await executeCodexRunner({
        ...makeOptions(root, codex),
        codexHome: '/home/codex/.hydraz/codex-homes/session-1',
      });
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousBrowsersPath === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
      else process.env.PLAYWRIGHT_BROWSERS_PATH = previousBrowsersPath;
    }

    expect(JSON.parse(readFileSync(envFile, 'utf8'))).toEqual({
      codexHome: '/home/codex/.hydraz/codex-homes/session-1',
      path: inheritedPath,
      browsersPath: '/home/codex/.hydraz/browsers/playwright-1.61.1',
    });
  });

  it('uses codex exec resume when a resume thread id is supplied', async () => {
    const root = makeTempRoot();
    const argvFile = join(root, 'argv.json');
    const codex = makeFakeCodex(root, `
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify(process.argv.slice(2)));
const outputIndex = process.argv.indexOf('-o');
if (outputIndex >= 0) fs.writeFileSync(process.argv[outputIndex + 1], 'resumed');
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }));
`);
    const options = makeOptions(root, codex);

    await executeCodexRunner({
      ...options,
      resumeThreadId: 'thread-1',
      resumePrompt: 'Keep going',
    });

    expect(JSON.parse(readFileSync(argvFile, 'utf-8'))).toEqual([
      'exec',
      '--json',
      '--sandbox',
      'workspace-write',
      '-o',
      join(root, 'codex', CODEX_FINAL_FILE),
      'resume',
      'thread-1',
      'Keep going',
    ]);
  });

  it('passes the configured base branch into delivery', async () => {
    const root = makeTempRoot();
    const codex = makeFakeCodex(root, `
const fs = require('node:fs');
const outputIndex = process.argv.indexOf('-o');
if (outputIndex >= 0) fs.writeFileSync(process.argv[outputIndex + 1], 'final message');
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }));
`);
    const options = makeOptions(root, codex);

    await executeCodexRunner({
      ...options,
      branchName: 'hydraz/v3',
      baseBranch: 'staging',
      delivery: {
        enabled: true,
        createPullRequest: true,
        keepWorkspace: true,
      },
    });

    expect(finalizeCodexDelivery).toHaveBeenCalledWith(expect.objectContaining({
      session: expect.objectContaining({
        branchName: 'hydraz/v3',
        baseBranch: 'staging',
      }),
    }));
  });
});
