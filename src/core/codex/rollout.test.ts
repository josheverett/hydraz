import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyCodexRollout } from './rollout.js';

const tempRoots: string[] = [];
const expected = {
  model: 'gpt-5.6-sol',
  reasoningEffort: 'ultra',
  serviceTier: 'priority' as const,
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeRollout(
  items: Array<Record<string, unknown>>,
): { codexHome: string; path: string; threadId: string } {
  const root = mkdtempSync(join(tmpdir(), 'hydraz-rollout-test-'));
  tempRoots.push(root);
  const codexHome = join(root, 'codex-home');
  const sessionsDir = join(codexHome, 'sessions', '2026', '07', '15');
  const threadId = 'thread-rollout';
  const path = join(sessionsDir, `rollout-${threadId}.jsonl`);
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(
    path,
    items.map((item) => JSON.stringify(item)).join('\n') + '\n',
  );
  return { codexHome, path, threadId };
}

function turnContext(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    timestamp: '2026-07-15T00:00:00.000Z',
    type: 'turn_context',
    payload,
  };
}

describe('verifyCodexRollout', () => {
  it('does not reuse a prior turn when a resume appends no context', () => {
    const rollout = makeRollout([
      turnContext({ model: 'gpt-5.6-sol', effort: 'ultra' }),
    ]);
    const checkpoint = {
      sourcePath: rollout.path,
      byteLength: statSync(rollout.path).size,
    };

    const result = verifyCodexRollout({
      codexHome: rollout.codexHome,
      threadId: rollout.threadId,
      attemptId: 'attempt-current',
      checkpoint,
      expected,
    });

    expect(result.status).toBe('unavailable');
    expect(result.reason).toContain('No new turn_context');
  });

  it('matches a fresh turn context appended after the checkpoint', () => {
    const rollout = makeRollout([
      turnContext({ model: 'gpt-5.5', effort: 'medium' }),
    ]);
    const checkpoint = {
      sourcePath: rollout.path,
      byteLength: statSync(rollout.path).size,
    };
    appendFileSync(
      rollout.path,
      JSON.stringify(turnContext({
        model: 'gpt-5.6-sol',
        effort: 'ultra',
      })) + '\n',
    );

    const result = verifyCodexRollout({
      codexHome: rollout.codexHome,
      threadId: rollout.threadId,
      attemptId: 'attempt-current',
      checkpoint,
      expected,
    });

    expect(result).toMatchObject({
      attemptId: 'attempt-current',
      status: 'matched',
      observed: {
        model: 'gpt-5.6-sol',
        reasoningEffort: 'ultra',
      },
    });
  });

  it('fails closed when newly appended rollout data is malformed', () => {
    const rollout = makeRollout([
      turnContext({ model: 'gpt-5.6-sol', effort: 'ultra' }),
    ]);
    const checkpoint = {
      sourcePath: rollout.path,
      byteLength: statSync(rollout.path).size,
    };
    appendFileSync(rollout.path, '{not-json\n');

    const result = verifyCodexRollout({
      codexHome: rollout.codexHome,
      threadId: rollout.threadId,
      attemptId: 'attempt-current',
      checkpoint,
      expected,
    });

    expect(result.status).toBe('unavailable');
    expect(result.reason).toContain('Malformed');
  });

  it('fails closed when the latest appended turn context shape changes', () => {
    const rollout = makeRollout([
      turnContext({ model: 'gpt-5.6-sol', effort: 'ultra' }),
    ]);
    const checkpoint = {
      sourcePath: rollout.path,
      byteLength: statSync(rollout.path).size,
    };
    appendFileSync(
      rollout.path,
      JSON.stringify(turnContext({
        model_name: 'gpt-5.6-sol',
        reasoning: 'ultra',
      })) + '\n',
    );

    const result = verifyCodexRollout({
      codexHome: rollout.codexHome,
      threadId: rollout.threadId,
      attemptId: 'attempt-current',
      checkpoint,
      expected,
    });

    expect(result.status).toBe('unavailable');
    expect(result.reason).toContain('required model and reasoning effort');
  });

  it('fails closed when the checkpoint source changes', () => {
    const rollout = makeRollout([
      turnContext({ model: 'gpt-5.6-sol', effort: 'ultra' }),
    ]);

    const result = verifyCodexRollout({
      codexHome: rollout.codexHome,
      threadId: rollout.threadId,
      attemptId: 'attempt-current',
      checkpoint: {
        sourcePath: join(rollout.codexHome, 'sessions', 'old-rollout.jsonl'),
        byteLength: 0,
      },
      expected,
    });

    expect(result.status).toBe('unavailable');
    expect(result.reason).toContain('source changed');
  });

  it.each([
    {
      name: 'model',
      payload: { model: 'gpt-5.6-sol' },
      unavailableCheck: 'reasoningEffort',
    },
    {
      name: 'reasoning effort',
      payload: { effort: 'ultra' },
      unavailableCheck: 'model',
    },
  ])('does not report matched when required $name evidence is missing', ({
    payload,
    unavailableCheck,
  }) => {
    const rollout = makeRollout([turnContext(payload)]);

    const result = verifyCodexRollout({
      codexHome: rollout.codexHome,
      threadId: rollout.threadId,
      attemptId: 'attempt-current',
      expected,
    });

    expect(result.status).toBe('unavailable');
    expect(result.checks[unavailableCheck as 'model' | 'reasoningEffort']).toBe(
      'unavailable',
    );
  });

  it('allows absent service tier when required model and effort match', () => {
    const rollout = makeRollout([
      turnContext({ model: 'gpt-5.6-sol', effort: 'ultra' }),
    ]);

    const result = verifyCodexRollout({
      codexHome: rollout.codexHome,
      threadId: rollout.threadId,
      attemptId: 'attempt-current',
      expected,
    });

    expect(result).toMatchObject({
      attemptId: 'attempt-current',
      status: 'matched',
      checks: {
        model: 'matched',
        reasoningEffort: 'matched',
        serviceTier: 'unavailable',
      },
    });
  });
});
