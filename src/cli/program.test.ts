import { describe, it, expect } from 'vitest';
import { createProgram } from './program.js';

describe('createProgram', () => {
  it('creates a program named hydraz', () => {
    const program = createProgram();
    expect(program.name()).toBe('hydraz');
  });

  it('has the correct version', () => {
    const program = createProgram();
    expect(program.version()).toBe('0.1.0');
  });

  it('has a description', () => {
    const program = createProgram();
    expect(program.description()).toBeTruthy();
  });
});
