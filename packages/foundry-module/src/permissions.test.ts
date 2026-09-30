import { describe, expect, it } from 'vitest';
import { PermissionManager } from './permissions.js';

describe('PermissionManager.validateOperationParameters createActor quantity (P-062)', () => {
  const validate = (quantity: number): { valid: boolean; errors: string[] } =>
    new PermissionManager().validateOperationParameters('createActor', {
      creatureType: 'goblin',
      quantity,
    });

  it('accepts 1 to 50, the range of the Max Actors Per Request setting', () => {
    for (const quantity of [1, 10, 11, 50]) {
      expect(validate(quantity)).toMatchObject({ valid: true, errors: [] });
    }
  });

  it('rejects quantities outside 1 to 50', () => {
    expect(validate(51).errors).toEqual(['quantity must be a number between 1 and 50']);
    expect(validate(-1).valid).toBe(false);
  });
});
