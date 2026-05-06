import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSandbox, type SandboxStep, type SandboxOptions } from './sandbox.js';

vi.mock('../config/loader.js', () => ({
  loadConfig: vi.fn(),
  configExists: vi.fn(() => true),
}));

vi.mock('../claude/resolver.js', () => ({
  resolveAuth: vi.fn(),
}));

vi.mock('../providers/container-auth.js', () => ({
  validateContainerAuth: vi.fn(),
  prepareContainerAuthEnv: vi.fn(() => ({})),
}));

vi.mock('../github/requirements.js', () => ({
  getGitHubAutomationReadiness: vi.fn(),
}));

vi.mock('./controller.js', () => ({
  getProvider: vi.fn(),
}));

vi.mock('../sessions/index.js', () => ({
  createNewSession: vi.fn(() => ({
    id: 'test-session-id',
    name: 'sandbox-1234567890',
    repoRoot: '/test/repo',
    branchName: 'hydraz/sandbox-1234567890',
    personas: ['architect', 'implementer', 'verifier'],
    executionTarget: 'local-container',
    task: 'sandbox',
    state: 'starting',
  })),
  initRepoState: vi.fn(),
}));

vi.mock('../branches/index.js', () => ({
  suggestBranchName: vi.fn(() => 'hydraz/sandbox-1234567890'),
}));

vi.mock('../providers/devpod.js', () => ({
  scpToContainer: vi.fn(() => Promise.resolve()),
  getDistRoot: vi.fn(() => '/dist'),
  getContainerHome: vi.fn(() => '/home/vscode'),
  devpodSsh: vi.fn(() => Promise.resolve(0)),
  devpodDelete: vi.fn(),
}));

vi.mock('../swarm/repo-config.js', () => ({
  processHydrazIncludes: vi.fn(() => Promise.resolve()),
}));

vi.mock('../config/claude.js');
vi.mock('../providers/auth.js');
vi.mock('../repo/paths.js');
vi.mock('../debug.js', () => ({
  debug: vi.fn(),
  debugExec: vi.fn(),
  debugOutput: vi.fn(),
  debugTiming: vi.fn(),
  setVerbose: vi.fn(),
  isVerbose: vi.fn(() => false),
}));

import { loadConfig } from '../config/loader.js';
import { resolveAuth } from '../claude/resolver.js';
import { validateContainerAuth, prepareContainerAuthEnv } from '../providers/container-auth.js';
import { getGitHubAutomationReadiness } from '../github/requirements.js';
import { getProvider } from './controller.js';
import { scpToContainer, devpodSsh, devpodDelete } from '../providers/devpod.js';
import { processHydrazIncludes } from '../swarm/repo-config.js';
import type { HydrazConfig } from '../config/schema.js';

const mockLoadConfig = vi.mocked(loadConfig);
const mockResolveAuth = vi.mocked(resolveAuth);
const mockValidateContainerAuth = vi.mocked(validateContainerAuth);
const mockGetGitHubReadiness = vi.mocked(getGitHubAutomationReadiness);
const mockGetProvider = vi.mocked(getProvider);
const mockScpToContainer = vi.mocked(scpToContainer);
const mockDevpodSsh = vi.mocked(devpodSsh);
const mockDevpodDelete = vi.mocked(devpodDelete);
const mockPrepareContainerAuthEnv = vi.mocked(prepareContainerAuthEnv);
const mockProcessHydrazIncludes = vi.mocked(processHydrazIncludes);

const fakeConfig: HydrazConfig = {
  executionTarget: 'local-container',
  defaultPersonas: ['architect', 'implementer', 'verifier'],
  branchNaming: { prefix: 'hydraz/' },
  claudeAuth: { mode: 'claude-ai-oauth', oauthToken: 'tok' },
  github: { token: 'gh-token' },
  retention: { keepTranscripts: false, keepTestLogs: false },
  displayVerbosity: 'compact',
};

function makeDefaultOptions(overrides?: Partial<SandboxOptions>): SandboxOptions {
  return {
    executionTarget: 'local-container',
    repoRoot: '/test/repo',
    cleanup: true,
    ...overrides,
  };
}

function setupHappyPath(): void {
  mockLoadConfig.mockReturnValue(fakeConfig);
  mockResolveAuth.mockReturnValue({
    resolved: true,
    mode: 'claude-ai-oauth',
    modeDescription: 'Claude AI OAuth',
    claudeAvailable: true,
    claudeVersion: '2.1.74',
    errors: [],
  });
  mockValidateContainerAuth.mockReturnValue({ valid: true });
  mockGetGitHubReadiness.mockReturnValue({ ok: true });
  mockPrepareContainerAuthEnv.mockReturnValue({});

  const fakeProvider = {
    type: 'local-container' as const,
    checkAvailability: () => ({ available: true }),
    createWorkspace: vi.fn(() => Promise.resolve({
      id: 'test-session-id',
      type: 'local-container' as const,
      directory: '/tmp/hydraz-worktrees/test-session-id',
      branchName: 'hydraz/sandbox-1234567890',
      sessionId: 'test-session-id',
    })),
    destroyWorkspace: vi.fn(),
  };
  mockGetProvider.mockReturnValue(fakeProvider);
  mockScpToContainer.mockResolvedValue();
  mockDevpodSsh.mockResolvedValue(0);
  mockDevpodDelete.mockReturnValue(undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runSandbox', () => {
  it('short-circuits on auth failure before provider setup', async () => {
    mockLoadConfig.mockReturnValue(fakeConfig);
    mockResolveAuth.mockReturnValue({
      resolved: false,
      mode: 'claude-ai-oauth',
      modeDescription: 'Claude AI OAuth',
      claudeAvailable: false,
      errors: ['Claude not found'],
    });

    const steps: SandboxStep[] = [];
    const result = await runSandbox(makeDefaultOptions({ onStep: (s) => steps.push(s) }));

    expect(result.entered).toBe(false);
    expect(steps.some((s) => s.name === 'Auth' && s.status === 'fail')).toBe(true);
    expect(mockGetProvider).not.toHaveBeenCalled();
  });

  it('short-circuits on container auth failure', async () => {
    mockLoadConfig.mockReturnValue(fakeConfig);
    mockResolveAuth.mockReturnValue({
      resolved: true,
      mode: 'claude-ai-oauth',
      modeDescription: 'Claude AI OAuth',
      claudeAvailable: true,
      errors: [],
    });
    mockValidateContainerAuth.mockReturnValue({ valid: false, error: 'No OAuth token' });

    const steps: SandboxStep[] = [];
    const result = await runSandbox(makeDefaultOptions({ onStep: (s) => steps.push(s) }));

    expect(result.entered).toBe(false);
    expect(steps.some((s) => s.name === 'Container auth' && s.status === 'fail')).toBe(true);
  });

  it('calls devpodSsh with the correct workspace name after successful setup', async () => {
    setupHappyPath();

    await runSandbox(makeDefaultOptions());

    expect(mockDevpodSsh).toHaveBeenCalledWith('hydraz-test-session-id');
  });

  it('calls devpodDelete on exit when cleanup is true', async () => {
    setupHappyPath();

    await runSandbox(makeDefaultOptions({ cleanup: true }));

    expect(mockDevpodDelete).toHaveBeenCalledWith('hydraz-test-session-id');
  });

  it('does not call devpodDelete when cleanup is false', async () => {
    setupHappyPath();

    await runSandbox(makeDefaultOptions({ cleanup: false }));

    expect(mockDevpodDelete).not.toHaveBeenCalled();
  });

  it('emits all expected steps on a successful run', async () => {
    setupHappyPath();

    const steps: SandboxStep[] = [];
    const result = await runSandbox(makeDefaultOptions({ onStep: (s) => steps.push(s) }));

    expect(result.entered).toBe(true);
    const stepNames = steps.map((s) => s.name);
    expect(stepNames).toContain('Auth');
    expect(stepNames).toContain('Container auth');
    expect(stepNames).toContain('GitHub config');
    expect(stepNames).toContain('Provider');
    expect(stepNames).toContain('Workspace');
    expect(stepNames).toContain('Container setup');
  });

  it('cleans up workspace if createWorkspace throws', async () => {
    mockLoadConfig.mockReturnValue(fakeConfig);
    mockResolveAuth.mockReturnValue({
      resolved: true,
      mode: 'claude-ai-oauth',
      modeDescription: 'Claude AI OAuth',
      claudeAvailable: true,
      errors: [],
    });
    mockValidateContainerAuth.mockReturnValue({ valid: true });
    mockGetGitHubReadiness.mockReturnValue({ ok: true });
    mockPrepareContainerAuthEnv.mockReturnValue({});

    const fakeProvider = {
      type: 'local-container' as const,
      checkAvailability: () => ({ available: true }),
      createWorkspace: vi.fn(() => Promise.reject(new Error('devpod up failed'))),
      destroyWorkspace: vi.fn(),
    };
    mockGetProvider.mockReturnValue(fakeProvider);

    const steps: SandboxStep[] = [];
    const result = await runSandbox(makeDefaultOptions({ onStep: (s) => steps.push(s) }));

    expect(result.entered).toBe(false);
    expect(steps.some((s) => s.name === 'Workspace' && s.status === 'fail')).toBe(true);
    expect(mockDevpodSsh).not.toHaveBeenCalled();
  });

  it('returns workspaceName in result for reconnection', async () => {
    setupHappyPath();

    const result = await runSandbox(makeDefaultOptions({ cleanup: false }));

    expect(result.workspaceName).toBe('hydraz-test-session-id');
  });

  it('SCPs dist to container before entering shell', async () => {
    setupHappyPath();

    await runSandbox(makeDefaultOptions());

    expect(mockScpToContainer).toHaveBeenCalledWith(
      'hydraz-test-session-id',
      '/dist',
      expect.any(String),
    );
  });

  it('passes skipClone through to createWorkspace', async () => {
    setupHappyPath();

    await runSandbox(makeDefaultOptions({ skipClone: true }));

    const fakeProvider = mockGetProvider.mock.results[0]!.value;
    expect(fakeProvider.createWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ skipClone: true }),
    );
  });

  it('skips GitHub readiness check when skipClone is true', async () => {
    setupHappyPath();

    const steps: SandboxStep[] = [];
    await runSandbox(makeDefaultOptions({ skipClone: true, onStep: (s) => steps.push(s) }));

    expect(mockGetGitHubReadiness).not.toHaveBeenCalled();
    expect(steps.map((s) => s.name)).not.toContain('GitHub config');
  });

  it('calls processHydrazIncludes with the correct workspace name after dist SCP', async () => {
    setupHappyPath();

    await runSandbox(makeDefaultOptions());

    expect(mockProcessHydrazIncludes).toHaveBeenCalledWith(
      '/test/repo',
      'hydraz-test-session-id',
      scpToContainer,
      expect.any(Function),
      '/home/vscode',
    );
  });
});
