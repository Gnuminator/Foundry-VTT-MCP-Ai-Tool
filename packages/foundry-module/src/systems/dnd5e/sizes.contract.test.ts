/**
 * The module mirrors the backend's dnd5e size normalizer (it cannot import
 * backend code). This pins the two together, and checks the mirror's own rules.
 */
import { describe, expect, it } from 'vitest';
import { DND5E_SIZE_KEYS, dnd5eSizeKey, sameDnd5eSize } from './sizes.js';
import {
  DnD5eSizeKeys,
  SizeFilterInputs,
  normalizeDnD5eSizeKey,
} from '../../../../mcp-server/src/systems/dnd5e/filters.js';

describe('dnd5e sizes: module mirror vs backend filter', () => {
  it('agree on the size keys', () => {
    expect([...DND5E_SIZE_KEYS]).toEqual([...DnD5eSizeKeys]);
  });

  it('normalize every accepted input the same way', () => {
    for (const input of SizeFilterInputs) {
      expect(dnd5eSizeKey(input)).toBe(normalizeDnD5eSizeKey(input));
    }
    expect(dnd5eSizeKey('colossal')).toBe(normalizeDnD5eSizeKey('colossal'));
  });
});

describe('sameDnd5eSize', () => {
  it('treats a display word and its key as the same size, in any case', () => {
    expect(sameDnd5eSize('med', 'medium')).toBe(true);
    expect(sameDnd5eSize('Medium', 'MED')).toBe(true);
    expect(sameDnd5eSize('grg', 'Gargantuan')).toBe(true);
    expect(sameDnd5eSize('sm', 'medium')).toBe(false);
  });

  it('compares unknown sizes as text', () => {
    expect(sameDnd5eSize('colossal', 'Colossal')).toBe(true);
    expect(sameDnd5eSize('colossal', 'huge')).toBe(false);
  });
});
