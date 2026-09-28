import * as path from 'path';
import { describe, expect, it } from 'vitest';

import {
  assertArea,
  isValidFileName,
  isValidWorldId,
  resolveDataDir,
  vaultFilePath,
} from './paths.js';

describe('resolveDataDir', () => {
  it('prefers FOUNDRY_AI_DATA_DIR', () => {
    const dir = path.resolve('/srv/vault');
    expect(resolveDataDir({ FOUNDRY_AI_DATA_DIR: dir, APPDATA: 'C:\\x' }, 'win32', '/h')).toBe(dir);
  });

  it('uses %APPDATA% on Windows', () => {
    expect(resolveDataDir({ APPDATA: 'C:\\Users\\gm\\AppData\\Roaming' }, 'win32', 'C:\\h')).toBe(
      'C:\\Users\\gm\\AppData\\Roaming\\foundry-ai-tool\\vault'
    );
    expect(resolveDataDir({}, 'win32', 'C:\\Users\\gm')).toBe(
      'C:\\Users\\gm\\AppData\\Roaming\\foundry-ai-tool\\vault'
    );
  });

  it('uses XDG_DATA_HOME, else ~/.local/share, on Linux', () => {
    expect(resolveDataDir({ XDG_DATA_HOME: '/data' }, 'linux', '/home/gm')).toBe(
      '/data/foundry-ai-tool/vault'
    );
    expect(resolveDataDir({}, 'linux', '/home/gm')).toBe(
      '/home/gm/.local/share/foundry-ai-tool/vault'
    );
    // A relative XDG_DATA_HOME is invalid per the spec and ignored.
    expect(resolveDataDir({ XDG_DATA_HOME: 'rel' }, 'linux', '/home/gm')).toBe(
      '/home/gm/.local/share/foundry-ai-tool/vault'
    );
  });
});

describe('name validation', () => {
  it('accepts Foundry world slugs and rejects anything path-like', () => {
    for (const ok of ['curse-of-strahd', 'rime_of_the_frostmaiden', 'World1']) {
      expect(isValidWorldId(ok)).toBe(true);
    }
    for (const bad of [
      '',
      '..',
      '.',
      'a/b',
      'a\\b',
      'c:',
      'a.b',
      '-lead',
      'con',
      'NUL',
      'x'.repeat(101),
      3,
    ]) {
      expect(isValidWorldId(bad)).toBe(false);
    }
  });

  it('accepts .json/.jsonl file names only', () => {
    for (const ok of ['audit.json', '2026-09-28.jsonl', 'npc-secrets.json', 'chg-abc.json']) {
      expect(isValidFileName(ok)).toBe(true);
    }
    for (const bad of [
      '',
      'audit',
      'audit.txt',
      '../audit.json',
      'a/b.json',
      'a\\b.json',
      '.hidden.json',
      '.audit.json.123.tmp',
      'a..json',
      'con.json',
      'lpt1.jsonl',
      `${'x'.repeat(120)}.json`,
    ]) {
      expect(isValidFileName(bad)).toBe(false);
    }
  });

  it('rejects unknown areas', () => {
    expect(assertArea('gm')).toBe('gm');
    expect(() => assertArea('..')).toThrow(/Invalid vault area/);
  });

  it('builds paths inside the area directory', () => {
    const root = path.resolve('/vault');
    expect(vaultFilePath(root, 'w1', 'gm', 'audit.json')).toBe(
      path.join(root, 'w1', 'gm', 'audit.json')
    );
    expect(() => vaultFilePath(root, '../w1', 'gm', 'audit.json')).toThrow(/world id/);
    expect(() => vaultFilePath(root, 'w1', 'gm', '../x.json')).toThrow(/file name/);
    expect(() => vaultFilePath(root, 'w1', 'nope' as never, 'x.json')).toThrow(/area/);
  });
});
