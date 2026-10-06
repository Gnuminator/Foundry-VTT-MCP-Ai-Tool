/**
 * The player view source with a reveal copy (a handout copied into the player
 * journal "Handouts"): the bridge lists the copy as an ordinary revealed
 * handout, and the player page shows it like any other, sanitized and
 * projected to its player fields only.
 */
import { describe, expect, it } from 'vitest';

import { Logger } from '../logger.js';

import { buildPlayerState } from './projection.js';
import { PlayerViewSource, type PlayerSourceClient } from './source.js';

const COPY = 'JournalEntry.hhhhhhhhhhhhhhhh.JournalEntryPage.cccccccccccccccc';
const SOURCE = 'JournalEntry.gggggggggggggggg.JournalEntryPage.ssssssssssssssss';

function clientWith(answers: Record<string, unknown>): PlayerSourceClient {
  return {
    isConnected: true,
    callTool: <T>(name: string): Promise<T> =>
      name in answers
        ? Promise.resolve(answers[name] as T)
        : Promise.reject(new Error(`unknown tool ${name}`)),
  };
}

describe('PlayerViewSource with a reveal copy', () => {
  it('lists the copy as a revealed handout, sanitized and projected', async () => {
    const client = clientWith({
      'get-player-visibility': {
        schema: 1,
        computedAt: 0,
        pcActorIds: [],
        scene: null,
        tokens: [],
      },
      // What the bridge's get-player-handouts returns once the copy is applied.
      'get-player-handouts': {
        revealedUuids: [COPY],
        handouts: [
          {
            id: 'cccccccccccccccc',
            uuid: COPY,
            title: 'A Letter',
            html: `<p>Dear friends, see @UUID[${SOURCE}]{the cellar}.</p><p><img src="x.webp"></p>`,
            revealedAt: '2026-09-29T20:00:00.000Z',
          },
        ],
      },
    });
    let changes = 0;
    const source = new PlayerViewSource(client, new Logger('error', 'test'), () => {
      changes += 1;
    });
    await source.refresh();
    expect(changes).toBe(1);
    // A link to the (unrevealed) source page is dropped with its label; the image goes too.
    expect(source.handouts).toEqual([
      {
        id: 'cccccccccccccccc',
        title: 'A Letter',
        html: '<p>Dear friends, see .</p><p></p>',
        revealedAt: '2026-09-29T20:00:00.000Z',
      },
    ]);

    const state = buildPlayerState({
      status: {
        controlChannel: 'connected',
        foundry: 'reachable',
        lastError: null,
        lastPollAt: null,
        foundryDownSince: null,
      },
      world: null,
      visibility: source.visibility,
      combat: null,
      events: [],
      handouts: source.handouts,
      opts: { showEnemyHpBands: false, showEnemyConditions: false },
    });
    expect(state.handouts).toEqual(source.handouts);
    expect(JSON.stringify(state)).not.toContain(SOURCE);
    expect(JSON.stringify(state)).not.toContain(COPY);
  });
});

describe('PlayerViewSource per player (O7 vaults)', () => {
  const ALICE = 'aaaaaaaaaaaaaaaa';
  const BOB = 'bbbbbbbbbbbbbbbb';
  const CAROL = 'cccccccccccccccc';
  const PUBLIC_PAGE = 'JournalEntry.jjjjjjjjjjjjjjjj.JournalEntryPage.pppppppppppppppp';
  const BOB_PAGE = 'JournalEntry.jjjjjjjjjjjjjjjj.JournalEntryPage.bbbbbbbbbbbbbbbb';
  const LINKS = `<p>See @UUID[${BOB_PAGE}]{Bob Door} and @UUID[${PUBLIC_PAGE}]{Town Door}.</p>`;

  function source(): PlayerViewSource {
    return new PlayerViewSource(
      clientWith({
        'get-player-visibility': { pcActorIds: [], tokens: [] },
        'get-player-handouts': {
          handouts: [
            { id: 'pub', uuid: PUBLIC_PAGE, title: 'Town', html: LINKS, revealedAt: null },
            {
              id: 'alice',
              uuid: 'JournalEntry.jjjjjjjjjjjjjjjj.JournalEntryPage.aaaaaaaaaaaaaaaa',
              title: 'Alice letter',
              html: LINKS,
              revealedAt: null,
              players: [ALICE],
            },
            {
              id: 'bob',
              uuid: BOB_PAGE,
              title: 'Bob page',
              html: '<p>Bob only</p>',
              revealedAt: null,
              players: [BOB],
            },
          ],
          revealedUuids: [PUBLIC_PAGE, BOB_PAGE],
        },
      }),
      new Logger('error'),
      () => undefined
    );
  }

  it('is not ready before the first answer, and ready after it', async () => {
    const s = source();
    expect(s.handoutsReady).toBe(false);
    expect(s.handoutsFor(ALICE)).toEqual([]);
    await s.refresh();
    expect(s.handoutsReady).toBe(true);
  });

  it('stays not ready while get-player-handouts fails', async () => {
    const s = new PlayerViewSource(
      clientWith({ 'get-player-visibility': { pcActorIds: [], tokens: [] } }),
      new Logger('error'),
      () => undefined
    );
    await s.refresh();
    expect(s.handoutsReady).toBe(false);
  });

  it('cleans links per player: a page revealed to Bob only keeps its label only for Bob', async () => {
    const s = source();
    await s.refresh();

    const alice = s.handoutsFor(ALICE);
    expect(alice.map(h => h.id)).toEqual(['pub', 'alice']);
    for (const h of alice) {
      expect(h.html).toContain('Town Door');
      expect(h.html).not.toContain('Bob Door');
    }

    const bob = s.handoutsFor(BOB);
    expect(bob.map(h => h.id)).toEqual(['pub', 'bob']);
    expect(bob[0].html).toContain('Bob Door');
    expect(bob[0].html).toContain('Town Door');

    // A player on no list sees only the handouts for everyone, without Bob's label.
    const carol = s.handoutsFor(CAROL);
    expect(carol.map(h => h.id)).toEqual(['pub']);
    expect(carol[0].html).not.toContain('Bob Door');

    // The player page keeps its list: every handout, links cleaned against every revealed page.
    expect(s.handouts.map(h => h.id)).toEqual(['pub', 'alice', 'bob']);
    expect(s.handouts[0].html).toContain('Bob Door');
  });
});
