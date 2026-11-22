import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { UsageEvent } from '@gnuminator/shared';

import { TOOL_CALL_LOG_DIR, type ToolCallLine } from './tool-call-log.js';
import {
  ClientsFile,
  buildWhoUsesWhat,
  findDownWindows,
  handleWhoUsesWhat,
  readCallLines,
} from './who-uses-what.js';

let dataDir: string;
beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'who-'));
});
afterEach(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true });
});

const NOW = Date.parse('2026-11-17T12:00:00Z');
const call = (over: Partial<ToolCallLine>): ToolCallLine => ({
  t: '2026-11-17T10:00:00.000Z',
  tool: 'get-world-info',
  set: 'core',
  ms: 5,
  size: 10,
  ok: true,
  who: 'gm',
  ...over,
});

describe('ClientsFile', () => {
  it('keeps the last version per piece, person and install, and survives a restart', async () => {
    const a = new ClientsFile(dataDir);
    expect(
      await a.record(
        { piece: 'obsidian', who: 'gm', install: 'abc123abc123', version: '0.29.1' },
        NOW
      )
    ).toBe(true);
    expect(
      await a.record(
        { piece: 'obsidian', who: 'gm', install: 'def456def456', version: '0.28.0' },
        NOW
      )
    ).toBe(true);
    expect(
      await a.record(
        { piece: 'player-extension', who: 'AbC123xyzAbC123x', version: 'v0.29.2' },
        NOW
      )
    ).toBe(true);
    const b = new ClientsFile(dataDir);
    const list = await b.list();
    expect(list).toHaveLength(3);
    expect(list.find(e => e.piece === 'player-extension')?.version).toBe('0.29.2');
  });

  it('keeps the auto-update state per install and drops values it does not know', async () => {
    const a = new ClientsFile(dataDir);
    await a.record({ piece: 'connectors', who: 'gm', install: 'aaaa1111', autoUpdate: 'on' }, NOW);
    await a.record({ piece: 'connectors', who: 'gm', install: 'bbbb2222', autoUpdate: 'off' }, NOW);
    await a.record(
      { piece: 'connectors', who: 'gm', install: 'cccc3333', autoUpdate: 'maybe' },
      NOW
    );
    const list = await new ClientsFile(dataDir).list();
    expect(list.map(e => [e.install, e.autoUpdate])).toEqual([
      ['aaaa1111', 'on'],
      ['bbbb2222', 'off'],
      ['cccc3333', null],
    ]);
  });

  it('refuses unknown pieces, odd names and free text', async () => {
    const f = new ClientsFile(dataDir);
    expect(await f.record({ piece: 'keylogger', who: 'gm', version: '1.0.0' })).toBe(false);
    expect(await f.record({ piece: 'claude', who: 'a b; rm', version: '1.0.0' })).toBe(false);
    expect(
      await f.record({ piece: 'claude', who: 'gm', name: 'x'.repeat(200), version: '1.0.0' })
    ).toBe(true);
    const [e] = await f.list();
    expect(e.name).toBe('');
    expect(await f.record('nope')).toBe(false);
  });

  it('writes nothing when logging is off', async () => {
    const f = new ClientsFile(dataDir, false);
    expect(await f.record({ piece: 'obsidian', who: 'gm', version: '1.0.0' })).toBe(false);
    await expect(fsp.readdir(path.join(dataDir, TOOL_CALL_LOG_DIR))).rejects.toThrow();
  });
});

describe('buildWhoUsesWhat', () => {
  it('makes one row per person with top tools, skills, versions and controls', () => {
    const events: UsageEvent[] = [
      {
        t: NOW - 1000,
        key: 'k1',
        kind: 'action',
        name: 'player.roll-initiative',
        surface: 'player',
        who: { role: 'player', userId: 'P1', name: 'Ebbe' },
      } as UsageEvent,
    ];
    const report = buildWhoUsesWhat({
      calls: [
        call({}),
        call({ tool: 'get-skill-guide', skill: 'gm-coach', stub: 1 }),
        call({
          who: 'player',
          userId: 'P1',
          tool: 'get-player-skill-guide',
          skill: 'dnd-helper-player',
          stub: 1,
        }),
        call({
          who: 'player',
          userId: 'P1',
          tool: 'get-character',
          ok: false,
          t: '2026-11-17T11:00:00.000Z',
        }),
      ],
      clients: [
        {
          piece: 'player-extension',
          who: 'P1',
          install: '',
          version: '0.20.0',
          name: '',
          autoUpdate: null,
          lastSeen: NOW,
        },
        {
          piece: 'obsidian',
          who: 'gm',
          install: 'abc123abc123',
          version: '0.29.2',
          name: '',
          autoUpdate: null,
          lastSeen: NOW,
        },
        // Two GM PCs on one version: separate sightings, each with its own auto-update state.
        {
          piece: 'connectors',
          who: 'gm',
          install: 'aaaa1111',
          version: '0.31.0',
          name: '',
          autoUpdate: 'on',
          lastSeen: NOW,
        },
        {
          piece: 'connectors',
          who: 'gm',
          install: 'bbbb2222',
          version: '0.31.0',
          name: '',
          autoUpdate: 'off',
          lastSeen: NOW,
        },
        // A stale sighting from a client without ids: hidden once an id-bearing one exists.
        {
          piece: 'connectors',
          who: 'gm',
          install: '',
          version: '0.29.0',
          name: '',
          autoUpdate: null,
          lastSeen: NOW,
        },
      ],
      usageEvents: events,
      toolNames: ['get-world-info', 'get-skill-guide', 'get-character', 'never-called'],
      current: '0.29.2',
      days: 7,
      now: NOW,
    });
    expect(report.people.map(p => p.key)).toEqual(['gm', 'P1']);
    const gm = report.people[0];
    expect(gm.calls).toBe(2);
    const connectors = gm.versions.filter(v => v.piece === 'connectors');
    expect(connectors.map(v => [v.install, v.autoUpdate])).toEqual([
      ['aaaa1111', 'on'],
      ['bbbb2222', 'off'],
    ]);
    expect(gm.skills).toEqual([{ skill: 'gm-coach', stub: 1, calls: 1 }]);
    expect(gm.versions.find(v => v.piece === 'obsidian')).toMatchObject({
      piece: 'obsidian',
      install: 'abc123abc123',
      behind: false,
    });
    const p = report.people[1];
    expect(p.name).toBe('Ebbe');
    expect(p.errors).toBe(1);
    // The newest of its calls, controls and version sightings.
    expect(p.lastSeen).toBe('2026-11-17T12:00:00.000Z');
    expect(p.versions[0]).toMatchObject({ piece: 'player-extension', behind: true });
    expect(p.controls).toEqual({ events: 1, top: [{ name: 'player.roll-initiative', uses: 1 }] });
    expect(report.tools.neverCalled).toEqual(['never-called']);
    expect(report.tools.errorRates).toEqual([{ name: 'get-character', calls: 1, errors: 1 }]);
  });

  it('puts lines from before callers were logged under unknown', () => {
    const report = buildWhoUsesWhat({
      calls: [{ ...call({}), who: undefined }],
      clients: [],
      usageEvents: [],
      toolNames: null,
      current: '0.29.2',
      days: 7,
      now: NOW,
    });
    expect(report.people[0]).toMatchObject({ key: 'unknown', role: 'unknown', calls: 1 });
    expect(report.tools.neverCalled).toBeNull();
  });

  it('never carries arguments or text: a row holds only fixed fields', () => {
    const report = buildWhoUsesWhat({
      calls: [call({})],
      clients: [],
      usageEvents: [],
      toolNames: null,
      current: '0.29.2',
      days: 7,
      now: NOW,
    });
    expect(Object.keys(report.people[0]).sort()).toEqual(
      [
        'calls',
        'claudeCalls',
        'controls',
        'dashboardCalls',
        'dashboardTools',
        'errors',
        'key',
        'lastSeen',
        'name',
        'realErrors',
        'role',
        'skills',
        'topTools',
        'versions',
      ].sort()
    );
  });

  it('splits dashboard refreshes from calls made through Claude', () => {
    const report = buildWhoUsesWhat({
      calls: [
        call({ tool: 'get-combat-state', via: 'dashboard' }),
        call({ tool: 'get-combat-state', via: 'dashboard' }),
        call({ tool: 'get-character', via: 'connector' }),
        call({ tool: 'list-scenes' }),
      ],
      clients: [],
      usageEvents: [],
      toolNames: null,
      current: '0.29.2',
      days: 7,
      now: NOW,
    });
    const gm = report.people[0];
    expect(gm).toMatchObject({ calls: 4, claudeCalls: 2, dashboardCalls: 2 });
    expect(gm.topTools.map(t => t.name).sort()).toEqual(['get-character', 'list-scenes']);
    expect(gm.dashboardTools).toEqual([{ name: 'get-combat-state', calls: 2 }]);
  });

  it('groups errors: a run of immediate failures is a Foundry-down window, the rest is real', () => {
    const fail = (t: string): ToolCallLine =>
      call({ t, ok: false, ms: 0, size: 0, via: 'dashboard' });
    const report = buildWhoUsesWhat({
      calls: [
        fail('2026-11-17T03:30:00.000Z'),
        fail('2026-11-17T03:30:04.000Z'),
        fail('2026-11-17T03:30:08.000Z'),
        fail('2026-11-17T08:00:00.000Z'),
        call({ t: '2026-11-17T09:00:00.000Z', ok: false, ms: 900, size: 40, err: 'validation' }),
        call({ t: '2026-11-17T09:30:00.000Z', ok: false, ms: 3, size: 20, err: 'not-connected' }),
      ],
      clients: [],
      usageEvents: [],
      toolNames: null,
      current: '0.29.2',
      days: 7,
      now: NOW,
    });
    expect(report.errorCauses.total).toBe(6);
    expect(report.errorCauses.foundryDown.calls).toBe(4);
    expect(report.errorCauses.foundryDown.windows).toEqual([
      { from: '2026-11-17T03:30:00.000Z', to: '2026-11-17T03:30:08.000Z', calls: 3 },
    ]);
    expect(report.errorCauses.real).toEqual([
      { cause: 'unclassified', calls: 1 },
      { cause: 'validation', calls: 1 },
    ]);
    expect(report.people[0]).toMatchObject({ errors: 6, realErrors: 2 });
    expect(report.tools.errorRates).toEqual([{ name: 'get-world-info', calls: 6, errors: 2 }]);
  });
});

describe('findDownWindows', () => {
  const fail = (t: string, over: Partial<ToolCallLine> = {}): ToolCallLine =>
    call({ t, ok: false, ms: 0, size: 0, ...over });

  it('needs three failures, sorts its input and keeps a gap of exactly two minutes in the run', () => {
    const two = findDownWindows([fail('2026-11-17T03:00:00Z'), fail('2026-11-17T03:00:05Z')]);
    expect(two.windows).toEqual([]);
    const three = findDownWindows([
      fail('2026-11-17T03:04:00Z'),
      fail('2026-11-17T03:00:00Z'),
      fail('2026-11-17T03:02:00Z'),
    ]);
    expect(three.windows).toHaveLength(1);
    expect(three.windows[0]).toMatchObject({ calls: 3 });
  });

  it('skips bad times, and counts a slow not-connected failure as down without a window', () => {
    const slow = fail('2026-11-17T05:00:00Z', { ms: 400, size: 30, err: 'not-connected' });
    const r = findDownWindows([
      fail('not a time'),
      slow,
      fail('2026-11-17T04:00:00Z', { err: 'other' }),
    ]);
    expect(r.windows).toEqual([]);
    expect(r.down.has(slow)).toBe(true);
    expect(r.down.size).toBe(1);
  });
});

describe('handleWhoUsesWhat', () => {
  it('reads the last days of call files and clamps the day count', async () => {
    const dir = path.join(dataDir, TOOL_CALL_LOG_DIR);
    await fsp.mkdir(dir, { recursive: true });
    const today = new Date().toISOString();
    const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
    await fsp.writeFile(
      path.join(dir, '2026-11-17.calls.jsonl'),
      `${JSON.stringify(call({ t: today }))}\nnot json\n${JSON.stringify(call({ t: old }))}\n`
    );
    const lines = await readCallLines(dataDir, 7);
    expect(lines).toHaveLength(1);
    const report = await handleWhoUsesWhat(
      {
        dataDir,
        clients: new ClientsFile(dataDir),
        usageEvents: () => Promise.reject(new Error('no world')),
        toolNames: () => ['get-world-info'],
        current: '0.29.2',
      },
      { days: 9999 }
    );
    expect(report.days).toBe(90);
    expect(report.people[0].calls).toBe(2);
  });
});
