import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { loadArtifact, summarizeArtifacts, getArtifactStatus } from './artifacts.js';
import { initRepoState, createNewSession, getArtifactPath } from './manager.js';
import { resolveRepoDataPaths } from '../repo/paths.js';

let repoRoot: string;
let sessionId: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'hydraz-artifact-test-'));
  initRepoState(repoRoot);
  const session = createNewSession({
    name: 'artifact-test',
    repoRoot,
    branchName: 'hydraz/artifact-test',
    personas: ['architect', 'implementer', 'verifier'],
    executionTarget: 'local',
    task: 'Test artifacts',
  });
  sessionId = session.id;
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
  rmSync(resolveRepoDataPaths(repoRoot).repoDataDir, { recursive: true, force: true });
});

describe('loadArtifact', () => {
  it('returns null when artifact does not exist', () => {
    expect(loadArtifact(repoRoot, sessionId, 'plan.md')).toBeNull();
  });

  it('returns content when artifact exists', () => {
    const path = getArtifactPath(repoRoot, sessionId, 'plan.md');
    writeFileSync(path, '# Plan\n\nStep 1: Do the thing');

    const content = loadArtifact(repoRoot, sessionId, 'plan.md');
    expect(content).toContain('Step 1');
  });
});

describe('summarizeArtifacts', () => {
  it('returns all 5 artifacts with exists=false when none produced', () => {
    const summaries = summarizeArtifacts(repoRoot, sessionId);
    expect(summaries).toHaveLength(5);
    expect(summaries.every((s) => !s.exists)).toBe(true);
  });

  it('marks produced artifacts with preview and size', () => {
    const path = getArtifactPath(repoRoot, sessionId, 'intake.md');
    writeFileSync(path, '# Intake\n\nTask: fix the auth bug');

    const summaries = summarizeArtifacts(repoRoot, sessionId);
    const intake = summaries.find((s) => s.file === 'intake.md')!;
    expect(intake.exists).toBe(true);
    expect(intake.preview).toContain('fix the auth bug');
    expect(intake.sizeBytes).toBeGreaterThan(0);
  });
});

describe('getArtifactStatus', () => {
  it('reports 0/5 when no artifacts exist', () => {
    const summaries = summarizeArtifacts(repoRoot, sessionId);
    expect(getArtifactStatus(summaries)).toBe('0/5 artifacts produced');
  });

  it('reports correct count when some artifacts exist', () => {
    writeFileSync(getArtifactPath(repoRoot, sessionId, 'plan.md'), '# Plan');
    writeFileSync(getArtifactPath(repoRoot, sessionId, 'pr-draft.md'), '# PR');

    const summaries = summarizeArtifacts(repoRoot, sessionId);
    expect(getArtifactStatus(summaries)).toBe('2/5 artifacts produced');
  });
});
