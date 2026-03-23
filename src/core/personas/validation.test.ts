import { describe, it, expect } from 'vitest';
import { validateSwarmSelection } from './validation.js';
import { PersonaError } from './manager.js';

const available = ['architect', 'implementer', 'verifier', 'skeptic', 'custom-one'];

describe('validateSwarmSelection', () => {
  it('accepts a valid selection of exactly 3', () => {
    const result = validateSwarmSelection(
      ['architect', 'implementer', 'verifier'],
      available,
    );
    expect(result).toEqual(['architect', 'implementer', 'verifier']);
  });

  it('accepts custom personas in the selection', () => {
    const result = validateSwarmSelection(
      ['architect', 'custom-one', 'skeptic'],
      available,
    );
    expect(result).toHaveLength(3);
  });

  it('rejects fewer than 3 personas', () => {
    expect(() => validateSwarmSelection(['architect', 'verifier'], available)).toThrow(
      PersonaError,
    );
  });

  it('rejects more than 3 personas', () => {
    expect(() =>
      validateSwarmSelection(['architect', 'implementer', 'verifier', 'skeptic'], available),
    ).toThrow(PersonaError);
  });

  it('rejects duplicate personas', () => {
    expect(() =>
      validateSwarmSelection(['architect', 'architect', 'verifier'], available),
    ).toThrow(PersonaError);
  });

  it('rejects personas not in the available list', () => {
    expect(() =>
      validateSwarmSelection(['architect', 'implementer', 'nonexistent'], available),
    ).toThrow(PersonaError);
  });

  it('returns a typed 3-tuple', () => {
    const result = validateSwarmSelection(
      ['architect', 'implementer', 'verifier'],
      available,
    );
    expect(result).toHaveLength(3);
    const [a, b, c] = result;
    expect(a).toBe('architect');
    expect(b).toBe('implementer');
    expect(c).toBe('verifier');
  });
});
