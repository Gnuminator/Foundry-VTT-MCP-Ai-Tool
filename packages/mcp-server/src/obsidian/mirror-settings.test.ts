import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_STORY_ITEM_TYPES } from '@gnuminator/shared';

import { VaultStore } from '../vault/store.js';

import { MIRROR_KINDS } from './mirror-common.js';
import {
  DEFAULT_MIRROR_SETTINGS,
  DEFAULT_OPEN_BASE,
  DEFAULT_POLL_MS,
  MIN_POLL_MS,
  MIRROR_FEATURE,
  MIRROR_SETTINGS_FILE,
  hashMirrorSettings,
  mirrorEnvSettings,
  normalizeMirrorSettings,
  readMirrorSettings,
} from './mirror-settings.js';

const ID_A = 'aaaaaaaaaaaaaaaa';
const ID_B = 'BBBBBBBBBBBBBBBB';
const ID_C = 'cccccccccccccccc';

describe('constants', () => {
  it('names the vault file and the guarded-write feature', () => {
    expect(MIRROR_SETTINGS_FILE).toBe('obsidian-mirror.json');
    expect(MIRROR_FEATURE).toBe('obsidian-mirror');
  });

  it('defaults: off, all five kinds, no page text, nothing excluded, default story item types', () => {
    expect(DEFAULT_MIRROR_SETTINGS).toEqual({
      schema: 1,
      enabled: false,
      kinds: ['pc', 'npc', 'scene', 'journal', 'item'],
      text: { folderIds: [], journalIds: [] },
      excludeFolderIds: [],
      storyItemTypes: [...DEFAULT_STORY_ITEM_TYPES],
      libraryPacks: [],
    });
    expect(Object.isFrozen(DEFAULT_MIRROR_SETTINGS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_MIRROR_SETTINGS.kinds)).toBe(true);
  });
});

describe('normalizeMirrorSettings', () => {
  it('turns nothing, junk and empty objects into the defaults', () => {
    for (const raw of [undefined, null, {}, 'x', 7, true, [], [1, 2], (): number => 1]) {
      expect(normalizeMirrorSettings(raw)).toEqual(DEFAULT_MIRROR_SETTINGS);
    }
  });

  it('returns fresh mutable copies, never the frozen defaults', () => {
    const settings = normalizeMirrorSettings({});
    expect(settings).not.toBe(DEFAULT_MIRROR_SETTINGS);
    expect(Object.isFrozen(settings.kinds)).toBe(false);
    settings.kinds.push('pc');
    expect(DEFAULT_MIRROR_SETTINGS.kinds).toHaveLength(5);
  });

  it('is enabled only for the boolean true', () => {
    expect(normalizeMirrorSettings({ enabled: true }).enabled).toBe(true);
    for (const value of ['true', 'yes', 1, {}, [], null, undefined, false, 'TRUE']) {
      expect(normalizeMirrorSettings({ enabled: value }).enabled).toBe(false);
    }
  });

  it('always writes schema 1, whatever the input says', () => {
    expect(normalizeMirrorSettings({ schema: 2 }).schema).toBe(1);
    expect(normalizeMirrorSettings({ schema: 'x' }).schema).toBe(1);
  });

  describe('kinds', () => {
    it('keeps a subset in the fixed order, deduplicated', () => {
      expect(normalizeMirrorSettings({ kinds: ['item', 'pc', 'item', 'scene'] }).kinds).toEqual([
        'pc',
        'scene',
        'item',
      ]);
    });

    it('drops unknown kinds and non-strings', () => {
      expect(normalizeMirrorSettings({ kinds: ['pc', 'monster', 5, null, 'NPC'] }).kinds).toEqual([
        'pc',
      ]);
    });

    it('takes an empty list as written (mirror nothing) but a non-list as the default', () => {
      expect(normalizeMirrorSettings({ kinds: [] }).kinds).toEqual([]);
      expect(normalizeMirrorSettings({ kinds: ['x'] }).kinds).toEqual([]);
      for (const value of ['pc', 5, {}, null, undefined]) {
        expect(normalizeMirrorSettings({ kinds: value }).kinds).toEqual([...MIRROR_KINDS]);
      }
    });
  });

  describe('folder and journal ids', () => {
    it('keeps valid ids, deduplicated and sorted', () => {
      const settings = normalizeMirrorSettings({
        text: { folderIds: [ID_C, ID_A, ID_C, ID_B], journalIds: [ID_B, ID_A] },
        excludeFolderIds: [ID_B, ID_B, ID_A],
      });
      expect(settings.text.folderIds).toEqual([ID_B, ID_A, ID_C].sort());
      expect(settings.text.journalIds).toEqual([ID_B, ID_A].sort());
      expect(settings.excludeFolderIds).toEqual([ID_B, ID_A].sort());
    });

    it('drops anything that is not a 16-character alphanumeric id', () => {
      const bad = [
        'short',
        'aaaaaaaaaaaaaaaaa', // 17
        'aaaaaaaaaaaaaaa', // 15
        'aaaaaaaaaaaaaaa-',
        'aaaaaaaa aaaaaaa',
        '../../aaaaaaaaaa',
        ' aaaaaaaaaaaaaaa',
        'aaaaaaaaaaaaaaaa\n',
        '',
        5,
        null,
        {},
        ['aaaaaaaaaaaaaaaa'],
      ];
      const settings = normalizeMirrorSettings({
        text: { folderIds: [...bad, ID_A], journalIds: bad },
        excludeFolderIds: [...bad, ID_A],
      });
      expect(settings.text.folderIds).toEqual([ID_A]);
      expect(settings.text.journalIds).toEqual([]);
      expect(settings.excludeFolderIds).toEqual([ID_A]);
    });

    it('takes a non-list, or a non-object text, as empty', () => {
      expect(normalizeMirrorSettings({ text: 'x' }).text).toEqual({
        folderIds: [],
        journalIds: [],
      });
      expect(normalizeMirrorSettings({ text: [ID_A] }).text).toEqual({
        folderIds: [],
        journalIds: [],
      });
      expect(
        normalizeMirrorSettings({ text: { folderIds: ID_A, journalIds: { a: 1 } } }).text
      ).toEqual({ folderIds: [], journalIds: [] });
      expect(normalizeMirrorSettings({ excludeFolderIds: ID_A }).excludeFolderIds).toEqual([]);
    });

    it('caps each list at 200 ids', () => {
      const many = Array.from({ length: 300 }, (_, i) => `id${String(i).padStart(14, '0')}`);
      const settings = normalizeMirrorSettings({
        text: { folderIds: many, journalIds: many },
        excludeFolderIds: many,
      });
      expect(settings.text.folderIds).toHaveLength(200);
      expect(settings.text.journalIds).toHaveLength(200);
      expect(settings.excludeFolderIds).toHaveLength(200);
      expect(settings.excludeFolderIds).toEqual([...many].sort().slice(0, 200));
    });
  });

  describe('story item types', () => {
    it('keeps valid keys, deduplicated, in the order given', () => {
      expect(
        normalizeMirrorSettings({ storyItemTypes: ['loot', 'weapon', 'loot', 'my-type', 'a1B'] })
          .storyItemTypes
      ).toEqual(['loot', 'weapon', 'my-type', 'a1B']);
    });

    it('drops invalid keys', () => {
      const bad = [
        '',
        'Weapon',
        '1weapon',
        'we apon',
        'we_apon',
        '-x',
        'a'.repeat(42),
        5,
        null,
        {},
      ];
      expect(normalizeMirrorSettings({ storyItemTypes: [...bad, 'tool'] }).storyItemTypes).toEqual([
        'tool',
      ]);
    });

    it('accepts a key of 41 characters and no more', () => {
      const ok = `a${'b'.repeat(40)}`;
      expect(normalizeMirrorSettings({ storyItemTypes: [ok] }).storyItemTypes).toEqual([ok]);
      expect(normalizeMirrorSettings({ storyItemTypes: [`${ok}c`] }).storyItemTypes).toEqual([]);
    });

    it('caps the list at 30 and takes a non-list as the default', () => {
      const many = Array.from({ length: 45 }, (_, i) => `type${i}`);
      expect(normalizeMirrorSettings({ storyItemTypes: many }).storyItemTypes).toEqual(
        many.slice(0, 30)
      );
      for (const value of ['loot', 5, {}, null, undefined]) {
        expect(normalizeMirrorSettings({ storyItemTypes: value }).storyItemTypes).toEqual([
          ...DEFAULT_STORY_ITEM_TYPES,
        ]);
      }
    });

    it('takes an empty list as written', () => {
      expect(normalizeMirrorSettings({ storyItemTypes: [] }).storyItemTypes).toEqual([]);
    });
  });

  it('is idempotent and ignores unknown keys', () => {
    const once = normalizeMirrorSettings({
      enabled: true,
      kinds: ['npc', 'item'],
      text: { folderIds: [ID_C, ID_A], journalIds: [ID_B], extra: 1 },
      excludeFolderIds: [ID_A],
      storyItemTypes: ['loot'],
      secret: 'x',
    });
    expect(Object.keys(once)).toEqual([
      'schema',
      'enabled',
      'kinds',
      'text',
      'excludeFolderIds',
      'storyItemTypes',
      'libraryPacks',
    ]);
    expect(Object.keys(once.text)).toEqual(['folderIds', 'journalIds']);
    expect(normalizeMirrorSettings(once)).toEqual(once);
  });

  it('never throws on hostile input', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    cyclic.text = cyclic;
    const hostile = [
      cyclic,
      {
        get enabled(): never {
          throw new Error('boom');
        },
      },
      new Proxy(
        {},
        {
          get(): never {
            throw new Error('boom');
          },
        }
      ),
      Object.create(null),
      { kinds: { length: 5 }, text: { folderIds: { length: 5 } } },
      { __proto__: { enabled: true } },
      { kinds: [Symbol('x')] },
      new Date(),
      new Map(),
      Number.NaN,
    ];
    for (const raw of hostile) {
      expect(() => normalizeMirrorSettings(raw)).not.toThrow();
    }
  });
});

describe('hashMirrorSettings', () => {
  it('is 16 hex characters and stable', () => {
    const hash = hashMirrorSettings(DEFAULT_MIRROR_SETTINGS);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(hashMirrorSettings(normalizeMirrorSettings({}))).toBe(hash);
    expect(hashMirrorSettings(normalizeMirrorSettings(undefined))).toBe(hash);
  });

  it('does not depend on key order or on unnormalized input order', () => {
    const a = normalizeMirrorSettings({ enabled: true, excludeFolderIds: [ID_A, ID_C] });
    const b = normalizeMirrorSettings({ excludeFolderIds: [ID_C, ID_A], enabled: true });
    expect(hashMirrorSettings(a)).toBe(hashMirrorSettings(b));
  });

  it('changes with every field', () => {
    const base = hashMirrorSettings(DEFAULT_MIRROR_SETTINGS);
    const variants = [
      { enabled: true },
      { kinds: ['pc'] },
      { text: { folderIds: [ID_A] } },
      { text: { journalIds: [ID_A] } },
      { excludeFolderIds: [ID_A] },
      { storyItemTypes: ['loot'] },
    ];
    const hashes = variants.map(v => hashMirrorSettings(normalizeMirrorSettings(v)));
    expect(new Set([base, ...hashes]).size).toBe(variants.length + 1);
  });

  it('separates the same id in different lists', () => {
    const folder = normalizeMirrorSettings({ text: { folderIds: [ID_A] } });
    const journal = normalizeMirrorSettings({ text: { journalIds: [ID_A] } });
    const excluded = normalizeMirrorSettings({ excludeFolderIds: [ID_A] });
    expect(new Set([folder, journal, excluded].map(hashMirrorSettings)).size).toBe(3);
  });
});

describe('readMirrorSettings', () => {
  let dataDir: string;
  let store: VaultStore;

  beforeEach(async () => {
    dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mirror-settings-'));
    store = new VaultStore({ dataDir });
  });

  afterEach(async () => {
    await fsp.rm(dataDir, { recursive: true, force: true });
  });

  it('gives the defaults and their hash when the file does not exist', async () => {
    const result = await readMirrorSettings(store, 'strahd');
    expect(result.settings).toEqual(DEFAULT_MIRROR_SETTINGS);
    expect(result.hash).toBe(hashMirrorSettings(DEFAULT_MIRROR_SETTINGS));
  });

  it('reads gm/obsidian-mirror.json key settings, normalized', async () => {
    await store.write('strahd', 'gm', MIRROR_SETTINGS_FILE, {
      settings: {
        enabled: true,
        kinds: ['scene', 'pc', 'bogus'],
        text: { folderIds: [ID_C, 'not-an-id', ID_A], journalIds: [] },
        excludeFolderIds: [ID_B],
        storyItemTypes: ['loot', 'Bad Type'],
      },
    });
    const result = await readMirrorSettings(store, 'strahd');
    expect(result.settings).toEqual({
      schema: 1,
      enabled: true,
      kinds: ['pc', 'scene'],
      text: { folderIds: [ID_A, ID_C], journalIds: [] },
      excludeFolderIds: [ID_B],
      storyItemTypes: ['loot'],
      libraryPacks: [],
    });
    expect(result.hash).toBe(hashMirrorSettings(result.settings));
  });

  it('is per world', async () => {
    await store.write('strahd', 'gm', MIRROR_SETTINGS_FILE, { settings: { enabled: true } });
    expect((await readMirrorSettings(store, 'strahd')).settings.enabled).toBe(true);
    expect((await readMirrorSettings(store, 'other')).settings.enabled).toBe(false);
  });

  it('takes a file without settings, or with junk data, as the defaults', async () => {
    await store.write('strahd', 'gm', MIRROR_SETTINGS_FILE, {});
    expect((await readMirrorSettings(store, 'strahd')).settings).toEqual(DEFAULT_MIRROR_SETTINGS);
    await store.write('strahd', 'gm', MIRROR_SETTINGS_FILE, ['enabled']);
    expect((await readMirrorSettings(store, 'strahd')).settings).toEqual(DEFAULT_MIRROR_SETTINGS);
    await store.write('strahd', 'gm', MIRROR_SETTINGS_FILE, null);
    expect((await readMirrorSettings(store, 'strahd')).settings).toEqual(DEFAULT_MIRROR_SETTINGS);
  });

  it('changes the hash when the stored settings change', async () => {
    const before = await readMirrorSettings(store, 'strahd');
    await store.write('strahd', 'gm', MIRROR_SETTINGS_FILE, { settings: { enabled: true } });
    const after = await readMirrorSettings(store, 'strahd');
    expect(after.hash).not.toBe(before.hash);
  });

  it('throws on a file that is not valid JSON (the vault never overwrites it)', async () => {
    const file = store.filePath('strahd', 'gm', MIRROR_SETTINGS_FILE);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, '{ not json', 'utf8');
    await expect(readMirrorSettings(store, 'strahd')).rejects.toThrow();
  });
});

describe('mirrorEnvSettings', () => {
  it('defaults: 10 seconds and http://localhost:3000, no warnings', () => {
    expect(mirrorEnvSettings({})).toEqual({
      pollMs: 10_000,
      openBase: 'http://localhost:3000',
      foundryUrl: null,
      warnings: [],
    });
    expect(DEFAULT_POLL_MS).toBe(10_000);
    expect(DEFAULT_OPEN_BASE).toBe('http://localhost:3000');
    expect(MIN_POLL_MS).toBe(5_000);
  });

  it('treats empty and whitespace values as unset', () => {
    expect(
      mirrorEnvSettings({ FOUNDRY_AI_MIRROR_POLL_MS: '  ', FOUNDRY_AI_OPEN_BASE: '' })
    ).toEqual({
      pollMs: 10_000,
      openBase: 'http://localhost:3000',
      foundryUrl: null,
      warnings: [],
    });
  });

  it('reads process.env when no environment is passed', () => {
    const previous = { ...process.env };
    try {
      process.env.FOUNDRY_AI_MIRROR_POLL_MS = '7000';
      process.env.FOUNDRY_AI_OPEN_BASE = 'https://gm.example.net';
      expect(mirrorEnvSettings()).toEqual({
        pollMs: 7000,
        openBase: 'https://gm.example.net',
        foundryUrl: null,
        warnings: [],
      });
    } finally {
      for (const key of ['FOUNDRY_AI_MIRROR_POLL_MS', 'FOUNDRY_AI_OPEN_BASE']) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  });

  describe('FOUNDRY_AI_MIRROR_POLL_MS', () => {
    const poll = (value: string): ReturnType<typeof mirrorEnvSettings> =>
      mirrorEnvSettings({ FOUNDRY_AI_MIRROR_POLL_MS: value });

    it('accepts whole numbers from the minimum up', () => {
      expect(poll('5000')).toMatchObject({ pollMs: 5000, warnings: [] });
      expect(poll('12000')).toMatchObject({ pollMs: 12000, warnings: [] });
      expect(poll(' 30000 ')).toMatchObject({ pollMs: 30000, warnings: [] });
    });

    it('raises a value below the minimum to 5000 and says so', () => {
      for (const value of ['0', '1', '4999', '100']) {
        const result = poll(value);
        expect(result.pollMs).toBe(5000);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0]).toContain('FOUNDRY_AI_MIRROR_POLL_MS');
      }
    });

    it('uses the default for anything that is not a whole number and says so', () => {
      for (const value of [
        'abc',
        '10.5',
        '-5000',
        '1e4',
        '0x2710',
        '10s',
        '5,000',
        '99999999999',
      ]) {
        const result = poll(value);
        expect(result.pollMs).toBe(10_000);
        expect(result.warnings).toHaveLength(1);
      }
    });
  });

  describe('FOUNDRY_AI_OPEN_BASE', () => {
    const open = (value: string): ReturnType<typeof mirrorEnvSettings> =>
      mirrorEnvSettings({ FOUNDRY_AI_OPEN_BASE: value });

    it('accepts http and https origins and returns them without a trailing slash', () => {
      const accepted: Array<[string, string]> = [
        ['http://localhost:3000', 'http://localhost:3000'],
        ['http://localhost:3100/', 'http://localhost:3100'],
        ['http://127.0.0.1:3000', 'http://127.0.0.1:3000'],
        ['https://gm.example.net', 'https://gm.example.net'],
        ['https://gm.example.net/', 'https://gm.example.net'],
        ['HTTPS://GM.Example.NET', 'https://gm.example.net'],
        ['http://[::1]:3000', 'http://[::1]:3000'],
        ['  http://localhost:3000  ', 'http://localhost:3000'],
        ['https://gm.example.net:443', 'https://gm.example.net'],
      ];
      for (const [value, origin] of accepted) {
        expect(open(value)).toEqual({
          pollMs: 10_000,
          openBase: origin,
          foundryUrl: null,
          warnings: [],
        });
      }
    });

    it('accepts any host the GM sets, 127.0.0.1 included', () => {
      expect(open('http://127.0.0.1:3100').openBase).toBe('http://127.0.0.1:3100');
      expect(open('https://abc-def.trycloudflare.com').openBase).toBe(
        'https://abc-def.trycloudflare.com'
      );
    });

    it('rejects credentials, paths, queries, fragments and other schemes, with a default and a warning', () => {
      const rejected = [
        'http://user:pw@host',
        'http://user@host',
        'https://:secret@host.example',
        'http://host/path',
        'http://host/path/',
        'http://host/open',
        'http://host?x=1',
        'http://host/?x=1',
        'http://host?',
        'http://host#frag',
        'http://host/#',
        'ftp://x',
        'javascript:x',
        'javascript:alert(1)',
        'file:///C:/vault',
        'data:text/html,hi',
        'localhost:3000',
        '//host',
        'host',
        'not a url',
        'http://',
        'http://host\\path',
      ];
      for (const value of rejected) {
        const result = open(value);
        expect(result.openBase, value).toBe('http://localhost:3000');
        expect(result.warnings, value).toHaveLength(1);
        expect(result.warnings[0]).toContain('FOUNDRY_AI_OPEN_BASE');
      }
    });

    it('never echoes the value, so credentials cannot reach the log', () => {
      for (const value of [
        'http://user:hunter2@host',
        'https://admin:s3cret@gm.example.net/path',
        'http://host/path?token=abc123',
      ]) {
        const text = open(value).warnings.join('\n');
        expect(text).not.toMatch(/hunter2|s3cret|admin|abc123|token|user:/);
      }
    });
  });

  it('reports both variables at once', () => {
    const result = mirrorEnvSettings({
      FOUNDRY_AI_MIRROR_POLL_MS: '10',
      FOUNDRY_AI_OPEN_BASE: 'http://u:p@h',
    });
    expect(result.pollMs).toBe(5000);
    expect(result.openBase).toBe('http://localhost:3000');
    expect(result.warnings).toHaveLength(2);
  });
});

describe('Library packs and FOUNDRY_AI_FOUNDRY_URL', () => {
  it('keeps valid pack ids, deduplicated and sorted, and drops the rest', () => {
    const settings = normalizeMirrorSettings({
      libraryPacks: [
        'world.monsters',
        'dnd5e.spells',
        'world.monsters',
        'no-dot',
        '../x.y',
        7,
        'a.b c',
      ],
    });
    expect(settings.libraryPacks).toEqual(['dnd5e.spells', 'world.monsters']);
    expect(normalizeMirrorSettings({ libraryPacks: 'world.monsters' }).libraryPacks).toEqual([]);
  });

  it('changes the hash when the packs change', () => {
    const a = normalizeMirrorSettings({ libraryPacks: ['world.monsters'] });
    const b = normalizeMirrorSettings({ libraryPacks: ['world.items'] });
    expect(hashMirrorSettings(a)).not.toBe(hashMirrorSettings(b));
  });

  it('reads FOUNDRY_AI_FOUNDRY_URL as a base URL (route prefix allowed) and warns about anything else', () => {
    expect(
      mirrorEnvSettings({ FOUNDRY_AI_FOUNDRY_URL: 'http://localhost:30000/' }).foundryUrl
    ).toBe('http://localhost:30000');
    expect(
      mirrorEnvSettings({ FOUNDRY_AI_FOUNDRY_URL: 'https://host.example/foundry/' }).foundryUrl
    ).toBe('https://host.example/foundry');
    for (const value of [
      'https://host.example/foundry?x=1',
      'https://host.example/#a',
      'ftp://h',
    ]) {
      expect(mirrorEnvSettings({ FOUNDRY_AI_FOUNDRY_URL: value }).foundryUrl, value).toBeNull();
    }
    const bad = mirrorEnvSettings({ FOUNDRY_AI_FOUNDRY_URL: 'http://user:pw@host/path' });
    expect(bad.foundryUrl).toBeNull();
    expect(bad.warnings.join(' ')).toContain('FOUNDRY_AI_FOUNDRY_URL');
    expect(bad.warnings.join(' ')).not.toContain('pw@');
  });
});
