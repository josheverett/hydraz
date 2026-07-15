import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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
  type CodexRunnerOptions,
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

function writeRollout(
  codexHome: string,
  threadId: string,
  items: Array<Record<string, unknown>>,
): string {
  const sessionsDir = join(codexHome, 'sessions', '2026', '07', '15');
  mkdirSync(sessionsDir, { recursive: true });
  const rolloutPath = join(sessionsDir, `rollout-${threadId}.jsonl`);
  writeFileSync(
    rolloutPath,
    items.map((item) => JSON.stringify(item)).join('\n') + '\n',
  );
  return rolloutPath;
}

function makeOptions(root: string, codexCommand: string): CodexRunnerOptions {
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
    const evidence = JSON.parse(
      readFileSync(join(root, 'codex', 'invocation.json'), 'utf-8'),
    ) as { spawnState: string; exitCode: number };

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(9);
    expect(result.threadId).toBe('thread-fail');
    expect(evidence.spawnState).toBe('exited');
    expect(evidence.exitCode).toBe(9);
    expect(readFileSync(join(root, 'codex', CODEX_RESULT_FILE), 'utf-8')).toContain('"success": false');
  });

  it('persists an attempt-bound failed result when Codex cannot spawn', async () => {
    const root = makeTempRoot();
    const options = makeOptions(root, join(root, 'missing-codex'));
    options.attemptId = 'attempt-spawn-failed';

    await expect(executeCodexRunner(options)).resolves.toMatchObject({
      attemptId: 'attempt-spawn-failed',
      success: false,
      exitCode: null,
      invocationEvidence: {
        attemptId: 'attempt-spawn-failed',
        spawnState: 'spawn-failed',
      },
    });

    const result = JSON.parse(
      readFileSync(join(root, 'codex', CODEX_RESULT_FILE), 'utf-8'),
    ) as Record<string, unknown>;
    expect(result).toMatchObject({
      attemptId: 'attempt-spawn-failed',
      success: false,
      exitCode: null,
      invocationEvidence: {
        attemptId: 'attempt-spawn-failed',
        spawnState: 'spawn-failed',
      },
    });
    expect(result['error']).toEqual(expect.stringContaining('missing-codex'));
    expect(result['invocationEvidence']).not.toHaveProperty('spawnedAt');
  });

  it('passes every managed model setting to codex exec', async () => {
    const root = makeTempRoot();
    const argvFile = join(root, 'argv.json');
    const codex = makeFakeCodex(root, `
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify(process.argv.slice(2)));
`);

    await executeCodexRunner(makeOptions(root, codex));

    const args = JSON.parse(readFileSync(argvFile, 'utf-8')) as string[];
    expect(args).toContain('gpt-5.6-sol');
    expect(args).toContain('model_reasoning_effort="ultra"');
    expect(args).toContain('features.fast_mode=true');
    expect(args).toContain('service_tier="priority"');
  });

  it('records the exact spawned argv without persisting the prompt', async () => {
    const root = makeTempRoot();
    const argvFile = join(root, 'argv.json');
    const codex = makeFakeCodex(root, `
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify(process.argv.slice(2)));
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-evidence' }));
`);
    const options = makeOptions(root, codex);
    options.goal = 'PROMPT_SECRET_7c493f';
    options.config.github.token = 'github_pat_evidence_secret';

    const result = await executeCodexRunner(options);

    const invocationPath = join(root, 'codex', 'invocation.json');
    const serialized = readFileSync(invocationPath, 'utf-8');
    const evidence = JSON.parse(serialized) as {
      version: number;
      mode: string;
      command: string;
      args: string[];
      promptOmitted: boolean;
      requested: {
        model: string;
        reasoningEffort: string;
        speed: string;
      };
      normalized: {
        fastMode: boolean;
        serviceTier: string;
      };
      preparedAt: string;
      spawnedAt: string;
      exitedAt: string;
      spawnState: string;
      threadId: string;
      exitCode: number;
    };
    const spawnedArgs = JSON.parse(readFileSync(argvFile, 'utf-8')) as string[];

    expect(evidence.version).toBe(1);
    expect(evidence.mode).toBe('exec');
    expect(evidence.command).toBe(codex);
    expect(evidence.args).toEqual(spawnedArgs.slice(0, -1));
    expect(evidence.promptOmitted).toBe(true);
    expect(evidence.requested).toEqual({
      model: 'gpt-5.6-sol',
      reasoningEffort: 'ultra',
      speed: 'fast',
    });
    expect(evidence.normalized).toEqual({
      fastMode: true,
      serviceTier: 'priority',
    });
    expect(evidence.preparedAt).toEqual(expect.any(String));
    expect(evidence.spawnedAt).toEqual(expect.any(String));
    expect(evidence.exitedAt).toEqual(expect.any(String));
    expect(evidence.spawnState).toBe('exited');
    expect(evidence.threadId).toBe('thread-evidence');
    expect(evidence.exitCode).toBe(0);
    expect(result.invocationEvidence).toEqual(evidence);
    expect(spawnedArgs.at(-1)).toContain('PROMPT_SECRET_7c493f');
    expect(serialized).not.toContain('PROMPT_SECRET_7c493f');
    expect(serialized).not.toContain('github_pat_evidence_secret');
    expect(serialized).not.toContain('HYDRAZ_CODEX_RUNNER_OPTIONS');
    if (process.platform !== 'win32') {
      expect(statSync(invocationPath).mode & 0o777).toBe(0o600);
    }
  });

  it('cross-checks the latest Codex rollout turn context', async () => {
    const root = makeTempRoot();
    const threadId = 'thread-rollout-match';
    const codexHome = join(root, 'codex-home');
    const rolloutPath = writeRollout(codexHome, threadId, [
      {
        timestamp: '2026-07-15T00:00:00.000Z',
        type: 'turn_context',
        payload: { model: 'gpt-5.5', effort: 'medium' },
      },
      {
        timestamp: '2026-07-15T00:00:01.000Z',
        type: 'turn_context',
        payload: { model: 'gpt-5.6-sol', effort: 'ultra' },
      },
    ]);
    const codex = makeFakeCodex(
      root,
      `console.log(${JSON.stringify(JSON.stringify({ type: 'thread.started', thread_id: threadId }))});`,
    );
    const options = makeOptions(root, codex);
    options.codexHome = codexHome;

    const result = await executeCodexRunner(options);

    expect(result.rolloutVerification).toEqual(expect.objectContaining({
      status: 'matched',
      sourcePath: rolloutPath,
      observed: {
        model: 'gpt-5.6-sol',
        reasoningEffort: 'ultra',
      },
      checks: {
        model: 'matched',
        reasoningEffort: 'matched',
        serviceTier: 'unavailable',
      },
    }));
  });

  it('reports rollout mismatches without failing the run', async () => {
    const root = makeTempRoot();
    const threadId = 'thread-rollout-mismatch';
    const codexHome = join(root, 'codex-home');
    writeRollout(codexHome, threadId, [
      {
        timestamp: '2026-07-15T00:00:00.000Z',
        type: 'turn_context',
        payload: {
          model: 'gpt-5.5',
          effort: 'medium',
          service_tier: 'default',
        },
      },
    ]);
    const codex = makeFakeCodex(
      root,
      `console.log(${JSON.stringify(JSON.stringify({ type: 'thread.started', thread_id: threadId }))});`,
    );
    const options = makeOptions(root, codex);
    options.codexHome = codexHome;

    const result = await executeCodexRunner(options);

    expect(result.success).toBe(true);
    expect(result.rolloutVerification).toEqual(expect.objectContaining({
      status: 'mismatched',
      observed: {
        model: 'gpt-5.5',
        reasoningEffort: 'medium',
        serviceTier: 'default',
      },
      checks: {
        model: 'mismatched',
        reasoningEffort: 'mismatched',
        serviceTier: 'mismatched',
      },
    }));
  });

  it('reports rollout verification as unavailable when no rollout exists', async () => {
    const root = makeTempRoot();
    const codex = makeFakeCodex(
      root,
      `console.log(${JSON.stringify(JSON.stringify({
        type: 'thread.started',
        thread_id: 'thread-rollout-missing',
      }))});`,
    );
    const options = makeOptions(root, codex);
    options.codexHome = join(root, 'codex-home');

    const result = await executeCodexRunner(options);

    expect(result.success).toBe(true);
    expect(result.rolloutVerification).toEqual(expect.objectContaining({
      status: 'unavailable',
      checks: {
        model: 'unavailable',
        reasoningEffort: 'unavailable',
        serviceTier: 'unavailable',
      },
    }));
  });

  it.each([
    {
      name: 'inherits the ambient CODEX_HOME',
      codexHome: undefined,
      expectedCodexHome: '/home/codex/.codex',
    },
    {
      name: 'sets the explicit container CODEX_HOME',
      codexHome: '/home/codex/.hydraz/codex-homes/session-1',
      expectedCodexHome: '/home/codex/.hydraz/codex-homes/session-1',
    },
  ])('$name without forwarding runner bootstrap options', async ({ codexHome, expectedCodexHome }) => {
    const root = makeTempRoot();
    const envFile = join(root, 'codex-home.txt');
    const codex = makeFakeCodex(root, `
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(envFile)}, JSON.stringify({
  runnerOptions: process.env.HYDRAZ_CODEX_RUNNER_OPTIONS ?? null,
  codexHome: process.env.CODEX_HOME ?? '',
  ghToken: process.env.GH_TOKEN ?? '',
  githubToken: process.env.GITHUB_TOKEN ?? '',
  path: process.env.PATH ?? '',
  browsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH ?? '',
  passthrough: process.env.HYDRAZ_TEST_PASSTHROUGH ?? '',
}));
`);

    const previousRunnerOptions = process.env.HYDRAZ_CODEX_RUNNER_OPTIONS;
    const previousCodexHome = process.env.CODEX_HOME;
    const previousGhToken = process.env.GH_TOKEN;
    const previousGithubToken = process.env.GITHUB_TOKEN;
    const previousPath = process.env.PATH;
    const previousBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
    const previousPassthrough = process.env.HYDRAZ_TEST_PASSTHROUGH;
    const runnerOptions = JSON.stringify({ config: { github: { token: 'github_pat_runner_test' } } });
    const inheritedPath = `/home/codex/.hydraz/bin:${dirname(process.execPath)}:/usr/bin`;
    process.env.HYDRAZ_CODEX_RUNNER_OPTIONS = runnerOptions;
    process.env.CODEX_HOME = '/home/codex/.codex';
    process.env.GH_TOKEN = 'github_pat_gh_test';
    process.env.GITHUB_TOKEN = 'github_pat_github_test';
    process.env.PATH = inheritedPath;
    process.env.PLAYWRIGHT_BROWSERS_PATH = '/home/codex/.hydraz/browsers/playwright-1.61.1';
    process.env.HYDRAZ_TEST_PASSTHROUGH = 'preserved';

    try {
      await executeCodexRunner({
        ...makeOptions(root, codex),
        ...(codexHome === undefined ? {} : { codexHome }),
      });

      expect(process.env.HYDRAZ_CODEX_RUNNER_OPTIONS).toBe(runnerOptions);
    } finally {
      if (previousRunnerOptions === undefined) delete process.env.HYDRAZ_CODEX_RUNNER_OPTIONS;
      else process.env.HYDRAZ_CODEX_RUNNER_OPTIONS = previousRunnerOptions;
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
      if (previousGhToken === undefined) delete process.env.GH_TOKEN;
      else process.env.GH_TOKEN = previousGhToken;
      if (previousGithubToken === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = previousGithubToken;
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousBrowsersPath === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
      else process.env.PLAYWRIGHT_BROWSERS_PATH = previousBrowsersPath;
      if (previousPassthrough === undefined) delete process.env.HYDRAZ_TEST_PASSTHROUGH;
      else process.env.HYDRAZ_TEST_PASSTHROUGH = previousPassthrough;
    }

    expect(JSON.parse(readFileSync(envFile, 'utf8'))).toEqual({
      runnerOptions: null,
      codexHome: expectedCodexHome,
      ghToken: 'github_pat_gh_test',
      githubToken: 'github_pat_github_test',
      path: inheritedPath,
      browsersPath: '/home/codex/.hydraz/browsers/playwright-1.61.1',
      passthrough: 'preserved',
    });
  });

  it('redacts secrets from Codex JSONL events while preserving thread tracking', async () => {
    const root = makeTempRoot();
    const codex = makeFakeCodex(root, `
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-redacted' }));
console.log(JSON.stringify({
  type: 'item.completed',
  item: {
    type: 'command_execution',
    aggregated_output: 'ordinary before HYDRAZ_CODEX_RUNNER_OPTIONS={"config":{"github":{"token":"github_pat_stdout_test"}}} ordinary after',
  },
}));
`);

    const result = await executeCodexRunner(makeOptions(root, codex));
    const lines = readFileSync(join(root, 'codex', CODEX_EVENTS_FILE), 'utf-8').trim().split('\n');
    const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const serialized = JSON.stringify(events);

    expect(result.threadId).toBe('thread-redacted');
    expect(events).toHaveLength(2);
    expect(serialized).toContain('ordinary before');
    expect(serialized).toContain('ordinary after');
    expect(serialized).toContain('[REDACTED]');
    expect(serialized).not.toContain('github_pat_stdout_test');
  });

  it('redacts a stderr secret split across process chunks', async () => {
    const root = makeTempRoot();
    const codex = makeFakeCodex(root, `
process.stderr.write('ordinary before github_pat_stderr_');
setTimeout(() => {
  process.stderr.write('split_test ordinary after');
}, 25);
`);

    await executeCodexRunner(makeOptions(root, codex));

    expect(readFileSync(join(root, 'codex', CODEX_STDERR_FILE), 'utf-8')).toBe(
      'ordinary before [REDACTED] ordinary after',
    );
  });

  it('redacts secrets from the retained final response', async () => {
    const root = makeTempRoot();
    const codex = makeFakeCodex(root, `
const fs = require('node:fs');
const outputIndex = process.argv.indexOf('-o');
if (outputIndex >= 0) {
  fs.writeFileSync(process.argv[outputIndex + 1], 'ordinary before github_pat_final_test ordinary after');
}
`);

    await executeCodexRunner(makeOptions(root, codex));

    expect(readFileSync(join(root, 'codex', CODEX_FINAL_FILE), 'utf-8')).toBe(
      'ordinary before [REDACTED] ordinary after',
    );
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

    const result = await executeCodexRunner({
      ...options,
      resumeThreadId: 'thread-1',
      resumePrompt: 'Keep going',
    });

    expect(JSON.parse(readFileSync(argvFile, 'utf-8'))).toEqual([
      'exec',
      '--json',
      '--sandbox',
      'workspace-write',
      '--model',
      'gpt-5.6-sol',
      '-c',
      'model_reasoning_effort="ultra"',
      '-c',
      'features.fast_mode=true',
      '-c',
      'service_tier="priority"',
      '-o',
      join(root, 'codex', CODEX_FINAL_FILE),
      'resume',
      'thread-1',
      'Keep going',
    ]);
    const serialized = readFileSync(join(root, 'codex', 'invocation.json'), 'utf-8');
    const evidence = JSON.parse(serialized) as {
      mode: string;
      args: string[];
      threadId: string;
    };
    expect(evidence.mode).toBe('resume');
    expect(evidence.args).toEqual(
      (JSON.parse(readFileSync(argvFile, 'utf-8')) as string[]).slice(0, -1),
    );
    expect(evidence.threadId).toBe('thread-1');
    expect(result.invocationEvidence).toEqual(evidence);
    expect(serialized).not.toContain('Keep going');
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
    options.config.github.token = 'github_pat_delivery_test';

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
      githubToken: 'github_pat_delivery_test',
      session: expect.objectContaining({
        branchName: 'hydraz/v3',
        baseBranch: 'staging',
      }),
    }));
  });
});
