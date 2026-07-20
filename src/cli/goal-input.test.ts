import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  GoalInputError,
  resolveGoalInput,
  type GoalInputDependencies,
} from './goal-input.js';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function dependencies(options: {
  files?: Record<string, string>;
  directories?: string[];
  stdin?: string;
  readError?: Error;
} = {}): GoalInputDependencies {
  const files = options.files ?? {};
  const directories = new Set(options.directories ?? []);
  return {
    isFile: vi.fn((path) => Object.hasOwn(files, path) && !directories.has(path)),
    readFile: vi.fn((path) => {
      if (options.readError) throw options.readError;
      if (!Object.hasOwn(files, path)) throw new Error('ENOENT');
      return files[path]!;
    }),
    readStdin: vi.fn(() => options.stdin ?? ''),
  };
}

describe('resolveGoalInput', () => {
  it('resolves an inline goal with stable metadata', () => {
    const result = resolveGoalInput('Implement it', undefined, dependencies());

    expect(result).toEqual({
      content: 'Implement it',
      source: {
        kind: 'inline',
        byteLength: 12,
        sha256: sha256('Implement it'),
      },
    });
  });

  it('reads a local goal file whose path contains spaces', () => {
    const path = '/tmp/my specs/goal.md';
    const content = '# Goal\n\nImplement it.\n';

    const result = resolveGoalInput(undefined, path, dependencies({
      files: { [path]: content },
    }));

    expect(result).toEqual({
      content,
      source: {
        kind: 'file',
        label: path,
        byteLength: Buffer.byteLength(content, 'utf8'),
        sha256: sha256(content),
      },
    });
  });

  it('reads stdin when goal-file is a dash', () => {
    const content = '# Piped goal\n';

    expect(resolveGoalInput(undefined, '-', dependencies({ stdin: content }))).toEqual({
      content,
      source: {
        kind: 'stdin',
        byteLength: Buffer.byteLength(content, 'utf8'),
        sha256: sha256(content),
      },
    });
  });

  it('rejects a missing positional goal and goal-file', () => {
    expect(() => resolveGoalInput(undefined, undefined, dependencies())).toThrow(
      new GoalInputError('Provide exactly one goal: a positional goal or --goal-file <path>.'),
    );
  });

  it('rejects a positional goal combined with goal-file', () => {
    expect(() => resolveGoalInput('Do it', '/tmp/goal.md', dependencies())).toThrow(
      new GoalInputError('Provide exactly one goal: a positional goal or --goal-file <path>.'),
    );
  });

  it('reports an unreadable goal file without leaking the underlying error', () => {
    expect(() => resolveGoalInput(undefined, '/tmp/private.md', dependencies({
      files: { '/tmp/private.md': 'secret' },
      readError: new Error('sensitive filesystem detail'),
    }))).toThrow(
      new GoalInputError('Unable to read goal file: /tmp/private.md'),
    );
  });

  it('rejects a goal-file path that is not a regular file', () => {
    expect(() => resolveGoalInput(undefined, '/tmp/specs', dependencies({
      directories: ['/tmp/specs'],
    }))).toThrow(
      new GoalInputError('Goal file is not a regular file: /tmp/specs'),
    );
  });

  it('rejects an empty file goal', () => {
    expect(() => resolveGoalInput(undefined, '/tmp/empty.md', dependencies({
      files: { '/tmp/empty.md': ' \n\t' },
    }))).toThrow(new GoalInputError('Goal input must not be empty.'));
  });

  it('rejects empty stdin', () => {
    expect(() => resolveGoalInput(undefined, '-', dependencies({ stdin: '' }))).toThrow(
      new GoalInputError('Goal input must not be empty.'),
    );
  });
});
