import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { createProgram } from './program.js';

const packageJson = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'), 'utf-8'),
) as { version: string };

const EXPECTED_COMMANDS = [
  'config',
  'run',
  'attach',
  'sessions',
  'status',
  'resume',
  'stop',
  'logs',
  'clean',
  'shell',
] as const;

describe('createProgram', () => {
  it('creates a program named hydraz', () => {
    const program = createProgram();
    expect(program.name()).toBe('hydraz');
  });

  it('has the correct version from package.json', () => {
    const program = createProgram();
    expect(program.version()).toBe(packageJson.version);
  });

  it('registers the v3 command surface only', () => {
    const program = createProgram();
    const commandNames = program.commands
      .map((cmd) => cmd.name())
      .filter((name) => !name.startsWith('__'))
      .sort();
    expect(commandNames).toEqual([...EXPECTED_COMMANDS].sort());
  });

  it('registers the internal SEA runner payload smoke command', () => {
    const program = createProgram();
    const internal = program.commands.find((cmd) => cmd.name() === '__sea-runner-payload');
    expect(internal).toBeDefined();
    expect(internal!.description()).toBeTruthy();
  });

  it('every command has a description', () => {
    const program = createProgram();
    for (const cmd of program.commands.filter((command) => !command.name().startsWith('__'))) {
      expect(cmd.description(), `${cmd.name()} missing description`).toBeTruthy();
    }
  });

  it('sessions command exposes clear subcommand with safety options', () => {
    const program = createProgram();
    const sessionsCmd = program.commands.find((cmd) => cmd.name() === 'sessions')!;
    const clearCmd = sessionsCmd.commands.find((cmd) => cmd.name() === 'clear');

    expect(clearCmd).toBeDefined();
    expect(clearCmd!.description()).toBeTruthy();
    expect(clearCmd!.options.map((opt) => opt.long)).toEqual(
      expect.arrayContaining(['--force', '--dry-run']),
    );
  });

  it('run command accepts a required goal argument', () => {
    const program = createProgram();
    const runCmd = program.commands.find((cmd) => cmd.name() === 'run');
    expect(runCmd).toBeDefined();
    expect(runCmd!.registeredArguments).toHaveLength(1);
    expect(runCmd!.registeredArguments[0].required).toBe(true);
  });

  it('run command exposes Codex v3 options and rejects old worker/review options', () => {
    const program = createProgram();
    const runCmd = program.commands.find((cmd) => cmd.name() === 'run')!;
    const optionNames = runCmd.options.map((opt) => opt.long);

    expect(optionNames).toContain('--model');
    expect(optionNames).toContain('--sandbox');
    expect(optionNames).toContain('--search');
    expect(optionNames).toContain('--base');
    expect(optionNames).toContain('--no-push');
    expect(optionNames).toContain('--no-pr');
    expect(optionNames).toContain('--keep-workspace');
    expect(optionNames).not.toContain('--workers');
    expect(optionNames).not.toContain('--reviewers');
    expect(optionNames).not.toContain('--parallel');
  });
});
