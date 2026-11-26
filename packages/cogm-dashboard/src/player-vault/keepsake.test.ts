/**
 * Keepsake ledgers: built only from the public log, so a name players may not know never appears;
 * the same ledgers feed `/me` and the vault note; rules are a player's own.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { describe, expect, it } from 'vitest';

import type { PlayerEvent } from '@gnuminator/shared';

import type { SessionEvent } from '../feed/types.js';
import { projectEvent } from '../player/projection.js';

import { buildKeepsakeLedgers, KeepsakeStore, type KeepsakeRule } from './keepsake.js';
import { renderPlayerVault } from './render.js';
import type { PlayerStats } from './stats.js';
import type { PlayerVaultInput, VaultSession } from './types.js';

const T0 = new Date(2026, 10, 22, 20, 0, 0).getTime();

function death(id: string, name: string, tokenVisible: boolean, at = T0): SessionEvent {
  return {
    id,
    timestamp: new Date(at).toISOString(),
    timestampMs: at,
    eventType: 'death',
    actorName: 'TRUE-NAME',
    actorId: id,
    description: 'TRUE-NAME was reduced to 0 HP',
    details: {},
    visibility: { subject: 'npc', tokenVisible, playerName: name },
  };
}

function sessionOf(events: SessionEvent[]): VaultSession {
  return {
    label: '2026-11-22',
    events: events.map(projectEvent).filter(e => e !== null),
  };
}

const NAMES: KeepsakeRule = {
  id: 'AAAAAAAAAAAA',
  character: 'Ebbe',
  kind: 'names',
  title: 'The book of the names of the dead',
};

describe('buildKeepsakeLedgers', () => {
  it('lists the visible names with the date and never a hidden one', () => {
    const session = sessionOf([
      death('d1', 'Old Man Willow', true),
      death('d2', 'Hidden Strahd Spy', false),
      death('d3', 'Wolf', true, T0 + 60_000),
    ]);
    const [ledger] = buildKeepsakeLedgers([NAMES], [session], null);
    expect(ledger.lines.map(l => l.text)).toEqual(['Old Man Willow', 'Wolf']);
    expect(ledger.lines[0].date).toBe('2026-11-22');
    expect(ledger.summary).toBe('2 names.');
    expect(JSON.stringify(ledger)).not.toMatch(/Hidden Strahd Spy|TRUE-NAME/);
  });

  it('counts events of one type, zero when none happened', () => {
    const rule: KeepsakeRule = {
      id: 'BBBBBBBBBBBB',
      character: 'Gideon',
      kind: 'count',
      title: 'Evening prayer',
      eventType: 'rest',
      unit: 'prayers',
    };
    const rest = (id: string, at: number): PlayerEvent => ({
      id,
      timestampMs: at,
      type: 'rest',
      text: 'Rested.',
    });
    const [none] = buildKeepsakeLedgers([rule], [sessionOf([])], null);
    expect(none.summary).toBe('0 prayers.');
    const [two] = buildKeepsakeLedgers(
      [rule],
      [{ label: 'x', events: [rest('r1', T0), rest('r2', T0 + 1)] }],
      null
    );
    expect(two.summary).toBe('2 prayers, the last on 2026-11-22.');
  });

  it('shows the net coin of the character from the allowed stats', () => {
    const stats = {
      campaign: {},
      pcs: [{ name: 'Barnon', currencyDelta: { gp: 12, sp: -5 } }],
    } as unknown as PlayerStats;
    const rule: KeepsakeRule = {
      id: 'CCCCCCCCCCCC',
      character: 'Barnon',
      kind: 'purse',
      title: 'Purse',
    };
    const [ledger] = buildKeepsakeLedgers([rule], [], stats);
    expect(ledger.lines.map(l => l.text)).toEqual(['+12 gp', '-5 sp']);
    expect(buildKeepsakeLedgers([rule], [], null)[0].summary).toBe('No coin won or lost yet.');
  });

  it('writes the same ledger into the vault note', () => {
    const ledgers = buildKeepsakeLedgers([NAMES], [sessionOf([death('d1', 'Wolf', true)])], null);
    const input = {
      worldTitle: 'W',
      player: { userId: 'u1', name: 'Anna' },
      handouts: [],
      sheets: [],
      sessions: [],
      keepsakes: ledgers,
      theme: { id: 'veil', css: null },
    } as unknown as PlayerVaultInput;
    const files = renderPlayerVault(input);
    expect(files.get('My keepsakes.md')).toContain('2026-11-22 Wolf');
    expect(files.get('Home.md')).toContain('My keepsakes');
    input.keepsakes = [];
    expect(renderPlayerVault(input).has('My keepsakes.md')).toBe(false);
  });
});

describe('KeepsakeStore', () => {
  const USER = 'anna000000000001';

  it('keeps rules per player, validates them and survives a restart', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'keepsake-')), 's.json');
    const a = new KeepsakeStore(file);
    expect(a.add('w', USER, { kind: 'nope', title: 'x' })).toEqual({ ok: false, code: 'bad-kind' });
    expect(a.add('w', USER, { kind: 'names', title: '  ' })).toEqual({
      ok: false,
      code: 'no-title',
    });
    expect(a.add('w', USER, { kind: 'count', title: 'x', eventType: 'gm-roll' })).toEqual({
      ok: false,
      code: 'bad-event',
    });
    const added = a.add('w', USER, { kind: 'names', title: 'Book', character: 'Ebbe' });
    expect(added.ok).toBe(true);
    await a.flush();
    const b = new KeepsakeStore(file);
    expect(b.list('w', USER)).toHaveLength(1);
    expect(b.list('w', 'ben0000000000002')).toEqual([]);
    expect(b.remove('w', USER, (added as { rule: KeepsakeRule }).rule.id)).toBe(true);
    for (let i = 0; i < 6; i++) b.add('w', USER, { kind: 'names', title: `k${i}` });
    expect(b.add('w', USER, { kind: 'names', title: 'one more' })).toEqual({
      ok: false,
      code: 'full',
    });
  });
});
