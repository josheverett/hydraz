import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import {
  listPersonas,
  getPersonaContent,
  personaExists,
  addCustomPersona,
  removeCustomPersona,
  isBuiltIn,
  isValidPersonaName,
  toDisplayName,
  PersonaError,
} from './manager.js';
import { initializeConfigDir } from '../config/init.js';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'hydraz-persona-test-'));
  initializeConfigDir(testDir);
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('isBuiltIn', () => {
  it('returns true for built-in persona names', () => {
    expect(isBuiltIn('architect')).toBe(true);
    expect(isBuiltIn('verifier')).toBe(true);
    expect(isBuiltIn('skeptic')).toBe(true);
  });

  it('returns false for custom persona names', () => {
    expect(isBuiltIn('my-custom')).toBe(false);
    expect(isBuiltIn('special-agent')).toBe(false);
  });
});

describe('toDisplayName', () => {
  it('capitalizes hyphenated names', () => {
    expect(toDisplayName('product-generalist')).toBe('Product Generalist');
    expect(toDisplayName('performance-reliability')).toBe('Performance Reliability');
  });

  it('capitalizes single-word names', () => {
    expect(toDisplayName('architect')).toBe('Architect');
  });
});

describe('isValidPersonaName', () => {
  it('accepts valid names', () => {
    expect(isValidPersonaName('my-custom-persona')).toBe(true);
    expect(isValidPersonaName('agent99')).toBe(true);
    expect(isValidPersonaName('ab')).toBe(true);
  });

  it('rejects names that are too short', () => {
    expect(isValidPersonaName('a')).toBe(false);
  });

  it('rejects names with uppercase', () => {
    expect(isValidPersonaName('MyPersona')).toBe(false);
  });

  it('rejects names with spaces', () => {
    expect(isValidPersonaName('my persona')).toBe(false);
  });

  it('rejects names starting with a hyphen', () => {
    expect(isValidPersonaName('-bad')).toBe(false);
  });

  it('rejects names ending with a hyphen', () => {
    expect(isValidPersonaName('bad-')).toBe(false);
  });
});

describe('listPersonas', () => {
  it('lists all 6 built-in personas after init', () => {
    const personas = listPersonas(testDir);
    const builtIns = personas.filter((p) => p.isBuiltIn);
    expect(builtIns).toHaveLength(6);
  });

  it('sorts built-in personas before custom ones', () => {
    addCustomPersona('zzz-custom', '# ZZZ', testDir);
    const personas = listPersonas(testDir);
    const firstCustomIndex = personas.findIndex((p) => !p.isBuiltIn);
    const lastBuiltInIndex = personas.length - 1 - [...personas].reverse().findIndex((p) => p.isBuiltIn);
    expect(lastBuiltInIndex).toBeLessThan(firstCustomIndex);
  });

  it('returns empty array when personas dir does not exist', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'hydraz-empty-'));
    const personas = listPersonas(emptyDir);
    expect(personas).toEqual([]);
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it('includes display names', () => {
    const personas = listPersonas(testDir);
    const architect = personas.find((p) => p.name === 'architect');
    expect(architect?.displayName).toBe('Architect');
  });
});

describe('getPersonaContent', () => {
  it('returns content for a built-in persona', () => {
    const content = getPersonaContent('architect', testDir);
    expect(content).not.toBeNull();
    expect(content).toContain('Architect');
  });

  it('returns null for a non-existent persona', () => {
    expect(getPersonaContent('does-not-exist', testDir)).toBeNull();
  });
});

describe('personaExists', () => {
  it('returns true for a built-in persona', () => {
    expect(personaExists('architect', testDir)).toBe(true);
  });

  it('returns false for a non-existent persona', () => {
    expect(personaExists('nope', testDir)).toBe(false);
  });
});

describe('addCustomPersona', () => {
  it('creates a new custom persona file', () => {
    addCustomPersona('my-agent', '# My Agent\nDoes things.', testDir);
    expect(personaExists('my-agent', testDir)).toBe(true);
    expect(getPersonaContent('my-agent', testDir)).toContain('My Agent');
  });

  it('throws when trying to overwrite a built-in', () => {
    expect(() => addCustomPersona('architect', 'hacked', testDir)).toThrow(PersonaError);
  });

  it('throws for invalid names', () => {
    expect(() => addCustomPersona('Bad Name', 'content', testDir)).toThrow(PersonaError);
  });

  it('appears in the persona list', () => {
    addCustomPersona('custom-one', '# Custom', testDir);
    const names = listPersonas(testDir).map((p) => p.name);
    expect(names).toContain('custom-one');
  });
});

describe('removeCustomPersona', () => {
  it('removes a custom persona', () => {
    addCustomPersona('temp-persona', '# Temp', testDir);
    expect(personaExists('temp-persona', testDir)).toBe(true);

    removeCustomPersona('temp-persona', testDir);
    expect(personaExists('temp-persona', testDir)).toBe(false);
  });

  it('throws when trying to remove a built-in', () => {
    expect(() => removeCustomPersona('architect', testDir)).toThrow(PersonaError);
  });

  it('throws when persona does not exist', () => {
    expect(() => removeCustomPersona('ghost', testDir)).toThrow(PersonaError);
  });
});
