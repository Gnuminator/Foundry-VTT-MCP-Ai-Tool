/**
 * Unit tests for the pre-flight scan (I-067, I-076): secret-looking world
 * settings (masked, never echoed), names players can see, module conflicts.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  collectPlayerVisibleNames,
  getPreflightScan,
  maskSecret,
  scanModules,
  scanSettings,
} from './preflight-scan.js';
import {
  createTestWorld,
  makeDocument,
  makeToken,
  MockCollection,
  type TestWorld,
} from './test-support/foundry-mock/index.js';

const WEBHOOK =
  'https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-canary';

let world: TestWorld;
let restore: () => void;

beforeEach(() => {
  world = createTestWorld();
  restore = world.install();
  world.addUser({ id: 'gm', name: 'Gamemaster', isGM: true });
  world.addUser({ id: 'p1', name: 'Player', isGM: false });
});

afterEach(() => {
  restore();
});

/** Stand in for `game.settings.storage.get("world")` (the mock has no storage). */
function setWorldSettings(docs: Array<Record<string, unknown>>): void {
  const settings = (globalThis as unknown as { game: { settings: Record<string, unknown> } }).game
    .settings;
  settings.storage = {
    get: (scope: string): unknown => (scope === 'world' ? new MockCollection(docs) : null),
  };
}

describe('maskSecret', () => {
  it('keeps at most four characters and the length', () => {
    expect(maskSecret(WEBHOOK)).toBe(`http… (${WEBHOOK.length} characters)`);
    expect(maskSecret('short-secret')).toBe('… (12 characters)');
  });
});

describe('scanSettings', () => {
  it('finds a Discord webhook inside a JSON value and never returns it in full (canary)', () => {
    const findings = scanSettings([
      { key: 'some-module.config', value: JSON.stringify({ nested: { url: WEBHOOK } }) },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      setting: 'some-module.config',
      namespace: 'some-module',
      rule: 'discord-webhook',
      severity: 'fail',
    });
    const printed = JSON.stringify(findings);
    expect(printed).not.toContain('canary');
    expect(printed).not.toContain('123456789012345678');
  });

  it('flags known secret settings by name, whatever the value looks like', () => {
    const findings = scanSettings([
      { key: 'ddb-importer.cobalt-cookie', value: JSON.stringify('abc123def456ghi789') },
      { key: 'foundrytodiscord.webHookURL', value: JSON.stringify(WEBHOOK) },
      { key: 'ddb-importer.cobalt-cookie-local', value: 'true' },
    ]);
    expect(findings.map(f => f.rule)).toEqual([
      'known:ddb-importer.cobalt-cookie',
      'known:foundrytodiscord.webHookURL',
    ]);
    expect(JSON.stringify(findings)).not.toContain('abc123def456ghi789');
  });

  it('skips empty known settings and ordinary values', () => {
    expect(
      scanSettings([
        { key: 'ddb-importer.cobalt-cookie', value: '""' },
        { key: 'core.rollMode', value: '"publicroll"' },
        { key: 'dnd5e.rulesVersion', value: '"modern"' },
      ])
    ).toEqual([]);
  });

  it('warns on a secret-sounding key with a long value, not on a short one', () => {
    const findings = scanSettings([
      { key: 'x.apiToken', value: '"q8w7e6r5t4y3u2i1"' },
      { key: 'x.showToken', value: '"yes"' },
      { key: 'x.tokenLabel', value: '"a long sentence with spaces in it"' },
    ]);
    expect(findings).toEqual([
      expect.objectContaining({ setting: 'x.apiToken', rule: 'key-name' }),
    ]);
  });
});

describe('scanModules', () => {
  it('warns about active conflicting modules and a missing recommended one', () => {
    const findings = scanModules([
      { id: 'midi-qol', title: 'Midi QOL', active: true },
      { id: 'foundrytodiscord', title: 'Foundry to Discord', active: false },
    ]);
    expect(findings.map(f => f.rule)).toEqual(['midi-qol', 'automated-conditions-5e']);
    // A module that is not installed is named by its usual title, not its id.
    expect(findings[1]?.title).toBe('Automated Conditions 5e');
  });

  it('is quiet with Automated Conditions 5e active and no conflicts', () => {
    expect(
      scanModules([
        { id: 'automated-conditions-5e', title: 'Automated Conditions 5e', active: true },
      ])
    ).toEqual([]);
  });
});

describe('collectPlayerVisibleNames', () => {
  it('lists scene navigation names the way Foundry shows them (real name without navName)', () => {
    world.addScene({
      id: 'nav',
      name: 'Castle Ravenloft',
      navName: 'The Castle',
      ownership: { default: 1 },
    });
    world.addScene({ id: 'raw', name: 'Tser Pool', ownership: { default: 1 } });
    world.addScene({ id: 'gm', name: 'Amber Temple', ownership: { default: 0 } });
    world.addScene({ id: 'hidden', name: 'Hidden', navigation: false, ownership: { default: 1 } });
    const scenes = collectPlayerVisibleNames().filter(n => n.kind === 'scene');
    expect(scenes.map(s => s.name)).toEqual(['The Castle', 'Tser Pool']);
  });

  it('lists the active scene even without navigation or permission', () => {
    world.addScene({
      id: 's',
      name: 'Barovia',
      active: true,
      navigation: false,
      ownership: { default: 0 },
    });
    expect(collectPlayerVisibleNames()).toContainEqual({ kind: 'scene', id: 's', name: 'Barovia' });
  });

  it('lists playing playlists and sounds, and everything in a player-owned playlist', () => {
    const playing = makeDocument({
      id: 'pl1',
      name: 'Combat',
      playing: true,
      ownership: { default: 0 },
      sounds: new MockCollection([
        makeDocument({ id: 's1', name: 'Strahd Theme', playing: true, ownership: { default: 0 } }),
        makeDocument({ id: 's2', name: 'Silent Track', playing: false, ownership: { default: 0 } }),
      ]),
    });
    const quiet = makeDocument({
      id: 'pl2',
      name: 'GM Secrets',
      playing: false,
      ownership: { default: 0 },
      sounds: new MockCollection([
        makeDocument({ id: 's3', name: 'Vistani', ownership: { default: 0 } }),
      ]),
    });
    world.playlists.add(playing).add(quiet);
    const names = collectPlayerVisibleNames().map(n => `${n.kind}:${n.name}`);
    expect(names).toContain('playlist:Combat');
    expect(names).toContain('sound:Strahd Theme');
    expect(names).not.toContain('sound:Silent Track');
    expect(names).not.toContain('playlist:GM Secrets');
    expect(names).not.toContain('sound:Vistani');
  });

  it('lists observable journals with their limited pages, and actors players can see', () => {
    world.addJournal({
      id: 'j1',
      name: 'Handouts',
      ownership: { default: 2 },
      pages: [{ id: 'pg1', name: 'Letter from Kolyan', ownership: { default: -1 } }],
    });
    world.addJournal({ id: 'j2', name: 'Chapter 4 secrets', ownership: { default: 1 } });
    world.addActor({ id: 'a1', name: 'Ireena', ownership: { default: 1 } });
    world.addActor({ id: 'a2', name: 'Strahd', ownership: { default: 0 } });
    const names = collectPlayerVisibleNames().map(n => `${n.kind}:${n.name}`);
    expect(names).toEqual(
      expect.arrayContaining(['journal:Handouts', 'page:Letter from Kolyan', 'actor:Ireena'])
    );
    expect(names).not.toContain('journal:Chapter 4 secrets');
    expect(names).not.toContain('actor:Strahd');
  });

  it('lists token names players can read on the active scene only', () => {
    world.addScene({
      id: 'arena',
      name: 'Arena',
      active: true,
      ownership: { default: 0 },
      tokens: [
        makeToken({ id: 't1', name: 'Wolf 1', displayName: 30 }),
        makeToken({ id: 't2', name: 'Vampire Spawn', displayName: 0 }),
        makeToken({ id: 't3', name: 'Hidden Wolf', displayName: 50, hidden: true }),
      ],
    });
    world.setActiveScene('arena');
    const tokens = collectPlayerVisibleNames().filter(n => n.kind === 'token');
    expect(tokens.map(t => t.name)).toEqual(['Wolf 1']);
  });
});

describe('getPreflightScan', () => {
  it('reads world settings from storage, leaves user settings out and counts what it checked', () => {
    setWorldSettings([
      { id: '1', key: 'x.hook', _source: { value: JSON.stringify(WEBHOOK) }, user: null },
      { id: '2', key: 'x.userHook', _source: { value: JSON.stringify(WEBHOOK) }, user: 'p1' },
      { id: '3', key: 'core.rollMode', _source: { value: '"publicroll"' }, user: null },
    ]);
    const scan = getPreflightScan();
    expect(scan.schema).toBe(1);
    expect(scan.settingsChecked).toBe(2);
    expect(scan.settings.map(s => s.setting)).toEqual(['x.hook']);
    expect(JSON.stringify(scan)).not.toContain('canary');
  });

  it('copes without settings storage', () => {
    const scan = getPreflightScan();
    expect(scan.settingsChecked).toBe(0);
    expect(scan.settings).toEqual([]);
  });
});
