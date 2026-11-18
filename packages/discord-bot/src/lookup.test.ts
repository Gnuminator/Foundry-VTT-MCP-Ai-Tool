import { describe, expect, it } from 'vitest';

import {
  NOTHING_REVEALED,
  createPlayerStateReader,
  handoutsAnswer,
  htmlToText,
  npcAnswer,
  publicHandouts,
  recapAnswer,
} from './lookup.js';

const SECRET = 'SECRET-DO-NOT-LEAK';
const state = {
  handouts: [
    {
      id: '1',
      title: 'Ireena Kolyana',
      html: '<p>Daughter of the burgomaster.</p>',
      revealedAt: '2026-11-01T10:00:00Z',
    },
    {
      id: '2',
      title: 'Recap session 1',
      html: '<p>Old recap</p>',
      revealedAt: '2026-11-02T10:00:00Z',
    },
    {
      id: '3',
      title: 'Recap session 2',
      html: '<p>New recap<br>line 2</p>',
      revealedAt: '2026-11-09T10:00:00Z',
    },
    {
      id: '4',
      title: 'Strahd secret',
      html: `<p>${SECRET}</p>`,
      revealedAt: '2026-11-03T10:00:00Z',
      players: ['u1'],
    },
  ],
  events: [{ text: SECRET }],
  scene: SECRET,
};

describe('lookups', () => {
  it('drops handouts meant for chosen players', () => {
    expect(publicHandouts(state).map(h => h.id)).toEqual(['1', '2', '3']);
  });

  it('recap is the newest recap handout', () => {
    expect(recapAnswer(state)).toContain('New recap\nline 2');
    expect(recapAnswer({ handouts: [] })).toBe(NOTHING_REVEALED);
  });

  it('npc matches by title and answers nothing revealed otherwise', () => {
    expect(npcAnswer(state, 'ireena')).toContain('Daughter of the burgomaster.');
    expect(npcAnswer(state, 'Kolyana')).toContain('Daughter');
    expect(npcAnswer(state, 'Strahd')).toBe(NOTHING_REVEALED);
    expect(npcAnswer(state, '')).toBe(NOTHING_REVEALED);
    expect(npcAnswer(null, 'ireena')).toBe(NOTHING_REVEALED);
  });

  it('no hidden text can come back from any command or query', () => {
    for (const q of ['Strahd secret', 'secret', 'strahd', SECRET, 'u1', '.*', 'a']) {
      expect(npcAnswer(state, q)).not.toContain(SECRET);
    }
    expect(recapAnswer(state)).not.toContain(SECRET);
    expect(handoutsAnswer(state)).not.toContain(SECRET);
    expect(handoutsAnswer(state)).not.toContain('Strahd secret');
  });

  it('lists titles newest first and handles odd input', () => {
    expect(handoutsAnswer(state).split('\n')).toEqual([
      '- Recap session 2',
      '- Recap session 1',
      '- Ireena Kolyana',
    ]);
    expect(handoutsAnswer({})).toBe(NOTHING_REVEALED);
    expect(handoutsAnswer({ handouts: [null, 3, { title: 1 }] })).toBe(NOTHING_REVEALED);
  });

  it('turns html into text and clips long answers', () => {
    expect(htmlToText('<h1>A &amp; B</h1><script>x()</script><p>c</p>')).toBe('A & B\nc');
    const long = {
      handouts: [{ id: 'x', title: 'Recap', html: `<p>${'a'.repeat(5000)}</p>`, revealedAt: null }],
    };
    expect(recapAnswer(long).length).toBeLessThanOrEqual(2000);
  });

  it('reader sends the token and returns null on failure', async () => {
    let seen: unknown;
    const ok = createPlayerStateReader({
      dashboardUrl: 'http://x/',
      token: 't',
      fetch: (async (u: string, init: { headers: unknown }): Promise<unknown> => {
        seen = [u, init.headers];
        return { ok: true, json: (): Promise<unknown> => Promise.resolve(state) };
      }) as never,
    });
    expect(await ok()).toBe(state);
    expect(seen).toEqual(['http://x/api/player/state', { 'X-CoGM-Token': 't' }]);
    const bad = createPlayerStateReader({
      dashboardUrl: 'http://x',
      fetch: (): Promise<never> => Promise.reject(new Error('down')),
    });
    expect(await bad()).toBeNull();
  });
});
