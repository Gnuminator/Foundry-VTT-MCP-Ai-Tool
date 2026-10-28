/**
 * The player page follows the session (public/player-session.js, I-111): which cards come first,
 * and which revealed pages count as the recap and the quests.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { sessionPhase, splitHandouts } from '../public/player-session.js';

const open = { open: true, endedAt: null };
const closed = { open: false, endedAt: '2026-09-28T22:00:00.000Z' };
const fight = { active: true, round: 1, combatants: [] };

describe('sessionPhase', () => {
  it('is live while a session is open', () => {
    expect(sessionPhase({ session: open, combat: null })).toBe('live');
  });

  it('is between sessions once the marker says closed and no fight runs', () => {
    expect(sessionPhase({ session: closed, combat: null })).toBe('between');
    expect(sessionPhase({ session: closed, combat: { active: false } })).toBe('between');
  });

  it('stays live when a fight runs, whatever the marker says', () => {
    expect(sessionPhase({ session: closed, combat: fight })).toBe('live');
  });

  it('stays live without a marker, as the page was before', () => {
    expect(sessionPhase({ session: null, combat: null })).toBe('live');
    expect(sessionPhase({})).toBe('live');
    expect(sessionPhase(null)).toBe('live');
  });
});

describe('splitHandouts', () => {
  const page = (id: string, title: string, revealedAt: string | null = null) => ({
    id,
    title,
    html: '',
    revealedAt,
  });

  it('picks the newest recap and keeps older recaps out of the other lists', () => {
    const out = splitHandouts([
      page('a', 'Recap', '2026-09-21T22:00:00.000Z'),
      page('b', 'Recap', '2026-09-28T22:00:00.000Z'),
      page('c', 'A letter'),
    ]);
    expect(out.recap?.id).toBe('b');
    expect(out.rest.map(h => h.id)).toEqual(['c']);
    expect(out.quests).toEqual([]);
  });

  it('collects quest pages and leaves the rest as handouts', () => {
    const out = splitHandouts([
      page('q1', 'Quest: The Amber Temple'),
      page('h1', 'The map'),
      page('q2', 'Side quests'),
    ]);
    expect(out.recap).toBeNull();
    expect(out.quests.map(h => h.id)).toEqual(['q1', 'q2']);
    expect(out.rest.map(h => h.id)).toEqual(['h1']);
  });

  it('copes with nothing', () => {
    expect(splitHandouts(undefined)).toEqual({ recap: null, quests: [], rest: [] });
  });
});

describe('player page markup', () => {
  const html = readFileSync(new URL('../public/player.html', import.meta.url), 'utf8');

  it('has every card the order rules name, and no toggle hiding them', () => {
    for (const id of ['card-combat', 'card-feed', 'card-recap', 'card-handouts', 'card-quests']) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('href="/me"');
    expect(html).not.toMatch(/<input[^>]*type="checkbox"/);
  });
});
