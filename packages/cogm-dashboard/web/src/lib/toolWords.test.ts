// toolWords: a toast never shows a tool id.
import { describe, expect, it, vi } from 'vitest';

vi.mock('./auth', () => ({ authHeaders: (): Record<string, string> => ({}) }));

import { toolWords } from './guarded';

describe('toolWords', () => {
  it('words the known ids and strips the verb of the rest', () => {
    expect(toolWords('apply-planned-change')).toBe('The change');
    expect(toolWords('undo-change')).toBe('Undo');
    expect(toolWords('plan-combat-change')).toBe('Combat change');
    expect(toolWords('create-quest-journal')).toBe('Create quest journal');
  });
});
