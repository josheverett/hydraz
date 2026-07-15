import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { HydrazConfig } from '../config/schema.js';
import { readRepoPromptContent } from './repo-config.js';
import { buildCodexExecCommand, buildCodexResumeCommand, buildGoalPrompt } from './args.js';
import { parseCodexJsonLine } from './events.js';
import type { CodexDeliveryResult } from './delivery.js';
import { finalizeCodexDelivery } from './delivery.js';
import type { WorkspaceProvider } from '../providers/provider.js';
import type { GitHubGitIdentity } from '../github/api.js';
import { redactSecrets } from '../display/sanitize.js';
import {
  captureCodexRolloutCheckpoint,
  verifyCodexRollout,
  type CodexRolloutVerification,
} from './rollout.js';
import {
  CODEX_INVOCATION_FILE,
  createCodexInvocationRecorder,
  type CodexInvocationEvidence,
} from './invocation.js';

export { CODEX_INVOCATION_FILE } from './invocation.js';

export const CODEX_RESULT_FILE = 'result.json';
export const CODEX_EVENTS_FILE = 'events.jsonl';
export const CODEX_STDERR_FILE = 'stderr.log';
export const CODEX_FINAL_FILE = 'final.md';

export interface CodexRunnerOptions {
  attemptId?: string;
  repoRoot: string;
  sessionId: string;
  sessionName: string;
  branchName?: string;
  baseBranch?: string;
  goal: string;
  workingDirectory: string;
  codexDir: string;
  codexHome?: string;
  config: HydrazConfig;
  model?: string;
  reasoningEffort?: HydrazConfig['codex']['reasoningEffort'];
  speed?: HydrazConfig['codex']['speed'];
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  search?: boolean;
  skipGitRepoCheck?: boolean;
  gitIdentity?: GitHubGitIdentity;
  resumeThreadId?: string;
  resumePrompt?: string;
  delivery?: {
    enabled: boolean;
    createPullRequest: boolean;
    keepWorkspace: boolean;
  };
}

export interface CodexRunnerResult {
  attemptId: string;
  success: boolean;
  threadId?: string;
  exitCode: number | null;
  eventsPath: string;
  stderrPath: string;
  finalPath: string;
  resultPath: string;
  invocationEvidence: CodexInvocationEvidence;
  rolloutVerification: CodexRolloutVerification;
  delivery?: CodexDeliveryResult;
  error?: string;
}

export async function executeCodexRunner(options: CodexRunnerOptions): Promise<CodexRunnerResult> {
  const attemptId = options.attemptId ?? randomUUID();
  mkdirSync(options.codexDir, { recursive: true, mode: 0o700 });

  const eventsPath = join(options.codexDir, CODEX_EVENTS_FILE);
  const stderrPath = join(options.codexDir, CODEX_STDERR_FILE);
  const finalPath = join(options.codexDir, CODEX_FINAL_FILE);
  const resultPath = join(options.codexDir, CODEX_RESULT_FILE);
  writeFileSync(eventsPath, '', { mode: 0o600 });
  writeFileSync(stderrPath, '', { mode: 0o600 });
  if (!existsSync(finalPath)) {
    writeFileSync(finalPath, '', { mode: 0o600 });
  }

  const repoPrompt = readRepoPromptContent(options.repoRoot);
  const prompt = options.resumeThreadId
    ? (options.resumePrompt ?? options.goal)
    : buildGoalPrompt(options.goal, repoPrompt);
  const sandbox = options.sandbox ?? options.config.codex.sandbox;
  const model = options.model ?? options.config.codex.model;
  const reasoningEffort = options.reasoningEffort ?? options.config.codex.reasoningEffort;
  const speed = options.speed ?? options.config.codex.speed;
  const search = options.search ?? options.config.codex.search;

  const command = options.resumeThreadId
    ? buildCodexResumeCommand({
        codexCommand: options.config.codex.command,
        threadId: options.resumeThreadId,
        prompt,
        outputLastMessagePath: finalPath,
        sandbox,
        model,
        reasoningEffort,
        speed,
        search,
        skipGitRepoCheck: options.skipGitRepoCheck,
      })
    : buildCodexExecCommand({
        codexCommand: options.config.codex.command,
        prompt,
        outputLastMessagePath: finalPath,
        sandbox,
        model,
        reasoningEffort,
        speed,
        search,
        skipGitRepoCheck: options.skipGitRepoCheck,
      });
  const invocation = createCodexInvocationRecorder({
    attemptId,
    codexDir: options.codexDir,
    mode: options.resumeThreadId ? 'resume' : 'exec',
    command,
    prompt,
    requested: { model, reasoningEffort, speed },
    threadId: options.resumeThreadId,
  });

  let threadId: string | undefined = options.resumeThreadId;
  const codexEnv = { ...process.env };
  delete codexEnv.HYDRAZ_CODEX_RUNNER_OPTIONS;
  if (options.codexHome !== undefined) {
    codexEnv.CODEX_HOME = options.codexHome;
  }
  const rolloutCheckpoint = options.resumeThreadId
    ? captureCodexRolloutCheckpoint({
        codexHome: options.codexHome,
        threadId: options.resumeThreadId,
      })
    : undefined;

  let spawnError: string | undefined;
  const exitCode = await new Promise<number | null>((resolve) => {
    const child = spawn(command.cmd, command.args, {
      cwd: options.workingDirectory,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: codexEnv,
    });
    let finished = false;

    child.once('spawn', () => {
      invocation.markSpawned();
    });

    child.once('error', (error) => {
      if (finished) return;
      finished = true;
      spawnError = error.message;
      invocation.markSpawnFailed();
      resolve(null);
    });

    let stdoutBuffer = '';
    let stderrBuffer = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (data: string) => {
      stdoutBuffer += data;
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const parsed = parseCodexJsonLine(line);
        if (parsed?.type === 'thread.started') {
          threadId = parsed.threadId;
          invocation.markThreadStarted(parsed.threadId);
        }
        writeFileSync(eventsPath, redactSecrets(line) + '\n', { flag: 'a', mode: 0o600 });
      }
    });

    child.stderr?.on('data', (data: string) => {
      stderrBuffer += data;
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop() ?? '';
      for (const line of lines) {
        writeFileSync(stderrPath, redactSecrets(line) + '\n', { flag: 'a', mode: 0o600 });
      }
    });

    child.once('close', (code) => {
      if (finished) return;
      finished = true;
      if (stdoutBuffer.trim()) {
        const parsed = parseCodexJsonLine(stdoutBuffer);
        if (parsed?.type === 'thread.started') {
          threadId = parsed.threadId;
          invocation.markThreadStarted(parsed.threadId);
        }
        writeFileSync(eventsPath, redactSecrets(stdoutBuffer.trimEnd()) + '\n', { flag: 'a', mode: 0o600 });
      }
      if (stderrBuffer.length > 0) {
        writeFileSync(stderrPath, redactSecrets(stderrBuffer), { flag: 'a', mode: 0o600 });
      }
      invocation.markExited(code);
      resolve(code);
    });
  });

  if (existsSync(finalPath)) {
    const finalMessage = readFileSync(finalPath, 'utf8');
    const redactedFinalMessage = redactSecrets(finalMessage);
    if (redactedFinalMessage !== finalMessage) {
      writeFileSync(finalPath, redactedFinalMessage, { mode: 0o600 });
    }
  }
  const rolloutVerification = verifyCodexRollout({
    attemptId,
    codexHome: options.codexHome,
    threadId,
    checkpoint: rolloutCheckpoint,
    expected: {
      model,
      reasoningEffort,
      serviceTier: speed === 'fast' ? 'priority' : 'default',
    },
  });

  const result: CodexRunnerResult = {
    attemptId,
    success: spawnError === undefined && exitCode === 0,
    threadId,
    exitCode,
    eventsPath,
    stderrPath,
    finalPath,
    resultPath,
    invocationEvidence: invocation.snapshot(),
    rolloutVerification,
    error: spawnError
      ? `Codex spawn failed: ${spawnError}`
      : exitCode === 0
        ? undefined
        : `Codex exited with code ${exitCode}`,
  };

  if (result.success && options.delivery?.enabled) {
    const branchName = options.branchName ?? `hydraz/${options.sessionName}`;
    result.delivery = await finalizeCodexDelivery({
      session: {
        id: options.sessionId,
        name: options.sessionName,
        repoRoot: options.repoRoot,
        branchName,
        baseBranch: options.baseBranch,
        executionTarget: options.config.executionTarget,
        task: options.goal,
        state: 'delivering',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      repoRoot: options.repoRoot,
      workspace: {
        id: options.sessionId,
        type: options.config.executionTarget,
        directory: options.workingDirectory,
        branchName,
        sessionId: options.sessionId,
      },
      provider: NOOP_PROVIDER,
      githubToken: options.config.github.token,
      gitIdentity: options.gitIdentity,
      createPullRequest: options.delivery.createPullRequest,
      keepWorkspace: options.delivery.keepWorkspace,
    });
  }

  writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  return result;
}

const NOOP_PROVIDER: WorkspaceProvider = {
  type: 'local',
  checkAvailability: () => ({ available: true }),
  createWorkspace: async () => {
    throw new Error('Runner delivery cannot create workspaces');
  },
  destroyWorkspace: () => {},
};

export async function runMain(): Promise<void> {
  const json = process.env.HYDRAZ_CODEX_RUNNER_OPTIONS;
  if (!json) {
    process.stderr.write('Missing HYDRAZ_CODEX_RUNNER_OPTIONS\n');
    process.exit(1);
    return;
  }

  try {
    const result = await executeCodexRunner(JSON.parse(json) as CodexRunnerOptions);
    process.exit(result.success ? 0 : 1);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(message + '\n');
    process.exit(1);
  }
}

let isMain = false;
try {
  isMain = Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
} catch {
  isMain = false;
}

if (isMain) {
  runMain();
}
