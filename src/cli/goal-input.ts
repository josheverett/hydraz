import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import type { GoalInputSource } from '../core/sessions/index.js';

export interface ResolvedGoalInput {
  content: string;
  source: GoalInputSource;
}

export interface GoalInputDependencies {
  readFile(path: string): string;
  isFile(path: string): boolean;
  readStdin(): string;
}

export class GoalInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoalInputError';
  }
}

const DEFAULT_DEPENDENCIES: GoalInputDependencies = {
  readFile: (path) => readFileSync(path, 'utf8'),
  isFile: (path) => statSync(path).isFile(),
  readStdin: () => {
    if (process.stdin.isTTY) {
      throw new GoalInputError('No stdin content is available for --goal-file -.');
    }
    return readFileSync(0, 'utf8');
  },
};

export function resolveGoalInput(
  goal: string | undefined,
  goalFile: string | undefined,
  dependencies: GoalInputDependencies = DEFAULT_DEPENDENCIES,
): ResolvedGoalInput {
  if ((goal === undefined) === (goalFile === undefined)) {
    throw new GoalInputError(
      'Provide exactly one goal: a positional goal or --goal-file <path>.',
    );
  }

  let content: string;
  let sourceKind: GoalInputSource['kind'];
  if (goal !== undefined) {
    content = goal;
    sourceKind = 'inline';
  } else if (goalFile === '-') {
    try {
      content = dependencies.readStdin();
    } catch (error) {
      if (error instanceof GoalInputError) throw error;
      throw new GoalInputError('Unable to read goal from stdin.');
    }
    sourceKind = 'stdin';
  } else {
    const path = goalFile!;
    let isFile: boolean;
    try {
      isFile = dependencies.isFile(path);
    } catch {
      throw new GoalInputError(`Unable to read goal file: ${path}`);
    }
    if (!isFile) {
      throw new GoalInputError(`Goal file is not a regular file: ${path}`);
    }
    try {
      content = dependencies.readFile(path);
    } catch {
      throw new GoalInputError(`Unable to read goal file: ${path}`);
    }
    sourceKind = 'file';
  }

  if (!content.trim()) {
    throw new GoalInputError('Goal input must not be empty.');
  }
  const byteLength = Buffer.byteLength(content, 'utf8');
  const sha256 = createHash('sha256').update(content, 'utf8').digest('hex');

  if (sourceKind === 'file') {
    return {
      content,
      source: {
        kind: 'file',
        label: goalFile!,
        byteLength,
        sha256,
      },
    };
  }
  return {
    content,
    source: {
      kind: sourceKind,
      byteLength,
      sha256,
    },
  };
}
