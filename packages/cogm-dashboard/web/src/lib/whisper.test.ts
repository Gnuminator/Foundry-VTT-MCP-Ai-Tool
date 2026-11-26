import { describe, expect, it } from 'vitest';

import { whisperDone } from './whisper';

describe('whisperDone', () => {
  it('says it went out in Foundry and is queued on Discord', () => {
    expect(whisperDone('Jorr', { foundry: true, discord: 'queued' })).toEqual({
      ok: true,
      text: '✓ Whispered to Jorr in Foundry. Discord message goes out within a few minutes.',
    });
  });

  it('names a player with no Discord link', () => {
    const done = whisperDone('Mia', { foundry: true, discord: 'no-link' });
    expect(done.ok).toBe(true);
    expect(done.text).toContain('Mia has no Discord link');
  });

  it('flags a Discord step or ledger write that did not happen', () => {
    const done = whisperDone('Jorr', {
      foundry: true,
      discord: 'failed',
      warnings: ['Not queued on Discord: full'],
    });
    expect(done.ok).toBe(false);
    expect(done.text).toContain('Not queued on Discord: full');
  });
});
