import { describe, it, expect } from 'vitest';
import { createProgram } from './program.js';

const EXPECTED_COMMANDS = [
  'config',
  'run',
  'attach',
  'sessions',
  'status',
  'review',
  'resume',
  'stop',
  'events',
  'personas',
  'mcp',
  'clean',
] as const;

describe('createProgram', () => {
  it('creates a program named hydraz', () => {
    const program = createProgram();
    expect(program.name()).toBe('hydraz');
  });

  it('has the correct version from package.json', () => {
    const program = createProgram();
    expect(program.version()).toBe('2.0.0');
  });

  it('has a description', () => {
    const program = createProgram();
    expect(program.description()).toBeTruthy();
  });

  it('registers all expected commands', () => {
    const program = createProgram();
    const commandNames = program.commands.map((cmd) => cmd.name());

    for (const name of EXPECTED_COMMANDS) {
      expect(commandNames, `missing command: ${name}`).toContain(name);
    }
  });

  it('registers exactly the expected number of commands', () => {
    const program = createProgram();
    expect(program.commands).toHaveLength(EXPECTED_COMMANDS.length);
  });

  it('every command has a description', () => {
    const program = createProgram();
    for (const cmd of program.commands) {
      expect(cmd.description(), `${cmd.name()} missing description`).toBeTruthy();
    }
  });

  it('run command accepts a task argument', () => {
    const program = createProgram();
    const runCmd = program.commands.find((cmd) => cmd.name() === 'run');
    expect(runCmd).toBeDefined();

    const args = runCmd!.registeredArguments;
    expect(args).toHaveLength(1);
    expect(args[0].required).toBe(true);
  });

  it('run command has local and cloud options', () => {
    const program = createProgram();
    const runCmd = program.commands.find((cmd) => cmd.name() === 'run');
    expect(runCmd).toBeDefined();

    const optionNames = runCmd!.options.map((opt) => opt.long);
    expect(optionNames).toContain('--local');
    expect(optionNames).toContain('--cloud');
    expect(optionNames).toContain('--session');
    expect(optionNames).toContain('--branch');
  });
});
