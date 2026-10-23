import { describe, expect, it } from 'vitest';

import { privateRollsFor } from './private-rolls.js';
import type { SessionEvent } from './feed/types.js';

const ev = (
  id: string,
  eventType: string,
  timestampMs: number,
  details: Record<string, unknown>,
  description = ''
): SessionEvent => ({
  id,
  eventType,
  timestampMs,
  timestamp: new Date(timestampMs).toISOString(),
  actorName: null,
  actorId: null,
  description,
  details,
});

const ME = 'userMeAAAAAAAAAAAA';
const OTHER = 'userOtherBBBBBBBB';
const GM = 'userGmCCCCCCCCCCC';

describe('privateRollsFor', () => {
  it('lists my private requests and their player-safe results, newest first', () => {
    const events = [
      ev('r1', 'roll-request', 1, { isPublic: false, whisperTo: [ME, GM] }, 'Private request: WIS'),
      ev(
        'x1',
        'gm-roll',
        2,
        { whisperTo: [ME, GM], playerLine: 'Hero, Wisdom check: 1d20 (14) = 14' },
        'GM text vs DC 15: failure'
      ),
    ];
    expect(privateRollsFor(ME, events)).toEqual([
      { id: 'x1', timestampMs: 2, kind: 'result', text: 'Hero, Wisdom check: 1d20 (14) = 14' },
      { id: 'r1', timestampMs: 1, kind: 'request', text: 'Private request: WIS' },
    ]);
  });

  it('never shows another player, a blind roll, a GM roll or a public request', () => {
    const events = [
      ev('r2', 'roll-request', 1, { isPublic: false, whisperTo: [OTHER, GM] }, 'to other'),
      ev('x2', 'gm-roll', 2, { whisperTo: [OTHER, GM], playerLine: 'other roll' }),
      ev('x3', 'gm-roll', 3, { whisperTo: [], playerLine: 'blind roll' }),
      ev('x4', 'gm-roll', 4, { whisperTo: [GM], playerLine: 'GM self roll' }),
      ev('x5', 'gm-roll', 5, { playerLine: 'no recipients recorded' }),
      ev('r3', 'roll-request', 6, { isPublic: true, whisperTo: [] }, 'public'),
      ev('x6', 'roll', 7, { whisperTo: [ME], playerLine: 'public roll type' }),
    ];
    expect(privateRollsFor(ME, events)).toEqual([]);
  });

  it('caps the list', () => {
    const events = Array.from({ length: 15 }, (_, i) =>
      ev(`x${i}`, 'gm-roll', i, { whisperTo: [ME], playerLine: `roll ${i}` })
    );
    expect(privateRollsFor(ME, events)).toHaveLength(10);
    expect(privateRollsFor(ME, events)[0]?.id).toBe('x14');
  });
});
