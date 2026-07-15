import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const testConfig = {
  executionTarget: 'cloud',
  branchNaming: { prefix: 'hydraz/' },
  github: { token: 'ghp-test' },
  codex: {
    command: 'codex',
    model: 'gpt-5.6-sol',
    reasoningEffort: 'ultra',
    speed: 'fast',
    sandbox: 'workspace-write',
    search: false,
  },
  retention: { keepTranscripts: false, keepTestLogs: false },
  displayVerbosity: 'compact',
};

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: vi.fn(() => ({ pid: 31337, unref: vi.fn() })),
  };
});

vi.mock('../config/index.js', () => ({
  loadConfig: vi.fn(() => testConfig),
}));

vi.mock('../providers/devpod.js', () => ({
  scpToContainer: vi.fn(async () => {}),
  stageCodexContainerImport: vi.fn(async () => {}),
  getDistRoot: vi.fn(() => '/fake/dist'),
  sshExec: vi.fn(() => '4242\n'),
  getContainerHome: vi.fn(() => '/home/codex'),
  devpodList: vi.fn(() => []),
  devpodStatus: vi.fn(() => 'NotFound'),
  devpodDelete: vi.fn(),
  checkDevPodAvailability: vi.fn(() => ({ available: true })),
  checkDockerAvailability: vi.fn(() => true),
}));

vi.mock('../providers/playwright-container.js', () => ({
  ensurePlaywrightContainerRuntime: vi.fn(async () => ({
    runtimeRoot: '/home/codex/.hydraz/runtimes/playwright/1.61.1',
    browsersPath: '/home/codex/.hydraz/browsers/playwright-1.61.1',
    binDir: '/home/codex/.hydraz/bin',
  })),
}));

vi.mock('../providers/playwright-runtime.js', () => ({
  resolvePlaywrightRuntimeArchive: vi.fn(() => '/fake/dist/runtime/playwright-runtime.tar.gz'),
}));

vi.mock('../codex/container-import.js', () => ({
  buildCodexContainerImportPlan: vi.fn(() => ({
    sourceCodexHome: '/host/.codex',
    configToml: 'model = "gpt-5.6"\n',
    files: [{ sourcePath: '/host/.codex/auth.json', targetRelativePath: 'auth.json' }],
    directories: [],
  })),
}));

vi.mock('../codex/repo-config.js', () => ({
  processHydrazIncludes: vi.fn(async () => {}),
}));

vi.mock('./cleanup.js', () => ({
  findAllOrphanedWorkspaces: vi.fn(() => ({ known: [], unknown: [], total: 0 })),
}));

vi.mock('../repo/paths.js', async () => {
  const path = await import('node:path');
  return {
    getHydrazHome: () => '.hydraz-test',
    repoHash: () => 'testhash',
    repoSlug: (repoRoot: string) => `${path.basename(repoRoot)}-testhash`,
    resolveRepoDataPaths: (repoRoot: string) => {
      const repoDataDir = path.join(repoRoot, '.hydraz-test');
      return {
        hydrazHome: path.join(repoRoot, '.hydraz-test-home'),
        repoDataDir,
        sessionsDir: path.join(repoDataDir, 'sessions'),
        workspacesDir: path.join(repoDataDir, 'workspaces'),
      };
    },
    getSessionDir: (repoRoot: string, sessionId: string) =>
      path.join(repoRoot, '.hydraz-test', 'sessions', sessionId),
    getWorkspaceDir: (repoRoot: string, sessionId: string) =>
      path.join(repoRoot, '.hydraz-test', 'workspaces', sessionId),
  };
});

import { getProvider, refreshSessionStatus, resumeSession, startSession, stopSession } from './controller.js';
import { LocalProvider } from '../providers/local.js';
import { LocalContainerProvider } from '../providers/local-container.js';
import { CloudProvider } from '../providers/cloud.js';
import {
  createNewSession,
  initRepoState,
  loadSession,
  saveSession,
  transitionState,
} from '../sessions/index.js';
import { resolveRepoDataPaths } from '../repo/paths.js';
import { scpToContainer, sshExec, stageCodexContainerImport } from '../providers/devpod.js';
import { ensurePlaywrightContainerRuntime } from '../providers/playwright-container.js';
import { resolvePlaywrightRuntimeArchive } from '../providers/playwright-runtime.js';
import { processHydrazIncludes } from '../codex/repo-config.js';
import { setVerbose } from '../debug.js';

describe('getProvider', () => {
  it('returns LocalProvider for local target', () => {
    expect(getProvider('local')).toBeInstanceOf(LocalProvider);
  });

  it('returns LocalContainerProvider for local-container target', () => {
    expect(getProvider('local-container')).toBeInstanceOf(LocalContainerProvider);
  });

  it('returns CloudProvider for cloud target', () => {
    expect(getProvider('cloud')).toBeInstanceOf(CloudProvider);
  });
});

describe('Codex controller', () => {
  let repoRoot: string;

  beforeEach(() => {
    vi.clearAllMocks();
    setVerbose(false);
    vi.mocked(stageCodexContainerImport).mockReset().mockResolvedValue(undefined);
    vi.mocked(ensurePlaywrightContainerRuntime).mockReset().mockResolvedValue({
      runtimeRoot: '/home/codex/.hydraz/runtimes/playwright/1.61.1',
      browsersPath: '/home/codex/.hydraz/browsers/playwright-1.61.1',
      binDir: '/home/codex/.hydraz/bin',
    });
    vi.mocked(resolvePlaywrightRuntimeArchive)
      .mockReset()
      .mockReturnValue('/fake/dist/runtime/playwright-runtime.tar.gz');
    testConfig.executionTarget = 'cloud';
    testConfig.codex.command = 'codex';
    testConfig.codex.model = 'gpt-5.6-sol';
    testConfig.codex.reasoningEffort = 'ultra';
    testConfig.codex.speed = 'fast';
    repoRoot = mkdtempSync(tmpdir() + '/hydraz-controller-v3-test-');
    initRepoState(repoRoot);
    vi.spyOn(CloudProvider.prototype, 'checkAvailability').mockReturnValue({ available: true });
    vi.spyOn(CloudProvider.prototype, 'createWorkspace').mockImplementation(async (params: any) => ({
      id: params.session.id,
      type: 'cloud' as const,
      directory: '/workspaces/hydraz-test',
      branchName: params.session.branchName,
      sessionId: params.session.id,
    }));
    vi.spyOn(LocalContainerProvider.prototype, 'checkAvailability').mockReturnValue({ available: true });
    vi.spyOn(LocalContainerProvider.prototype, 'createWorkspace').mockImplementation(async (params: any) => ({
      id: params.session.id,
      type: 'local-container' as const,
      directory: '/tmp/hydraz-worktrees/local-container',
      branchName: params.session.branchName,
      sessionId: params.session.id,
    }));
  });

  afterEach(() => {
    setVerbose(false);
    vi.restoreAllMocks();
    rmSync(repoRoot, { recursive: true, force: true });
    const paths = resolveRepoDataPaths(repoRoot);
    rmSync(paths.repoDataDir, { recursive: true, force: true });
  });

  function makeSession(name = 'codex-controller') {
    return createNewSession({
      name,
      repoRoot,
      branchName: `hydraz/${name}`,
      executionTarget: 'cloud',
      task: 'Implement v3',
    });
  }

  function makeLocalContainerSession(name: string) {
    return createNewSession({
      name,
      repoRoot,
      branchName: `hydraz/${name}`,
      executionTarget: 'local-container',
      task: 'Implement v4',
    });
  }

  function makeLocalSession(name: string) {
    return createNewSession({
      name,
      repoRoot,
      branchName: `hydraz/${name}`,
      executionTarget: 'local',
      task: 'Preserve bare-metal behavior',
    });
  }

  function getRunnerOptionsFromLaunchCommand(sessionId: string) {
    const launchCommand = vi.mocked(sshExec).mock.calls.find((call) =>
      call[1].includes('HYDRAZ_CODEX_RUNNER_OPTIONS=') &&
      call[1].includes(`/tmp/hydraz-codex/${sessionId}`),
    )?.[1];
    expect(launchCommand).toBeDefined();
    const match = launchCommand?.match(/HYDRAZ_CODEX_RUNNER_OPTIONS='([^']+)'/);
    expect(match).toBeTruthy();
    return JSON.parse(match![1]);
  }

  function parseAsPosixShell(command: string): void {
    execFileSync('/bin/sh', ['-n'], { input: command, stdio: 'pipe' });
  }

  it('starts a detached Codex runner and records pid/artifact paths', async () => {
    const session = makeSession('start-detached');

    await startSession(session.id, repoRoot);

    expect(scpToContainer).toHaveBeenCalled();
    expect(processHydrazIncludes).toHaveBeenCalled();
    const loaded = loadSession(repoRoot, session.id);
    expect(loaded.state).toBe('syncing');
    expect(loaded.workspaceDir).toBe('/workspaces/hydraz-test');
    expect(loaded.codex).toMatchObject({
      remotePid: 4242,
      resultPath: `/tmp/hydraz-codex/${session.id}/result.json`,
    });
    expect(vi.mocked(sshExec).mock.calls.some((call) => call[1].includes('nohup node'))).toBe(true);
  });

  it.each(['local-container', 'cloud'] as const)(
    'stages portable inputs after hydrazincludes and launches Linux Codex with a stable home for %s',
    async (executionTarget) => {
      const session = executionTarget === 'local-container'
        ? makeLocalContainerSession('local-import')
        : makeSession('cloud-import');

      await startSession(session.id, repoRoot);

      const codexHome = `/home/codex/.hydraz/codex-homes/${session.id}`;
      expect(stageCodexContainerImport).toHaveBeenCalledWith(
        `hydraz-${session.id}`,
        codexHome,
        expect.objectContaining({
          sourceCodexHome: '/host/.codex',
          files: [expect.objectContaining({ targetRelativePath: 'auth.json' })],
        }),
        expect.any(Function),
      );
      expect(vi.mocked(processHydrazIncludes).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(stageCodexContainerImport).mock.invocationCallOrder[0]!,
      );
      expect(getRunnerOptionsFromLaunchCommand(session.id)).toMatchObject({
        codexHome,
        model: 'gpt-5.6-sol',
        reasoningEffort: 'ultra',
        speed: 'fast',
        config: { codex: { command: 'codex' } },
      });
      const launchCommand = vi.mocked(sshExec).mock.calls.find((call) =>
        call[1].includes('HYDRAZ_CODEX_RUNNER_OPTIONS='),
      )?.[1];
      expect(launchCommand).toContain(`CODEX_HOME='${codexHome}'`);
    },
  );

  it.each(['local-container', 'cloud'] as const)(
    'does not launch the detached runner when Codex staging fails for %s',
    async (executionTarget) => {
      vi.mocked(stageCodexContainerImport).mockRejectedValueOnce(new Error('staging failed'));
      const session = executionTarget === 'local-container'
        ? makeLocalContainerSession('local-staging-failure')
        : makeSession('cloud-staging-failure');

      await startSession(session.id, repoRoot);

      expect(loadSession(repoRoot, session.id).state).toBe('failed');
      expect(vi.mocked(sshExec).mock.calls.some((call) => call[1].includes('nohup node'))).toBe(false);
    },
  );

  it.each(['local-container', 'cloud'] as const)(
    'restages into the same stable home during the existing %s resume flow',
    async (executionTarget) => {
      const session = executionTarget === 'local-container'
        ? makeLocalContainerSession('local-resume')
        : makeSession('cloud-resume');
      transitionState(repoRoot, session.id, 'starting');
      transitionState(repoRoot, session.id, 'failed', 'stopped');
      const stored = loadSession(repoRoot, session.id);
      stored.workspaceDir = executionTarget === 'local-container'
        ? '/tmp/hydraz-worktrees/local-container'
        : '/workspaces/hydraz-test';
      stored.codex = { threadId: 'thread-1' };
      saveSession(repoRoot, stored);

      await resumeSession(session.id, repoRoot, {}, { prompt: 'Continue' });

      const codexHome = `/home/codex/.hydraz/codex-homes/${session.id}`;
      expect(stageCodexContainerImport).toHaveBeenCalledWith(
        `hydraz-${session.id}`,
        codexHome,
        expect.any(Object),
        expect.any(Function),
      );
      expect(getRunnerOptionsFromLaunchCommand(session.id)).toMatchObject({
        codexHome,
        resumeThreadId: 'thread-1',
      });
    },
  );

  it('normalizes cloud runner metadata and forces the container-installed Codex command', async () => {
    testConfig.executionTarget = 'local';
    testConfig.codex.command = '/Applications/Codex.app/Contents/MacOS/codex';
    const session = makeSession('cloud-runner-config');

    await startSession(session.id, repoRoot);

    expect(getRunnerOptionsFromLaunchCommand(session.id)).toMatchObject({
      config: {
        executionTarget: 'cloud',
        codex: { command: 'codex' },
      },
    });
  });

  it.each(['local-container', 'cloud'] as const)(
    'provisions Playwright after the dist transfer and before Codex staging for %s',
    async (executionTarget) => {
      const session = executionTarget === 'local-container'
        ? makeLocalContainerSession('local-playwright-order')
        : makeSession('cloud-playwright-order');

      await startSession(session.id, repoRoot);

      expect(ensurePlaywrightContainerRuntime).toHaveBeenCalledWith(
        `hydraz-${session.id}`,
        '/home/codex',
        expect.any(Function),
      );
      expect(vi.mocked(scpToContainer).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(ensurePlaywrightContainerRuntime).mock.invocationCallOrder[0]!,
      );
      expect(vi.mocked(ensurePlaywrightContainerRuntime).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(stageCodexContainerImport).mock.invocationCallOrder[0]!,
      );
    },
  );

  it.each(['local-container', 'cloud'] as const)(
    'fails the %s session before Codex staging or launch when Playwright provisioning fails',
    async (executionTarget) => {
      vi.mocked(ensurePlaywrightContainerRuntime).mockRejectedValueOnce(new Error('browser setup failed'));
      const session = executionTarget === 'local-container'
        ? makeLocalContainerSession('local-playwright-failure')
        : makeSession('cloud-playwright-failure');

      await startSession(session.id, repoRoot);

      expect(loadSession(repoRoot, session.id).state).toBe('failed');
      expect(stageCodexContainerImport).not.toHaveBeenCalled();
      expect(vi.mocked(sshExec).mock.calls.some((call) => call[1].includes('nohup node'))).toBe(false);
    },
  );

  it.each(['local-container', 'cloud'] as const)(
    'propagates direct Playwright paths across %s launch and resume',
    async (executionTarget) => {
      const session = executionTarget === 'local-container'
        ? makeLocalContainerSession('local-playwright-env')
        : makeSession('cloud-playwright-env');
      await startSession(session.id, repoRoot);

      const launchCommand = vi.mocked(sshExec).mock.calls.find((call) =>
        call[1].includes(`/tmp/hydraz-codex/${session.id}`),
      )?.[1] ?? '';
      expect(launchCommand).toContain("PATH='/home/codex/.hydraz/bin':$PATH");
      expect(launchCommand).toContain(
        "PLAYWRIGHT_BROWSERS_PATH='/home/codex/.hydraz/browsers/playwright-1.61.1'",
      );

      const stored = loadSession(repoRoot, session.id);
      stored.codex = { ...stored.codex, threadId: 'thread-playwright' };
      saveSession(repoRoot, stored);
      transitionState(repoRoot, session.id, 'failed', 'retry');
      await resumeSession(session.id, repoRoot, {}, { prompt: 'Continue' });
      expect(ensurePlaywrightContainerRuntime).toHaveBeenCalledTimes(2);
      expect(vi.mocked(ensurePlaywrightContainerRuntime).mock.calls[1]?.[1]).toBe('/home/codex');

      const runnerLaunchCommands = vi.mocked(sshExec).mock.calls
        .map((call) => call[1])
        .filter((command) => command.includes('HYDRAZ_CODEX_RUNNER_OPTIONS='));
      expect(runnerLaunchCommands).toHaveLength(2);
      expect(runnerLaunchCommands[1]).toContain("PATH='/home/codex/.hydraz/bin':$PATH");
      expect(runnerLaunchCommands[1]).toContain(
        "PLAYWRIGHT_BROWSERS_PATH='/home/codex/.hydraz/browsers/playwright-1.61.1'",
      );
      expect(runnerLaunchCommands[1]).toContain(
        `CODEX_HOME='/home/codex/.hydraz/codex-homes/${session.id}'`,
      );
    },
  );

  it('preserves bare-metal startup without invoking the container bootstrap', async () => {
    testConfig.executionTarget = 'cloud';
    testConfig.codex.command = '/opt/codex/custom-codex';
    vi.spyOn(LocalProvider.prototype, 'checkAvailability').mockReturnValue({ available: true });
    vi.spyOn(LocalProvider.prototype, 'createWorkspace').mockImplementation(async (params: any) => ({
      id: params.session.id,
      type: 'local' as const,
      directory: '/tmp/hydraz-worktrees/local',
      branchName: params.session.branchName,
      sessionId: params.session.id,
    }));
    const session = makeLocalSession('local-no-container-bootstrap');

    await startSession(session.id, repoRoot);

    expect(resolvePlaywrightRuntimeArchive).not.toHaveBeenCalled();
    expect(scpToContainer).not.toHaveBeenCalled();
    expect(processHydrazIncludes).not.toHaveBeenCalled();
    expect(ensurePlaywrightContainerRuntime).not.toHaveBeenCalled();
    expect(stageCodexContainerImport).not.toHaveBeenCalled();
    expect(sshExec).not.toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledOnce();
    const spawnEnvironment = vi.mocked(spawn).mock.calls[0]?.[2]?.env;
    const runnerOptions = JSON.parse(spawnEnvironment?.HYDRAZ_CODEX_RUNNER_OPTIONS ?? '{}');
    expect(runnerOptions).toMatchObject({
      model: 'gpt-5.6-sol',
      reasoningEffort: 'ultra',
      speed: 'fast',
      config: {
        executionTarget: 'local',
        codex: { command: '/opt/codex/custom-codex' },
      },
    });
    expect(runnerOptions).not.toHaveProperty('codexHome');
  });

  it('validates the packaged Playwright runtime before transferring Hydraz to cloud', async () => {
    vi.mocked(resolvePlaywrightRuntimeArchive).mockImplementationOnce(() => {
      throw new Error('runtime missing');
    });
    const session = makeSession('cloud-playwright-preflight');

    await startSession(session.id, repoRoot);

    expect(loadSession(repoRoot, session.id).state).toBe('failed');
    expect(scpToContainer).not.toHaveBeenCalled();
    expect(vi.mocked(sshExec).mock.calls.some((call) => call[1].includes('nohup node'))).toBe(false);
  });

  it('does not background the runner setup command when launching the detached runner', async () => {
    const session = makeSession('start-detached-runner-only');

    await startSession(session.id, repoRoot);

    const launchCommand = vi.mocked(sshExec).mock.calls.find((call) =>
      call[1].includes('HYDRAZ_CODEX_RUNNER_OPTIONS='),
    )?.[1];
    expect(launchCommand).toBeDefined();
    expect(launchCommand).toContain(' && (');
    expect(launchCommand).toMatch(/nohup node .* < \/dev\/null & echo \$!\)/);
  });

  it('[shell regression] emits a valid detached-runner POSIX shell program for special characters', async () => {
    const session = createNewSession({
      name: 'runner-shell-special-characters',
      repoRoot,
      branchName: 'hydraz/runner-shell-special-characters',
      executionTarget: 'cloud',
      task: "Handle O'Brien; $(not-run) and `also-not-run`",
    });

    await startSession(session.id, repoRoot);

    const launchCommand = vi.mocked(sshExec).mock.calls.find((call) =>
      call[1].includes(`/tmp/hydraz-codex/${session.id}`),
    )?.[1];
    expect(launchCommand).toBeDefined();
    expect(launchCommand).toContain("O'\\''Brien; $(not-run) and `also-not-run`");
    expect(() => parseAsPosixShell(launchCommand!)).not.toThrow();
  });

  it('defaults cloud Codex runs to dangerous access and web search', async () => {
    const session = makeSession('cloud-capabilities');

    await startSession(session.id, repoRoot);

    expect(getRunnerOptionsFromLaunchCommand(session.id)).toMatchObject({
      sandbox: 'danger-full-access',
      search: true,
      skipGitRepoCheck: true,
    });
  });

  it('pins explicit managed Codex settings on the session', async () => {
    const session = makeSession('cloud-managed-model');

    await startSession(session.id, repoRoot, {}, {
      model: 'gpt-5.5',
      reasoningEffort: 'high',
      speed: 'standard',
    });

    expect(getRunnerOptionsFromLaunchCommand(session.id)).toMatchObject({
      model: 'gpt-5.5',
      reasoningEffort: 'high',
      speed: 'standard',
    });
    const codex = loadSession(repoRoot, session.id).codex;
    expect(codex?.requestedConfig).toEqual({
      model: 'gpt-5.5',
      reasoningEffort: 'high',
      speed: 'standard',
    });
    expect(codex?.invocationPath).toBe(
      `/tmp/hydraz-codex/${session.id}/invocation.json`,
    );
  });

  it('prints prompt-safe managed Codex diagnostics in verbose mode', async () => {
    const session = makeSession('cloud-managed-debug');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    setVerbose(true);

    await startSession(session.id, repoRoot, {}, {
      model: 'gpt-5.5',
      reasoningEffort: 'high',
      speed: 'standard',
    });

    const output = stderr.mock.calls.map((call) => String(call[0])).join('');
    expect(output).toContain('model=gpt-5.5');
    expect(output).toContain('reasoningEffort=high');
    expect(output).toContain('speed=standard');
    expect(output).toContain('serviceTier=default');
    expect(output).toContain('codex-invocation.json');
    expect(output).not.toContain('Implement v3');
  });

  it('reuses pinned managed Codex settings when resuming', async () => {
    const session = makeSession('cloud-managed-resume');
    transitionState(repoRoot, session.id, 'starting');
    transitionState(repoRoot, session.id, 'failed', 'stopped');
    const stored = loadSession(repoRoot, session.id);
    stored.workspaceDir = '/workspaces/hydraz-test';
    stored.codex = {
      threadId: 'thread-managed',
      requestedConfig: {
        model: 'gpt-5.5',
        reasoningEffort: 'high',
        speed: 'standard',
      },
    };
    saveSession(repoRoot, stored);

    await resumeSession(session.id, repoRoot, {}, { prompt: 'Continue' });

    expect(getRunnerOptionsFromLaunchCommand(session.id)).toMatchObject({
      model: 'gpt-5.5',
      reasoningEffort: 'high',
      speed: 'standard',
      resumeThreadId: 'thread-managed',
    });
  });

  it('preserves explicit sandbox overrides for cloud Codex runs', async () => {
    const session = makeSession('cloud-sandbox-override');

    await startSession(session.id, repoRoot, {}, { sandbox: 'workspace-write' });

    expect(getRunnerOptionsFromLaunchCommand(session.id)).toMatchObject({
      sandbox: 'workspace-write',
      search: true,
      skipGitRepoCheck: true,
    });
  });

  it('passes the managed git identity from the workspace to the detached runner', async () => {
    vi.spyOn(CloudProvider.prototype, 'createWorkspace').mockImplementation(async (params: any) => ({
      id: params.session.id,
      type: 'cloud' as const,
      directory: '/workspaces/hydraz-test',
      branchName: params.session.branchName,
      sessionId: params.session.id,
      gitIdentity: {
        name: 'josheverett',
        email: '151150+josheverett@users.noreply.github.com',
      },
    }));
    const session = makeSession('cloud-git-identity');

    await startSession(session.id, repoRoot);

    expect(getRunnerOptionsFromLaunchCommand(session.id)).toMatchObject({
      gitIdentity: {
        name: 'josheverett',
        email: '151150+josheverett@users.noreply.github.com',
      },
    });
  });

  it('passes the configured base branch to workspace creation and the detached runner', async () => {
    const createWorkspace = vi.spyOn(CloudProvider.prototype, 'createWorkspace');
    const session = makeSession('cloud-base-branch');
    session.baseBranch = 'staging';
    saveSession(repoRoot, session);

    await startSession(session.id, repoRoot, {}, { baseBranch: 'staging' });

    expect(createWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      branchOverride: 'staging',
    }));
    expect(getRunnerOptionsFromLaunchCommand(session.id)).toMatchObject({
      baseBranch: 'staging',
    });
  });

  it('refreshes a finished runner result into completed state', () => {
    const session = makeSession('refresh-finished');
    transitionState(repoRoot, session.id, 'starting');
    transitionState(repoRoot, session.id, 'syncing');
    const loaded = loadSession(repoRoot, session.id);
    loaded.workspaceDir = '/workspaces/hydraz-test';
    loaded.codex = { resultPath: '/tmp/hydraz-codex/session/result.json' };
    saveSession(repoRoot, loaded);
    vi.mocked(sshExec).mockReturnValueOnce(JSON.stringify({
      success: true,
      threadId: 'thread-1',
      exitCode: 0,
      eventsPath: '/tmp/events',
      stderrPath: '/tmp/stderr',
      finalPath: '/tmp/final',
      resultPath: '/tmp/result',
      invocationEvidence: {
        version: 1,
        mode: 'exec',
        command: 'codex',
        args: ['exec', '--json'],
        promptOmitted: true,
        promptArgumentIndex: 2,
        requested: {
          model: 'gpt-5.6-sol',
          reasoningEffort: 'ultra',
          speed: 'fast',
        },
        normalized: { fastMode: true, serviceTier: 'priority' },
        preparedAt: '2026-07-15T00:00:00.000Z',
        spawnedAt: '2026-07-15T00:00:01.000Z',
        exitedAt: '2026-07-15T00:01:00.000Z',
        spawnState: 'exited',
        threadId: 'thread-1',
        exitCode: 0,
      },
      rolloutVerification: {
        status: 'mismatched',
        checkedAt: '2026-07-15T00:01:00.000Z',
        observed: { model: 'gpt-5.5', reasoningEffort: 'medium' },
        checks: {
          model: 'mismatched',
          reasoningEffort: 'mismatched',
          serviceTier: 'unavailable',
        },
      },
    }));

    const refreshed = refreshSessionStatus(session.id, repoRoot);

    expect(refreshed.state).toBe('completed');
    expect(refreshed.codex?.threadId).toBe('thread-1');
    expect(refreshed.codex?.invocationEvidence?.spawnState).toBe('exited');
    expect(refreshed.codex?.rolloutVerification?.status).toBe('mismatched');
  });

  it('refreshes a finished local runner result from disk', () => {
    const session = createNewSession({
      name: 'refresh-local',
      repoRoot,
      branchName: 'hydraz/refresh-local',
      executionTarget: 'local',
      task: 'Implement v3',
    });
    transitionState(repoRoot, session.id, 'starting');
    transitionState(repoRoot, session.id, 'syncing');
    const codexDir = `${repoRoot}/codex-local`;
    const resultPath = `${codexDir}/result.json`;
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(resultPath, JSON.stringify({
      success: true,
      threadId: 'thread-local',
      exitCode: 0,
      eventsPath: `${codexDir}/events.jsonl`,
      stderrPath: `${codexDir}/stderr.log`,
      finalPath: `${codexDir}/final.md`,
      resultPath,
    }));
    const loaded = loadSession(repoRoot, session.id);
    loaded.workspaceDir = repoRoot;
    loaded.codex = { resultPath };
    saveSession(repoRoot, loaded);

    const refreshed = refreshSessionStatus(session.id, repoRoot);

    expect(refreshed.state).toBe('completed');
    expect(refreshed.codex?.threadId).toBe('thread-local');
  });

  it('kills the detached remote pid when stopping a running session', () => {
    const session = makeSession('stop-running');
    transitionState(repoRoot, session.id, 'starting');
    transitionState(repoRoot, session.id, 'syncing');
    const loaded = loadSession(repoRoot, session.id);
    loaded.workspaceDir = '/workspaces/hydraz-test';
    loaded.codex = { remotePid: 7777 };
    saveSession(repoRoot, loaded);

    stopSession(session.id, repoRoot);

    expect(vi.mocked(sshExec).mock.calls.some((call) => call[1] === 'kill 7777')).toBe(true);
    expect(loadSession(repoRoot, session.id).state).toBe('stopped');
  });

  it('refuses resume without a stored Codex thread id', async () => {
    const session = makeSession('resume-no-thread');
    transitionState(repoRoot, session.id, 'starting');
    transitionState(repoRoot, session.id, 'failed', 'boom');
    const loaded = loadSession(repoRoot, session.id);
    loaded.workspaceDir = '/workspaces/hydraz-test';
    loaded.codex = {};
    saveSession(repoRoot, loaded);

    const errors: string[] = [];
    await resumeSession(session.id, repoRoot, { onError: (msg) => errors.push(msg) }, { prompt: 'Continue' });

    expect(errors).toContain('Cannot resume: no Codex thread id recorded for this session.');
  });
});
