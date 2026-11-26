import { describe, expect, it, vi } from 'vitest';

import type { LedgerView } from '../ledger/store.js';

import { SecretLedgerTools } from './secret-ledger.js';

const ENTRY: LedgerView = {
  id: 'e1',
  kind: 'whisper',
  text: 'You smell smoke.',
  knownBy: [{ userId: 'jjjjjjjjjjjjjjjj', name: 'Jorr' }],
  source: 'whisper-desk',
  at: '2026-11-26T12:00:00.000Z',
};

describe('get-secret-ledger', () => {
  it('lists one read-only tool with no required argument', () => {
    const tools = new SecretLedgerTools({ ledger: { query: vi.fn() } });
    const defs = tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual(['get-secret-ledger']);
    expect(defs[0].inputSchema).not.toHaveProperty('required');
  });

  it('answers who knows what, with a readable line', async () => {
    const query = vi.fn().mockResolvedValue([ENTRY]);
    const tools = new SecretLedgerTools({ ledger: { query } });
    const result = (await tools.handleGetSecretLedger({ who: 'Jorr' })) as {
      entries: Array<{ line: string; knownBy: string[]; text: string }>;
    };
    expect(query).toHaveBeenCalledWith({ who: 'Jorr' });
    expect(result.entries[0]).toMatchObject({
      line: 'Only Jorr knows this',
      knownBy: ['Jorr'],
      text: 'You smell smoke.',
    });
  });

  it('passes no filter when none is given', async () => {
    const query = vi.fn().mockResolvedValue([]);
    await new SecretLedgerTools({ ledger: { query } }).handleGetSecretLedger(undefined);
    expect(query).toHaveBeenCalledWith({});
  });
});
