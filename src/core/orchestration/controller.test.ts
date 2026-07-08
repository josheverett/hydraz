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
  getDistRoot: vi.fn(() => '/fake/dist'),
  sshExec: vi.fn(() => '4242\n'),
  getContainerHome: vi.fn(() => '/home/codex'),
  devpodList: vi.fn(() => []),
  devpodStatus: vi.fn(() => 'NotFound'),
  devpodDelete: vi.fn(),
  checkDevPodAvailability: vi.fn(() => ({ available: true })),
  checkDockerAvailability: vi.fn(() => true),
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
import { scpToContainer, sshExec } from '../providers/devpod.js';
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
    });
  });

  it('preserves explicit sandbox overrides for cloud Codex runs', async () => {
    const session = makeSession('cloud-sandbox-override');

    await startSession(session.id, repoRoot, {}, { sandbox: 'workspace-write' });

    expect(getRunnerOptionsFromLaunchCommand(session.id)).toMatchObject({
      sandbox: 'workspace-write',
      search: true,
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
