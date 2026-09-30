import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearSystemCache, detectGameSystem } from './system-detection.js';

afterEach(() => clearSystemCache());

describe('detectGameSystem', () => {
  it('caches a successful detection', async () => {
    const query = vi.fn().mockResolvedValue({ system: 'dnd5e' });
    const client = { query } as any;
    expect(await detectGameSystem(client)).toBe('dnd5e');
    expect(await detectGameSystem(client)).toBe('dnd5e');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed query: the next call asks again (P-060)', async () => {
    const query = vi
      .fn()
      .mockRejectedValueOnce(new Error('Foundry not connected'))
      .mockResolvedValue({ system: 'dnd5e' });
    const client = { query } as any;
    expect(await detectGameSystem(client)).toBe('other');
    expect(await detectGameSystem(client)).toBe('dnd5e');
    expect(query).toHaveBeenCalledTimes(2);
  });
});
