import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { assemblePrompt, describePromptSources } from './builder.js';
import { initializeConfigDir } from '../config/init.js';
import { createSession } from '../sessions/schema.js';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'hydraz-prompt-test-'));
  initializeConfigDir(testDir);
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function makeSession() {
  return createSession({
    name: 'test-session',
    repoRoot: '/tmp/repo',
    branchName: 'hydraz/test-session',
    personas: ['architect', 'implementer', 'verifier'],
    executionTarget: 'local',
    task: 'Fix the auth timeout regression',
  });
}

describe('assemblePrompt', () => {
  it('produces exactly 5 layers: master + 3 personas + task', () => {
    const session = makeSession();
    const prompt = assemblePrompt(session, testDir);
    expect(prompt.layers).toHaveLength(5);
  });

  it('first layer is the master prompt', () => {
    const session = makeSession();
    const prompt = assemblePrompt(session, testDir);
    expect(prompt.layers[0].name).toBe('master');
    expect(prompt.layers[0].content).toContain('Hydraz Swarm System Prompt');
  });

  it('layers 2-4 are the persona prompts in order', () => {
    const session = makeSession();
    const prompt = assemblePrompt(session, testDir);
    expect(prompt.layers[1].name).toBe('persona:architect');
    expect(prompt.layers[2].name).toBe('persona:implementer');
    expect(prompt.layers[3].name).toBe('persona:verifier');
  });

  it('persona layers contain persona content', () => {
    const session = makeSession();
    const prompt = assemblePrompt(session, testDir);
    expect(prompt.layers[1].content).toContain('Architect');
    expect(prompt.layers[2].content).toContain('Implementer');
    expect(prompt.layers[3].content).toContain('Verifier');
  });

  it('last layer is the task prompt', () => {
    const session = makeSession();
    const prompt = assemblePrompt(session, testDir);
    const taskLayer = prompt.layers[4];
    expect(taskLayer.name).toBe('task');
    expect(taskLayer.content).toContain('Fix the auth timeout regression');
    expect(taskLayer.content).toContain('test-session');
    expect(taskLayer.content).toContain('hydraz/test-session');
  });

  it('fullText joins all layers with separators', () => {
    const session = makeSession();
    const prompt = assemblePrompt(session, testDir);
    expect(prompt.fullText).toContain('Hydraz Swarm System Prompt');
    expect(prompt.fullText).toContain('Architect');
    expect(prompt.fullText).toContain('Fix the auth timeout regression');
    expect(prompt.fullText.split('---').length).toBeGreaterThanOrEqual(5);
  });

  it('tracks session id and personas', () => {
    const session = makeSession();
    const prompt = assemblePrompt(session, testDir);
    expect(prompt.sessionId).toBe(session.id);
    expect(prompt.personas).toEqual(['architect', 'implementer', 'verifier']);
  });

  it('handles missing persona gracefully', () => {
    const session = createSession({
      name: 'test',
      repoRoot: '/tmp/repo',
      branchName: 'hydraz/test',
      personas: ['architect', 'nonexistent', 'verifier'],
      executionTarget: 'local',
      task: 'Do stuff',
    });
    const prompt = assemblePrompt(session, testDir);
    expect(prompt.layers[2].content).toContain('[Persona "nonexistent" not found]');
  });

  it('persona array is a copy, not a reference', () => {
    const session = makeSession();
    const prompt = assemblePrompt(session, testDir);
    expect(prompt.personas).not.toBe(session.personas);
  });
});

describe('describePromptSources', () => {
  it('lists all layers with sources', () => {
    const session = makeSession();
    const prompt = assemblePrompt(session, testDir);
    const description = describePromptSources(prompt);
    expect(description).toContain('master');
    expect(description).toContain('persona:architect');
    expect(description).toContain('persona:implementer');
    expect(description).toContain('persona:verifier');
    expect(description).toContain('task');
    expect(description).toContain('master-prompt.md');
    expect(description).toContain('session-input');
  });
});
