import { describe, expect, it } from 'vitest';

import { foundryNoteFrom, revealStatus, statusText, type FoundryNote } from './note.js';

const PAGE = 'JournalEntry.j1.JournalEntryPage.p1';

function page(uuid = PAGE): FoundryNote {
  return { uuid, type: 'JournalEntryPage', world: 'w', name: 'Letter' };
}

describe('foundryNoteFrom', () => {
  it('reads the mirror frontmatter', () => {
    expect(
      foundryNoteFrom({
        fvtt_uuid: 'Actor.abc123',
        fvtt_type: 'Actor',
        fvtt_world: 'strahd',
        name: 'Ireena',
      })
    ).toEqual({ uuid: 'Actor.abc123', type: 'Actor', world: 'strahd', name: 'Ireena' });
  });

  it('guesses the type from the uuid when fvtt_type is missing', () => {
    expect(foundryNoteFrom({ fvtt_uuid: PAGE })?.type).toBe('JournalEntryPage');
    expect(foundryNoteFrom({ fvtt_uuid: 'Scene.s1' })?.type).toBe('Scene');
  });

  it('ignores notes without a usable uuid', () => {
    expect(foundryNoteFrom(null)).toBeNull();
    expect(foundryNoteFrom({ title: 'x' })).toBeNull();
    expect(foundryNoteFrom({ fvtt_uuid: 'not a uuid' })).toBeNull();
    expect(foundryNoteFrom({ fvtt_uuid: 'Actor.abc?x=1' })).toBeNull();
    expect(foundryNoteFrom({ fvtt_uuid: 42 })).toBeNull();
  });
});

describe('revealStatus and statusText', () => {
  const empty = { pages: [], queue: [] };

  it('says not revealed, queued, revealed and revealed as a copy', () => {
    expect(statusText(page(), revealStatus(page(), empty))).toBe('Players: not revealed');
    expect(
      statusText(
        page(),
        revealStatus(page(), { pages: [], queue: [{ uuid: PAGE, title: null, sceneId: null }] })
      )
    ).toBe('Players: queued for reveal');
    expect(
      statusText(
        page(),
        revealStatus(page(), {
          pages: [
            {
              uuid: PAGE,
              title: 'Letter',
              observable: true,
              seenBy: [{ name: 'Ana' }, { name: 'Bo' }],
            },
          ],
          queue: [],
        })
      )
    ).toBe('Players: revealed, seen by 2');
    expect(
      statusText(
        page(),
        revealStatus(page(), {
          pages: [
            {
              uuid: 'JournalEntry.h.JournalEntryPage.c',
              title: 'Letter',
              observable: false,
              copiedFrom: PAGE,
              players: ['u1'],
            },
          ],
          queue: [],
        })
      )
    ).toBe('Players: revealed as a copy, to some players, but they cannot open it');
  });

  it('names the type for other notes and says when the dashboard is offline', () => {
    const actor: FoundryNote = { uuid: 'Actor.a', type: 'Actor', world: null, name: null };
    expect(statusText(actor, null)).toBe('Foundry: actor');
    expect(statusText(page(), 'offline')).toBe('Players: unknown (dashboard offline)');
  });
});
