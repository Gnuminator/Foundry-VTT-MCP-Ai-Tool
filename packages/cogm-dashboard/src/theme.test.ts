import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_THEME, ThemeStore, isTheme } from './theme.js';

let dir: string;

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cogm-theme-'));
});

afterEach(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
});

describe('isTheme', () => {
  it('knows the neutral and the Veil theme only', () => {
    expect(isTheme('neutral')).toBe(true);
    expect(isTheme('veil')).toBe(true);
    expect(isTheme('tarokka')).toBe(false);
    expect(isTheme(undefined)).toBe(false);
  });
});

describe('ThemeStore', () => {
  it('starts on the default theme, for a known or unknown world', () => {
    const store = new ThemeStore(null);
    expect(store.get(null)).toBe(DEFAULT_THEME);
    expect(store.get('ai-tool-demo')).toBe('neutral');
  });

  it('keeps one theme per world, in memory without a file', async () => {
    const store = new ThemeStore(null);
    await store.set('strahd', 'veil');
    expect(store.get('strahd')).toBe('veil');
    expect(store.get('other-world')).toBe('neutral');
  });

  it('survives a restart through its file', async () => {
    const file = path.join(dir, 'nested', 'dashboard-themes.json');
    await new ThemeStore(file).set('strahd', 'veil');
    expect(new ThemeStore(file).get('strahd')).toBe('veil');
  });

  it('ignores unknown themes in the file and warns about a broken file', async () => {
    const file = path.join(dir, 'dashboard-themes.json');
    await fsp.writeFile(file, JSON.stringify({ worlds: { a: 'veil', b: 'disco' } }));
    const store = new ThemeStore(file);
    expect(store.get('a')).toBe('veil');
    expect(store.get('b')).toBe('neutral');

    await fsp.writeFile(file, '{ not json');
    const warnings: string[] = [];
    const broken = new ThemeStore(file, {
      warn: (message: string): void => {
        warnings.push(message);
      },
    });
    expect(broken.get('a')).toBe('neutral');
    expect(warnings).toHaveLength(1);
  });
});
