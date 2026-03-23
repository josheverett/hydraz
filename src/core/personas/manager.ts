import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { resolveConfigPaths } from '../config/paths.js';
import { BUILT_IN_PERSONAS } from '../config/schema.js';

export interface PersonaInfo {
  name: string;
  displayName: string;
  isBuiltIn: boolean;
  filePath: string;
}

export function toDisplayName(name: string): string {
  return name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function isBuiltIn(name: string): boolean {
  return (BUILT_IN_PERSONAS as readonly string[]).includes(name);
}

export function listPersonas(configDir?: string): PersonaInfo[] {
  const paths = resolveConfigPaths(configDir);

  if (!existsSync(paths.personasDir)) {
    return [];
  }

  const files = readdirSync(paths.personasDir).filter((f) => f.endsWith('.md'));

  return files
    .map((file) => {
      const name = basename(file, '.md');
      return {
        name,
        displayName: toDisplayName(name),
        isBuiltIn: isBuiltIn(name),
        filePath: join(paths.personasDir, file),
      };
    })
    .sort((a, b) => {
      if (a.isBuiltIn && !b.isBuiltIn) return -1;
      if (!a.isBuiltIn && b.isBuiltIn) return 1;
      return a.name.localeCompare(b.name);
    });
}

export function getPersonaContent(name: string, configDir?: string): string | null {
  const paths = resolveConfigPaths(configDir);
  const filePath = join(paths.personasDir, `${name}.md`);

  if (!existsSync(filePath)) {
    return null;
  }

  return readFileSync(filePath, 'utf-8');
}

export function personaExists(name: string, configDir?: string): boolean {
  const paths = resolveConfigPaths(configDir);
  return existsSync(join(paths.personasDir, `${name}.md`));
}

export function addCustomPersona(name: string, content: string, configDir?: string): void {
  if (isBuiltIn(name)) {
    throw new PersonaError(`"${name}" is a built-in persona and cannot be overwritten`);
  }

  if (!isValidPersonaName(name)) {
    throw new PersonaError(
      `"${name}" is not a valid persona name. Use lowercase letters, numbers, and hyphens.`,
    );
  }

  const paths = resolveConfigPaths(configDir);
  mkdirSync(paths.personasDir, { recursive: true });
  writeFileSync(join(paths.personasDir, `${name}.md`), content);
}

export function removeCustomPersona(name: string, configDir?: string): void {
  if (isBuiltIn(name)) {
    throw new PersonaError(`"${name}" is a built-in persona and cannot be removed`);
  }

  const paths = resolveConfigPaths(configDir);
  const filePath = join(paths.personasDir, `${name}.md`);

  if (!existsSync(filePath)) {
    throw new PersonaError(`Persona "${name}" does not exist`);
  }

  unlinkSync(filePath);
}

export function isValidPersonaName(name: string): boolean {
  return /^[a-z][a-z0-9-]*[a-z0-9]$/.test(name) && name.length >= 2 && name.length <= 64;
}

export class PersonaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersonaError';
  }
}
