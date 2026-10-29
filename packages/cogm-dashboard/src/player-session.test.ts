/**
 * The player page follows the session (public/player-session.js, I-111): which cards come first,
 * and which revealed pages count as the recap and the quests.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { sanitizeHandoutHtml } from './player/sanitize.js';
import { handoutTitle, sessionPhase, splitHandouts } from '../public/player-session.js';

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

describe('handoutTitle', () => {
  it('shows the quest title from the page h1 when the page is named Quest Details', () => {
    expect(
      handoutTitle({
        title: 'Quest Details',
        html: '<h1>The <em>Lost</em> Amulet &amp; more</h1><p>x</p>',
      })
    ).toBe('The Lost Amulet & more');
  });

  it('leaves no tag behind when tags are nested to survive one strip pass', () => {
    expect(
      handoutTitle({
        title: 'Quest Details',
        html: '<h1><<script>script>alert(1)<</script>/script></h1>',
      })
    ).toBe('script>alert(1)/script>'.replace(/[<>]/g, ''));
    expect(handoutTitle({ title: 'Quest Details', html: '<h1>a<<b>b>c</h1>' })).not.toMatch(/[<>]/);
  });

  it('keeps every other title, and falls back when there is no usable h1', () => {
    expect(handoutTitle({ title: 'Session 2 Recap', html: '<h1>Other</h1>' })).toBe(
      'Session 2 Recap'
    );
    expect(handoutTitle({ title: 'Quest Details', html: '<p>no heading</p>' })).toBe(
      'Quest Details'
    );
    expect(handoutTitle({ title: 'Quest Details', html: '<h1> </h1>' })).toBe('Quest Details');
  });
});

describe('handoutTitle after the real sanitizer', () => {
  it('reads the quest title out of a styled quest page as a player gets it', () => {
    const page =
      '<section class="mcp-journal"><style>.x{}</style><div class="wrap"><h1>Find the <b>Amulet</b></h1>' +
      '<hr class="orn"/><h2>Background</h2><p>text</p></div></section>';
    const html = sanitizeHandoutHtml(page, []);
    expect(handoutTitle({ title: 'Quest Details', html })).toBe('Find the Amulet');
  });

  it('decodes what the sanitizer escapes (apostrophe, ampersand, accents)', () => {
    const html = sanitizeHandoutHtml('<div><h1>Ireena\'s Escort &amp; Åse "Café"</h1></div>', []);
    expect(handoutTitle({ title: 'Quest Details', html })).toBe('Ireena\'s Escort & Åse "Café"');
  });
});

describe('splitHandouts', () => {
  const page = (
    id: string,
    title: string,
    revealedAt: string | null = null
  ): { id: string; title: string; html: string; revealedAt: string | null } => ({
    id,
    title,
    html: '',
    revealedAt,
  });

  it('picks the newest recap and leaves older recaps visible under the handouts', () => {
    const out = splitHandouts([
      page('a', 'Recap', '2026-09-21T22:00:00.000Z'),
      page('b', 'Recap', '2026-09-28T22:00:00.000Z'),
      page('c', 'A letter'),
    ]);
    expect(out.recap?.id).toBe('b');
    expect(out.rest.map(h => h.id)).toEqual(['a', 'c']);
    expect(out.quests).toEqual([]);
  });

  it('matches the page names the tools and the GM really use', () => {
    const out = splitHandouts([
      page('d', 'Quest Details'),
      page('r1', 'Session 3 Recap', '2026-10-01T20:00:00.000Z'),
      page('r2', 'Resumé af session 4', '2026-10-08T20:00:00.000Z'),
      page('h', 'Letter from Strahd'),
    ]);
    expect(out.recap?.id).toBe('r2');
    expect(out.quests.map(h => h.id)).toEqual(['d']);
    expect(out.rest.map(h => h.id)).toEqual(['r1', 'h']);
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
