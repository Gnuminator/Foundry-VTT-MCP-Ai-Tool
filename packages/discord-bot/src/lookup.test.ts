import { describe, expect, it } from 'vitest';

import {
  LOOKUP_UNAVAILABLE,
  NOTHING_FOUND,
  NOTHING_REVEALED,
  ruleAnswer,
  lookupAllowed,
  lookupReply,
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

describe('rule lookup', () => {
  const rules = {
    handouts: [
      {
        id: 'h',
        title: 'House rules',
        html: '<h2>Exhaustion</h2><p>Each level costs 2 off d20 tests.</p><p>Flanking: none.</p>',
        revealedAt: '2026-11-26T10:00:00Z',
      },
      { id: 'g', title: 'GM notes', html: `<p>exhaustion ${SECRET}</p>`, players: ['u1'] },
    ],
  };

  it('a title hit answers with the whole page', () => {
    const text = ruleAnswer(rules, 'house');
    expect(text).toContain('**House rules**');
    expect(text).toContain('Flanking: none.');
  });

  it('a body hit answers with only the matching lines', () => {
    const text = ruleAnswer(rules, 'exhaustion');
    expect(text).toContain('Each level costs');
    expect(text).not.toContain('Flanking');
  });

  it('never answers from a GM-only page', () => {
    expect(ruleAnswer(rules, 'exhaustion')).not.toContain(SECRET);
    expect(ruleAnswer(rules, 'secret')).toBe(NOTHING_FOUND);
  });

  it('misses, empty queries and failed reads are plain', () => {
    expect(ruleAnswer(rules, 'grapple')).toBe(NOTHING_FOUND);
    expect(ruleAnswer(rules, '')).toBe(NOTHING_REVEALED);
    expect(lookupReply('rule', 'house', null)).toBe(LOOKUP_UNAVAILABLE);
  });

  it('matches whole words, not parts of words', () => {
    const s = { handouts: [{ id: 'x', title: 'Haunted Mouse', html: '<p>squeak</p>' }] };
    expect(ruleAnswer(s, 'house')).toBe(NOTHING_FOUND);
    expect(ruleAnswer(s, 'haunt')).toContain('Haunted Mouse');
  });

  it('keeps many long matching lines under the cap', () => {
    const line = `<p>exhaustion ${'y'.repeat(400)}</p>`;
    const s = { handouts: [{ id: 'l', title: 'Notes', html: line.repeat(8) }] };
    expect(ruleAnswer(s, 'exhaustion').length).toBeLessThanOrEqual(1800);
  });

  it('stays under the Discord cap', () => {
    const big = {
      handouts: [{ id: 'b', title: 'House rules', html: `<p>${'x '.repeat(3000)}</p>` }],
    };
    expect(ruleAnswer(big, 'house').length).toBeLessThanOrEqual(2000);
  });
});

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
    expect(htmlToText('a<br>b<STYLE>x{}</STYLE>c')).toBe('a\nbc');
    expect(htmlToText('before <script>never')).toBe('before');
    expect(htmlToText('half <b')).toBe('half');
    const long = {
      handouts: [{ id: 'x', title: 'Recap', html: `<p>${'a'.repeat(5000)}</p>`, revealedAt: null }],
    };
    expect(recapAnswer(long).length).toBeLessThanOrEqual(2000);
  });

  it('recap also finds Danish titles', () => {
    const da = {
      handouts: [{ id: 'a', title: 'Resumé af session 2', html: '<p>Hej</p>', revealedAt: null }],
    };
    expect(recapAnswer(da)).toContain('Hej');
    expect(
      recapAnswer({ handouts: [{ id: 'b', title: 'Recapitulate', html: 'x', revealedAt: null }] })
    ).toBe(NOTHING_REVEALED);
  });

  it('runs only in the game server, never in a DM', () => {
    expect(lookupAllowed(null, undefined)).toBe(false);
    expect(lookupAllowed('g1', undefined)).toBe(true);
    expect(lookupAllowed('g1', 'g1')).toBe(true);
    expect(lookupAllowed('g2', 'g1')).toBe(false);
  });

  it('a failed read is "could not look that up", not "nothing revealed"', () => {
    expect(lookupReply('recap', '', null)).toBe(LOOKUP_UNAVAILABLE);
    expect(lookupReply('npc', 'ireena', null)).toBe(LOOKUP_UNAVAILABLE);
    expect(lookupReply('handouts', '', state)).toContain('Ireena Kolyana');
    expect(lookupReply('npc', 'ireena', state)).toContain('Daughter');
  });

  it('clips by characters and says so', () => {
    const long = {
      handouts: [
        { id: 'x', title: 'Recap', html: `<p>${'😀'.repeat(3000)}</p>`, revealedAt: null },
      ],
    };
    const out = recapAnswer(long);
    expect(out.length).toBeLessThanOrEqual(2000);
    expect(out).toContain('More on the player page');
  });

  it('reader gives up after its time limit and on a bad answer', async () => {
    const hung = createPlayerStateReader({
      dashboardUrl: 'http://x',
      fetch: ((_u: string, init: { signal: AbortSignal }): Promise<never> =>
        new Promise((_res, rej) => {
          init.signal.addEventListener('abort', () => rej(new Error('aborted')));
        })) as never,
    });
    const started = Date.now();
    expect(await hung()).toBeNull();
    expect(Date.now() - started).toBeLessThan(6000);
    const notOk = createPlayerStateReader({
      dashboardUrl: 'http://x',
      fetch: ((): Promise<unknown> => Promise.resolve({ ok: false })) as never,
    });
    expect(await notOk()).toBeNull();
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
