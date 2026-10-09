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

  it('does not cache a refusal from the GM gate as other', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ success: false, error: 'Access denied' })
      .mockResolvedValue({ system: 'dnd5e' });
    const client = { query } as any;
    expect(await detectGameSystem(client)).toBe('other');
    expect(await detectGameSystem(client)).toBe('dnd5e');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('logs a GM-gate refusal at warn, not error (it re-asks on every call)', async () => {
    const query = vi.fn().mockResolvedValue({ success: false, error: 'Access denied' });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    expect(await detectGameSystem({ query } as any, logger as any)).toBe('other');
    expect(logger.warn).toHaveBeenCalledWith('World info refused, game system not detected yet', {
      error: 'Access denied',
    });
    expect(logger.error).not.toHaveBeenCalled();
  });
});
