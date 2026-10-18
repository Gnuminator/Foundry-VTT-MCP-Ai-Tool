import { mkdtempSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

import {
  VERSIONS_REFRESH_MS,
  VERSIONS_RETRY_MS,
  isPrivateHost,
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
      minCoreById: {},
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

const settle = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

describe('isPrivateHost and the url guard', () => {
  it('refuses this machine and private networks', () => {
    for (const h of [
      'localhost',
      'localhost.',
      'printer.local.',
      'foundry-pi',
      'foo.localhost',
      'printer.local',
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.5',
      '169.254.1.1',
      '100.64.0.1',
      '[::1]',
      'fd00::1',
      '[::7f00:1]',
      '64:ff9b::7f00:1',
      'nas.lan',
      'router.home.arpa',
      'fritz.box',
      '198.18.0.1',
      '198.19.255.1',
      '224.0.0.1',
      'ff02::1',
    ]) {
      expect(isPrivateHost(h), h).toBe(true);
    }
    for (const h of [
      'example.com',
      '8.8.8.8',
      '172.32.0.1',
      'github.com',
      '198.20.0.1',
      '223.1.1.1',
    ]) {
      expect(isPrivateHost(h), h).toBe(false);
    }
  });

  it('does not fetch a private, http or login url, nor follow a redirect into one', async () => {
    const f = fakeFetch({
      'https://foundryvtt.com/releases/': RELEASES,
      'https://api.github.com/repos/foundryvtt/dnd5e/releases/latest': '{"tag_name":"6.0.6"}',
    });
    const bad = {
      ...MODULES,
      modules: [
        { id: 'p1', title: 'P1', version: '1', active: true, manifest: 'https://127.0.0.1/m.json' },
        { id: 'p2', title: 'P2', version: '1', active: true, manifest: 'http://x.test/m.json' },
        {
          id: 'p3',
          title: 'P3',
          version: '1',
          active: true,
          manifest: 'https://u:p@x.test/m.json',
        },
        {
          id: 'p4',
          title: 'P4',
          version: '1',
          active: true,
          manifest: 'https://x.test/redir.json',
        },
      ],
    };
    const redirecting: typeof f.impl = (url, init) =>
      url.endsWith('/redir.json')
        ? Promise.resolve({
            ok: false,
            status: 302,
            headers: { get: (n: string) => (n === 'location' ? 'https://192.168.0.9/x' : null) },
            text: () => Promise.resolve(''),
          })
        : f.impl(url, init);
    const t = new VersionTracker({
      enabled: (): boolean => true,
      getModules: (): Promise<unknown> => Promise.resolve(bad),
      fetchImpl: redirecting,
    });
    await t.view();
    await settle();
    expect(f.calls.some(u => /127\.0\.0\.1|192\.168|u:p|http:\/\/x\.test/.test(u))).toBe(false);
    const v = await t.view();
    expect(v.enabled && v.lookupErrors).toBe(4);
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
    // Six hours on, the next answer is still the cache; the check runs in the background.
    clock += VERSIONS_REFRESH_MS;
    const stale = await t.view();
    expect(stale.enabled && stale.checking).toBe(true);
    await settle();
    expect(f.calls.length).toBe(n * 2);
    // "Check again" within a minute of the last check is ignored.
    await t.view(true);
    await settle();
    expect(f.calls.length).toBe(n * 2);
    clock += 61_000;
    await t.view(true);
    await settle();
    expect(f.calls.length).toBe(n * 3);
  });

  it('shares one lookup between answers that come while it runs', async () => {
    const f = fakeFetch(online);
    const t = new VersionTracker({
      enabled: (): boolean => true,
      getModules: (): Promise<unknown> => Promise.resolve(MODULES),
      fetchImpl: f.impl,
    });
    await Promise.all([t.view(), t.view(), t.view()]);
    await settle();
    expect(f.calls.filter(u => u === 'https://x.test/a.json')).toHaveLength(1);
  });

  it('tries again after ten minutes when a lookup failed, not after six hours', async () => {
    const f = fakeFetch({ ...online, 'https://x.test/a.json': 500 });
    let clock = 1_000_000;
    const t = new VersionTracker({
      enabled: (): boolean => true,
      getModules: (): Promise<unknown> => Promise.resolve(MODULES),
      fetchImpl: f.impl,
      now: (): number => clock,
    });
    await t.view();
    const n = f.calls.length;
    clock += VERSIONS_RETRY_MS - 1000;
    await t.view();
    await settle();
    expect(f.calls.length).toBe(n);
    clock += 2000;
    await t.view();
    await settle();
    expect(f.calls.length).toBe(n * 2);
  });

  it('backs the retry off 10, 20, 40 minutes and never past six hours', async () => {
    const f = fakeFetch({ ...online, 'https://x.test/a.json': 500 });
    let clock = 1_000_000;
    const t = new VersionTracker({
      enabled: (): boolean => true,
      getModules: (): Promise<unknown> => Promise.resolve(MODULES),
      fetchImpl: f.impl,
      now: (): number => clock,
    });
    await t.view();
    const waits = [VERSIONS_RETRY_MS, 2 * VERSIONS_RETRY_MS, 4 * VERSIONS_RETRY_MS];
    for (const wait of waits) {
      const n = f.calls.length;
      clock += wait - 1000;
      await t.view();
      await settle();
      expect(f.calls.length, `too early for ${wait}`).toBe(n);
      clock += 2000;
      await t.view();
      await settle();
      expect(f.calls.length, `due at ${wait}`).toBeGreaterThan(n);
    }
    // after many failures the wait stops at the six-hour refresh
    for (let i = 0; i < 6; i += 1) {
      clock += VERSIONS_REFRESH_MS;
      await t.view();
      await settle();
    }
    const n = f.calls.length;
    clock += VERSIONS_REFRESH_MS - 1000;
    await t.view();
    await settle();
    expect(f.calls.length).toBe(n);
    clock += 2000;
    await t.view();
    await settle();
    expect(f.calls.length).toBeGreaterThan(n);
  });

  it('notes when the newest release needs a newer Foundry than the installed one', async () => {
    const f = fakeFetch({
      ...online,
      'https://x.test/a.json': '{"version":"1.1.0","compatibility":{"minimum":"15"}}',
    });
    const t = new VersionTracker({
      enabled: (): boolean => true,
      getModules: (): Promise<unknown> => Promise.resolve(MODULES),
      fetchImpl: f.impl,
    });
    await t.view();
    await settle();
    const v = await t.view();
    const row = v.enabled && v.rows?.find(r => r.id === 'a-mod');
    expect(row && row.status).toBe('behind');
    expect(row && row.needsCore).toBe('15');
  });

  it('drops the #fragment from a manifest url', () => {
    const got = parseInstalled({
      ...MODULES,
      modules: [{ id: 'z', version: '1', manifest: 'https://x.test/m.json#frag' }],
    });
    expect(got?.find(p => p.id === 'z')?.manifest).toBe('https://x.test/m.json');
  });

  it('cancels the body of an error, redirect or oversize reply', async () => {
    let cancelled = 0;
    const body = {
      getReader: (): {
        read(): Promise<{ done: boolean }>;
        cancel(): number;
      } => ({
        read: (): Promise<{ done: boolean }> => Promise.resolve({ done: true }),
        cancel: (): number => 0,
      }),
      cancel: (): void => {
        cancelled += 1;
      },
    };
    const mk = (status: number, headers: Record<string, string> = {}): ReturnType<FetchImpl> =>
      Promise.resolve({
        ok: status < 300,
        status,
        headers: { get: (n: string) => headers[n] ?? null },
        body,
        text: () => Promise.resolve(''),
      });
    const impl: FetchImpl = url =>
      url.endsWith('/err.json')
        ? mk(500)
        : url.endsWith('/big.json')
          ? mk(200, { 'content-length': '99999999' })
          : mk(302, { location: 'https://x.test/err.json' });
    const t = new VersionTracker({
      enabled: (): boolean => true,
      getModules: (): Promise<unknown> =>
        Promise.resolve({
          ...MODULES,
          modules: ['err', 'big', 'redir'].map(id => ({
            id,
            version: '1',
            active: true,
            manifest: `https://x.test/${id}.json`,
          })),
        }),
      fetchImpl: impl,
    });
    await t.view();
    await settle();
    expect(cancelled).toBeGreaterThanOrEqual(4);
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
