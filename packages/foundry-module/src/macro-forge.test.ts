import { describe, expect, it } from 'vitest';
import { assertMacroUpdateAllowed } from './macro-forge.js';

describe('assertMacroUpdateAllowed', () => {
  // The create rules (source scan, GM only, redo in undo mode) are tested in shared/src/macro-source.test.ts.
  it('refuses a plan that changes the script, type, owners or flags', () => {
    for (const path of [
      'command',
      'type',
      'ownership.default',
      'ownership.u1',
      '-=ownership',
      'flags.x.y',
      'author',
    ]) {
      expect(() => assertMacroUpdateAllowed('scene-mood', [path])).toThrow(/cannot be changed/);
    }
  });
  it('lets harmless fields and an undo through', () => {
    expect(() => assertMacroUpdateAllowed('scene-mood', ['name', 'img', 'folder'])).not.toThrow();
    expect(() => assertMacroUpdateAllowed('change-undo', ['command', 'ownership'])).not.toThrow();
    expect(() => assertMacroUpdateAllowed('rollback', ['command'])).not.toThrow();
  });
});
