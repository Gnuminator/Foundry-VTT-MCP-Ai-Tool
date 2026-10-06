/**
 * The GM page saves `?token=` into the browser and then removes it from the address bar, so the
 * GM token does not stay in the browser history. The snippet is taken out of public/app.js and run
 * against stand-ins for `location`, `localStorage` and `history` (the dashboard has no DOM test setup).
 */
import { readFileSync } from 'fs';
import { runInNewContext } from 'vm';

import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const start = source.indexOf('const COGM_TOKEN = (() => {');
const end = source.indexOf('})();', start) + '})();'.length;
const snippet = source.slice(start, end);

function run(
  href: string,
  storeFails = false
): { token: string; store: Map<string, string>; replaced: string[] } {
  const store = new Map<string, string>();
  const replaced: string[] = [];
  const localStorage = {
    setItem(k: string, v: string): void {
      if (storeFails) throw new Error('blocked');
      store.set(k, v);
    },
    getItem: (k: string): string | null => store.get(k) ?? null,
  };
  const history = {
    state: null,
    replaceState: (_s: unknown, _t: string, url: string): number => replaced.push(url),
  };
  const location = { href };
  const token = runInNewContext(
    `${snippet}
COGM_TOKEN;`,
    {
      location,
      localStorage,
      history,
      URL,
    }
  ) as string;
  return { token, store, replaced };
}

describe('GM token in the address bar', () => {
  it('finds the snippet', () => {
    expect(start).toBeGreaterThan(0);
    expect(snippet).toContain('replaceState');
  });

  it('saves the token and removes only it from the address', () => {
    const r = run('http://pi:3000/?token=SECRET&view=after#notes');
    expect(r.token).toBe('SECRET');
    expect(r.store.get('cogm_token')).toBe('SECRET');
    expect(r.replaced).toEqual(['/?view=after#notes']);
  });

  it('leaves a bare path when the token was the only parameter', () => {
    expect(run('http://pi:3000/?token=SECRET').replaced).toEqual(['/']);
  });

  it('keeps the token in the address when it could not be saved', () => {
    const r = run('http://pi:3000/?token=SECRET', true);
    expect(r.token).toBe('SECRET');
    expect(r.replaced).toEqual([]);
  });

  it('does nothing without a token in the address', () => {
    const r = run('http://pi:3000/');
    expect(r.token).toBe('');
    expect(r.replaced).toEqual([]);
  });
});
