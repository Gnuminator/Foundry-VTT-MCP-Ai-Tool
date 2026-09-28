import { describe, expect, it } from 'vitest';

import { gmOnly } from './redact.js';

describe('gmOnly', () => {
  it('passes a GM-hub payload straight through to the GM and drops it entirely for anyone else', () => {
    // e.g. the settings broadcast, which carries the Obsidian vault name (O2).
    const payload = { gmActionsEnabled: true, obsidian: { vault: 'GM Vault' } };
    expect(gmOnly(payload, 'gm')).toBe(payload);
    expect(gmOnly(payload, 'player')).toBeUndefined();
  });
});
