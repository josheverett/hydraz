import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const testConfig = {
  executionTarget: 'cloud',
  branchNaming: { prefix: 'hydraz/' },
  github: { token: 'ghp-test' },
  codex: { command: 'codex', sandbox: 'workspace-write', search: false },
  retention: { keepTranscripts: false, keepTestLogs: false },
  displayVerbosity: 'compact',
};

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
import { processHydrazIncludes } from '../codex/repo-config.js';

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

  it('stages portable inputs after hydrazincludes and launches Linux Codex with a stable home', async () => {
    const session = makeLocalContainerSession('local-import');

    await startSession(session.id, repoRoot);

    const codexHome = `/home/codex/.hydraz/codex-homes/${session.id}`;
    expect(stageCodexContainerImport).toHaveBeenCalledWith(
      `hydraz-${session.id}`,
      codexHome,
      expect.objectContaining({ sourceCodexHome: '/host/.codex' }),
      expect.any(Function),
    );
    expect(vi.mocked(processHydrazIncludes).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(stageCodexContainerImport).mock.invocationCallOrder[0]!,
    );
    expect(getRunnerOptionsFromLaunchCommand(session.id)).toMatchObject({
      codexHome,
      config: { codex: { command: 'codex' } },
    });
    const launchCommand = vi.mocked(sshExec).mock.calls.find((call) =>
      call[1].includes('HYDRAZ_CODEX_RUNNER_OPTIONS='),
    )?.[1];
    expect(launchCommand).toContain(`CODEX_HOME='${codexHome}'`);
  });

  it('does not launch the detached runner when Codex staging fails', async () => {
    vi.mocked(stageCodexContainerImport).mockRejectedValueOnce(new Error('staging failed'));
    const session = makeLocalContainerSession('local-staging-failure');

    await startSession(session.id, repoRoot);

    expect(loadSession(repoRoot, session.id).state).toBe('failed');
    expect(vi.mocked(sshExec).mock.calls.some((call) => call[1].includes('nohup node'))).toBe(false);
  });

  it('restages into the same stable home during the existing resume flow', async () => {
    const session = makeLocalContainerSession('local-resume');
    transitionState(repoRoot, session.id, 'starting');
    transitionState(repoRoot, session.id, 'failed', 'stopped');
    const stored = loadSession(repoRoot, session.id);
    stored.workspaceDir = '/tmp/hydraz-worktrees/local-container';
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
  });

  it('does not stage or set CODEX_HOME for cloud sessions', async () => {
    const session = makeSession('cloud-unchanged');

    await startSession(session.id, repoRoot);

    expect(stageCodexContainerImport).not.toHaveBeenCalled();
    expect(getRunnerOptionsFromLaunchCommand(session.id)).not.toHaveProperty('codexHome');
  });

  it('provisions Playwright after the dist transfer and before Codex staging for local containers only', async () => {
    const localSession = makeLocalContainerSession('local-playwright-order');

    await startSession(localSession.id, repoRoot);

    expect(ensurePlaywrightContainerRuntime).toHaveBeenCalledWith(
      `hydraz-${localSession.id}`,
      '/home/codex',
      expect.any(Function),
    );
    expect(vi.mocked(scpToContainer).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(ensurePlaywrightContainerRuntime).mock.invocationCallOrder[0]!,
    );
    expect(vi.mocked(ensurePlaywrightContainerRuntime).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(stageCodexContainerImport).mock.invocationCallOrder[0]!,
    );

    const cloudSession = makeSession('cloud-no-playwright-provision');
    await startSession(cloudSession.id, repoRoot);
    expect(ensurePlaywrightContainerRuntime).toHaveBeenCalledTimes(1);
  });

  it('fails the session before Codex staging or launch when Playwright provisioning fails', async () => {
    vi.mocked(ensurePlaywrightContainerRuntime).mockRejectedValueOnce(new Error('browser setup failed'));
    const session = makeLocalContainerSession('local-playwright-failure');

    await startSession(session.id, repoRoot);

    expect(loadSession(repoRoot, session.id).state).toBe('failed');
    expect(stageCodexContainerImport).not.toHaveBeenCalled();
    expect(vi.mocked(sshExec).mock.calls.some((call) => call[1].includes('nohup node'))).toBe(false);
  });

  it('propagates direct Playwright paths across local launch and resume without changing cloud', async () => {
    const localSession = makeLocalContainerSession('local-playwright-env');
    await startSession(localSession.id, repoRoot);

    const localLaunch = vi.mocked(sshExec).mock.calls.find((call) =>
      call[1].includes(`/tmp/hydraz-codex/${localSession.id}`),
    )?.[1] ?? '';
    expect(localLaunch).toContain("PATH='/home/codex/.hydraz/bin':$PATH");
    expect(localLaunch).toContain(
      "PLAYWRIGHT_BROWSERS_PATH='/home/codex/.hydraz/browsers/playwright-1.61.1'",
    );

    const stored = loadSession(repoRoot, localSession.id);
    stored.codex = { ...stored.codex, threadId: 'thread-playwright' };
    saveSession(repoRoot, stored);
    transitionState(repoRoot, localSession.id, 'failed', 'retry');
    await resumeSession(localSession.id, repoRoot, {}, { prompt: 'Continue' });
    expect(ensurePlaywrightContainerRuntime).toHaveBeenCalledTimes(2);
    expect(vi.mocked(ensurePlaywrightContainerRuntime).mock.calls[1]?.[1]).toBe('/home/codex');

    const cloudSession = makeSession('cloud-playwright-env');
    await startSession(cloudSession.id, repoRoot);
    const cloudLaunch = vi.mocked(sshExec).mock.calls.find((call) =>
      call[1].includes(`/tmp/hydraz-codex/${cloudSession.id}`),
    )?.[1] ?? '';
    expect(cloudLaunch).not.toContain('PLAYWRIGHT_BROWSERS_PATH=');
    expect(cloudLaunch).not.toContain("PATH='/home/codex/.hydraz/bin'");
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

  it('defaults cloud Codex runs to dangerous access and web search', async () => {
    const session = makeSession('cloud-capabilities');

    await startSession(session.id, repoRoot);

    expect(getRunnerOptionsFromLaunchCommand(session.id)).toMatchObject({
      sandbox: 'danger-full-access',
      search: true,
      skipGitRepoCheck: true,
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
    }));

    const refreshed = refreshSessionStatus(session.id, repoRoot);

    expect(refreshed.state).toBe('completed');
    expect(refreshed.codex?.threadId).toBe('thread-1');
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
