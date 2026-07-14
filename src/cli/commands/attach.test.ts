import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { buildTailEventsCommand } from './attach.js';

function parseAsPosixShell(command: string): void {
  execFileSync('/bin/sh', ['-n'], { input: command, stdio: 'pipe' });
}

describe('attach command', () => {
  it('[shell regression] quotes spaces and apostrophes in a valid POSIX shell program', () => {
    const eventsPath = "/tmp/hydraz events/it's/events.jsonl";
    const command = buildTailEventsCommand(eventsPath);

    expect(command).toBe("tail -f '/tmp/hydraz events/it'\\''s/events.jsonl'");
    expect(() => parseAsPosixShell(command)).not.toThrow();
  });

  it('[shell regression] quotes shell metacharacters in a valid POSIX shell program', () => {
    const eventsPath = '/tmp/events;$(not-run)|`also-not-run`.jsonl';
    const command = buildTailEventsCommand(eventsPath);

    expect(command).toBe("tail -f '/tmp/events;$(not-run)|`also-not-run`.jsonl'");
    expect(() => parseAsPosixShell(command)).not.toThrow();
  });
});
