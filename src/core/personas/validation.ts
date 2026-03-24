import { PersonaError } from './manager.js';

export function validateSwarmSelection(
  selected: string[],
  availableNames: string[],
): [string, string, string] {
  if (selected.length !== 3) {
    throw new PersonaError(
      `Swarm must contain exactly 3 personas, got ${selected.length}`,
    );
  }

  const unique = new Set(selected);
  if (unique.size !== 3) {
    throw new PersonaError('Swarm personas must be unique');
  }

  for (const name of selected) {
    if (!availableNames.includes(name)) {
      throw new PersonaError(`Persona "${name}" does not exist`);
    }
  }

  return selected as unknown as [string, string, string];
}
