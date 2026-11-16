import { describe, expect, it } from 'vitest';

import type { SessionEvent } from './feed/types.js';
import { buildRollRows, openRolls } from './roll-status.js';

const PLAYERS = new Set(['userAAAAAAAAAAAA', 'userBBBBBBBBBBBB']);
const isPlayer = (id: string): boolean => PLAYERS.has(id);

let n = 0;
function ev(
  eventType: string,
  timestampMs: number,
  actorId: string | null,
  details: Record<string, unknown>
): SessionEvent {
  n += 1;
  return {
    id: `e${n}`,
    timestamp: new Date(timestampMs).toISOString(),
    timestampMs,
    eventType,
    actorName: actorId,
    actorId,
    description: `${eventType} ${n}`,
    details,
  };
}

const request = (t: number, actor: string, user: string | null, extra = {}): SessionEvent =>
  ev('roll-request', t, actor, {
    label: 'Perception Skill Check',
    isPublic: true,
    targetName: actor,
    targetUserId: user,
    whisperTo: [],
    ...extra,
  });

describe('buildRollRows', () => {
  it('lists a request as sent until its character rolls', () => {
    const rows = buildRollRows([request(1000, 'actA', 'userAAAAAAAAAAAA')], isPlayer);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'sent', userId: 'userAAAAAAAAAAAA', isPublic: true });
  });

  it('marks it rolled by the next check of the same character and keeps the total', () => {
    const rows = buildRollRows(
      [
        request(1000, 'actA', 'userAAAAAAAAAAAA'),
        request(1000, 'actB', 'userBBBBBBBBBBBB'),
        ev('roll', 2000, 'actA', { rollType: 'skill', total: 17 }),
      ],
      isPlayer
    );
    const a = rows.find(r => r.actorId === 'actA');
    const b = rows.find(r => r.actorId === 'actB');
    expect(a).toMatchObject({ status: 'rolled', total: 17 });
    expect(b).toMatchObject({ status: 'sent' });
  });

  it('counts a whispered roll (gm-roll) and ignores attacks, damage and earlier rolls', () => {
    const rows = buildRollRows(
      [
        ev('roll', 100, 'actA', { rollType: 'skill', total: 5 }),
        request(10_000, 'actA', 'userAAAAAAAAAAAA', { isPublic: false }),
        ev('roll', 11_000, 'actA', { rollType: 'attack', total: 20 }),
        ev('damage-roll', 11_500, 'actA', { rollType: 'damage', total: 9 }),
      ],
      isPlayer
    );
    expect(rows[0]?.status).toBe('sent');
    const done = buildRollRows(
      [
        request(10_000, 'actA', 'userAAAAAAAAAAAA', { isPublic: false }),
        ev('gm-roll', 12_000, 'actA', { rollType: 'save', total: 12 }),
      ],
      isPlayer
    );
    expect(done[0]).toMatchObject({ status: 'rolled', total: 12 });
  });

  it('lets one roll answer one request', () => {
    const rows = buildRollRows(
      [
        request(1000, 'actA', 'userAAAAAAAAAAAA'),
        request(2000, 'actA', 'userAAAAAAAAAAAA'),
        ev('roll', 3000, 'actA', { rollType: 'skill', total: 8 }),
      ],
      isPlayer
    );
    // Newest first: the newest request takes the roll, so an old one nobody answered cannot
    // swallow the roll of the ask the GM is watching.
    expect(rows.map(r => r.status)).toEqual(['rolled', 'sent']);
  });

  it('takes the player from the whisper list of an older module, never a GM', () => {
    const rows = buildRollRows(
      [
        request(1000, 'actA', null, {
          isPublic: false,
          targetUserId: undefined,
          whisperTo: ['gmGMGMGMGMGMGMGM', 'userBBBBBBBBBBBB'],
        }),
      ],
      isPlayer
    );
    expect(rows[0]?.userId).toBe('userBBBBBBBBBBBB');
  });

  it('leaves the user empty for a public request from an older module', () => {
    const rows = buildRollRows(
      [request(1000, 'actA', null, { targetUserId: undefined })],
      isPlayer
    );
    expect(rows[0]?.userId).toBeNull();
  });
});

describe('openRolls', () => {
  it('carries only waiting requests that name a player, without totals', () => {
    const rows = buildRollRows(
      [
        request(1000, 'actA', 'userAAAAAAAAAAAA'),
        request(1000, 'actB', 'userBBBBBBBBBBBB'),
        request(1000, 'actC', null),
        ev('roll', 2000, 'actB', { rollType: 'skill', total: 14 }),
      ],
      isPlayer
    );
    const open = openRolls(rows, 3000);
    expect(open).toHaveLength(1);
    expect(open[0]).toEqual({
      id: expect.any(String),
      sentAt: 1000,
      label: 'Perception Skill Check',
      userId: 'userAAAAAAAAAAAA',
    });
    expect(JSON.stringify(open)).not.toContain('14');
  });

  it('drops a request after half an hour', () => {
    const rows = buildRollRows([request(0, 'actA', 'userAAAAAAAAAAAA')], isPlayer);
    expect(openRolls(rows, 31 * 60 * 1000)).toEqual([]);
  });
});
