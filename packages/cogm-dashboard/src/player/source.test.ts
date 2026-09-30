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
