import { describe, expect, it, vi } from 'vitest';

import { CACHED_READ_TOOLS, createReadCache } from './read-cache.js';

describe('read cache', () => {
  it('shares one call inside the window and asks again after it', async () => {
    let t = 0;
    const cache = createReadCache(() => t, 5_000);
    const load = vi.fn(async () => ({ n: load.mock.calls.length }));
    const [a, b] = await Promise.all([
      cache.get('get-play-stats', { session: 'latest' }, load),
      cache.get('get-play-stats', { session: 'latest' }, load),
    ]);
    expect(a).toBe(b);
    expect(load).toHaveBeenCalledTimes(1);
    t = 4_999;
    await cache.get('get-play-stats', { session: 'latest' }, load);
    expect(load).toHaveBeenCalledTimes(1);
    t = 5_000;
    await cache.get('get-play-stats', { session: 'latest' }, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keys on the arguments and forgets everything on clear', async () => {
    const cache = createReadCache(() => 0, 5_000);
    const load = vi.fn(async () => 1);
    await cache.get('get-prep-digest', { action: 'summary' }, load);
    await cache.get('get-prep-digest', { action: 'last-session' }, load);
    expect(load).toHaveBeenCalledTimes(2);
    cache.clear();
    await cache.get('get-prep-digest', { action: 'summary' }, load);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('does not keep a failure', async () => {
    const cache = createReadCache(() => 0, 5_000);
    const load = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue('ok');
    await expect(cache.get('list-scenes', {}, load)).rejects.toThrow('down');
    await expect(cache.get('list-scenes', {}, load)).resolves.toBe('ok');
  });

  it('never covers the lists that show write results', () => {
    for (const name of [
      'list-recent-changes',
      'list-revealed-pages',
      'get-prep-digest',
      'get-combat-state',
    ]) {
      expect(CACHED_READ_TOOLS.has(name)).toBe(false);
    }
  });
});
