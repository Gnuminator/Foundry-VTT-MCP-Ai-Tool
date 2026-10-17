import { mkdtempSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

import {
  VERSIONS_REFRESH_MS,
  VersionTracker,
  type VersionTrackerOptions,
  buildRows,
  compareVersions,
  defaultKitLastRunFile,
  parseFoundryReleases,
  parseInstalled,
  readKitResult,
} from './versions.js';

const MODULES = {
  foundryVersion: '14.368',
  system: { id: 'dnd5e', version: '6.0.5' },
  modules: [
    {
      id: 'a-mod',
      title: 'A Mod',
      version: '1.0.0',
      active: true,
      manifest: 'https://x.test/a.json',
    },
    { id: 'b-mod', title: 'B Mod', version: '2.0.0', active: false, manifest: null },
    { id: '', version: '1' },
  ],
};

type FetchImpl = NonNullable<VersionTrackerOptions['fetchImpl']>;

function fakeFetch(map: Record<string, string | number>): { impl: FetchImpl; calls: string[] } {
  const calls: string[] = [];
  const noHeader = (): null => null;
  const impl: FetchImpl = url => {
    calls.push(url);
    const v = map[url];
    const ok = typeof v === 'string';
    return Promise.resolve({
      ok,
      status: ok ? 200 : typeof v === 'number' ? v : 404,
      headers: { get: noHeader },
      text: () => Promise.resolve(ok ? v : ''),
    });
  };
  return { impl, calls };
}

const RELEASES =
  `<ul><li class="article release stable"><a href="/releases/14.368">x</a><span class="release-tag stable">` +
  `</span></li><li class="article release testing"><a href="/releases/15.001">y</a><span class="release-tag testing"></span></li></ul>`;

describe('compareVersions', () => {
  it('compares numerically per segment and ignores suffixes', () => {
    expect(compareVersions('6.0.5', '6.0.6')).toBe(-1);
    expect(compareVersions('10.0', '9.9.9')).toBe(1);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.0-beta', '1.2.0')).toBe(0);
  });
});

describe('parseFoundryReleases', () => {
  it('takes the newest stable release, not a testing one', () => {
    expect(parseFoundryReleases(RELEASES)).toBe('14.368');
    expect(parseFoundryReleases('nothing')).toBeNull();
  });
});

describe('parseInstalled', () => {
  it('lists Foundry, the system and valid modules', () => {
    const list = parseInstalled(MODULES)!;
    expect(list.map(p => p.id)).toEqual(['foundry', 'dnd5e', 'a-mod', 'b-mod']);
    expect(list[2].manifest).toBe('https://x.test/a.json');
  });
  it('returns null for something that is not an answer', () => {
    expect(parseInstalled(null)).toBeNull();
    expect(parseInstalled({})).toBeNull();
  });
});

describe('buildRows', () => {
  it('marks behind, ok and unknown and sorts core, system, active modules', () => {
    const rows = buildRows(parseInstalled(MODULES)!, {
      foundry: '14.368',
      byId: { dnd5e: '6.0.6', 'a-mod': '1.0.0' },
      errors: 1,
    });
    expect(rows.map(r => [r.id, r.status])).toEqual([
      ['foundry', 'ok'],
      ['dnd5e', 'behind'],
      ['a-mod', 'ok'],
      ['b-mod', 'unknown'],
    ]);
  });
  it('is all unknown before any online check', () => {
    expect(buildRows(parseInstalled(MODULES)!, null).every(r => r.status === 'unknown')).toBe(true);
  });
});

describe('readKitResult', () => {
  it('reads lastRun and survives a missing or odd file', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'kit-'));
    const file = path.join(dir, 'last-run.json');
    expect(readKitResult(file)).toBeNull();
    expect(readKitResult(null)).toBeNull();
    writeFileSync(
      file,
      '{"lastRun":{"state":"passed","finishedAt":"2026-10-18T03:00:00Z","text":"ok"}}'
    );
    expect(readKitResult(file)).toEqual({
      state: 'passed',
      at: '2026-10-18T03:00:00Z',
      text: 'ok',
    });
    writeFileSync(file, 'not json');
    expect(readKitResult(file)).toBeNull();
  });
});

describe('defaultKitLastRunFile', () => {
  it('prefers the explicit env, then the kit home', () => {
    expect(defaultKitLastRunFile({ FOUNDRY_AI_KIT_LAST_RUN: '/a.json' })).toBe('/a.json');
    expect(defaultKitLastRunFile({ TEST_KIT_HOME: '/kit' })).toBe(
      path.join('/kit', 'last-run.json')
    );
  });
});

describe('VersionTracker', () => {
  const online = {
    'https://foundryvtt.com/releases/': RELEASES,
    'https://api.github.com/repos/foundryvtt/dnd5e/releases/latest': '{"tag_name":"release-6.0.6"}',
    'https://x.test/a.json': '{"version":"1.1.0"}',
  };

  it('answers enabled:false and does no lookups while switched off', async () => {
    const f = fakeFetch(online);
    const t = new VersionTracker({
      enabled: (): boolean => false,
      getModules: (): Promise<unknown> => Promise.resolve(MODULES),
      fetchImpl: f.impl,
    });
    expect(await t.view()).toEqual({ enabled: false });
    expect(f.calls).toEqual([]);
  });

  it('looks the newest versions up once, then serves the cache until six hours pass', async () => {
    const f = fakeFetch(online);
    let clock = 1_000_000;
    const t = new VersionTracker({
      enabled: (): boolean => true,
      getModules: (): Promise<unknown> => Promise.resolve(MODULES),
      fetchImpl: f.impl,
      now: (): number => clock,
    });
    const first = await t.view();
    expect(first.enabled && first.rows!.find(r => r.id === 'a-mod')!.status).toBe('behind');
    expect(first.enabled && first.rows!.find(r => r.id === 'dnd5e')!.newest).toBe('6.0.6');
    const n = f.calls.length;
    await t.view();
    expect(f.calls.length).toBe(n);
    clock += VERSIONS_REFRESH_MS;
    await t.view();
    expect(f.calls.length).toBe(n * 2);
    await t.view(true);
    expect(f.calls.length).toBe(n * 3);
  });

  it('counts failed lookups and keeps the rest', async () => {
    const f = fakeFetch({ ...online, 'https://x.test/a.json': 500 });
    const t = new VersionTracker({
      enabled: (): boolean => true,
      getModules: (): Promise<unknown> => Promise.resolve(MODULES),
      fetchImpl: f.impl,
    });
    const v = await t.view();
    expect(v.enabled && v.lookupErrors).toBe(1);
    expect(v.enabled && v.rows!.find(r => r.id === 'a-mod')!.status).toBe('unknown');
  });

  it('gives rows:null when the bridge does not answer', async () => {
    const f = fakeFetch(online);
    const t = new VersionTracker({
      enabled: (): boolean => true,
      getModules: (): Promise<unknown> => Promise.reject(new Error('down')),
      fetchImpl: f.impl,
    });
    const v = await t.view();
    expect(v.enabled && v.rows).toBeNull();
    expect(f.calls).toEqual([]);
  });
});
