/**
 * Tests for the "Handouts" window's pure model (I-108 part 2): the queue rows, the
 * next page rule, the read receipts, the plan parsing and the escaping.
 */
import { describe, expect, it } from 'vitest';
import {
  buildHandoutsRows,
  findNext,
  parseHandouts,
  parseRevealPlan,
  renderHandoutsHtml,
  renderRevealConfirmHtml,
  type HandoutsContext,
  type HandoutsView,
} from './handouts-model.js';

const names: Record<string, string> = { u1: 'Danni', u2: 'Chris', u3: 'Eva' };
const scenes: Record<string, string> = { s1: 'Village', s2: 'Castle' };

function ctx(over: Partial<HandoutsContext> = {}): HandoutsContext {
  return {
    activeSceneId: 's1',
    sceneName: id => scenes[id] ?? null,
    playerName: id => names[id] ?? null,
    playerIds: ['u1', 'u2'],
    ...over,
  };
}

function queued(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    entryId: `e-${id}`,
    uuid: `JournalEntry.AAAAAAAAAAAAAAAA.JournalEntryPage.${id}`,
    title: `Page ${id}`,
    exists: true,
    sceneId: null,
    addedAt: '2026-10-06T08:00:00.000Z',
    ...over,
  };
}

function revealed(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pageId: id,
    uuid: `JournalEntry.AAAAAAAAAAAAAAAA.JournalEntryPage.${id}`,
    title: `Page ${id}`,
    exists: true,
    observable: true,
    feature: 'handouts',
    revealedAt: '2026-10-06T08:00:00.000Z',
    seenBy: [],
    ...over,
  };
}

function view(over: Partial<HandoutsView> = {}): HandoutsView {
  return {
    status: 'ready',
    error: '',
    actionError: '',
    queue: [],
    revealed: [],
    nextTitle: null,
    busy: false,
    showNow: false,
    ...over,
  };
}

describe('parseHandouts', () => {
  it('drops malformed entries and tolerates a missing or odd result', () => {
    expect(parseHandouts(undefined)).toEqual({ queue: [], pages: [] });
    expect(parseHandouts({ queue: 'x', pages: {} })).toEqual({ queue: [], pages: [] });
    const { queue, pages } = parseHandouts({
      queue: [queued('a'), { entryId: '', uuid: 'u' }, null, 7, { entryId: 'e', uuid: '' }],
      pages: [revealed('p'), { uuid: '' }, null],
    });
    expect(queue.map(q => q.entryId)).toEqual(['e-a']);
    expect(pages).toHaveLength(1);
  });
});

describe('findNext', () => {
  const queue = parseHandouts({
    queue: [queued('a', { sceneId: 's2' }), queued('b', { sceneId: 's1' }), queued('c')],
  }).queue;

  it('takes the oldest for the active scene or for any scene', () => {
    expect(findNext(queue, 's1')?.entryId).toBe('e-b');
    expect(findNext(queue, 's3')?.entryId).toBe('e-c');
  });

  it('takes the oldest of all when there is no active scene', () => {
    expect(findNext(queue, null)?.entryId).toBe('e-a');
  });

  it('is null when nothing fits', () => {
    expect(findNext(queue.slice(0, 1), 's1')).toBeNull();
    expect(findNext([], 's1')).toBeNull();
  });
});

describe('buildHandoutsRows', () => {
  it('names the scene and the players, marks the next page, keeps the order', () => {
    const result = {
      queue: [
        queued('a', { sceneId: 's2', players: ['u1'] }),
        queued('b', { sceneId: 's1', players: ['u1', 'u9'] }),
        queued('c', { title: '', sceneId: 'gone' }),
      ],
      pages: [],
    };
    const rows = buildHandoutsRows(result, ctx());
    expect(rows.queue.map(q => [q.title, q.sceneText, q.audienceText, q.isNext])).toEqual([
      ['Page a', 'Castle', 'for Danni', false],
      ['Page b', 'Village', 'for Danni, u9', true],
      ['Untitled', 'another scene', 'for all players', false],
    ]);
    expect(rows.nextTitle).toBe('Page b');
  });

  it('says "any scene" for a page without a scene, and has no next page when none fits', () => {
    const rows = buildHandoutsRows({ queue: [queued('a', { sceneId: 's2' })] }, ctx());
    expect(rows.nextTitle).toBeNull();
    expect(buildHandoutsRows({ queue: [queued('a')] }, ctx()).queue[0]?.sceneText).toBe(
      'any scene'
    );
  });

  it('lists revealed handouts and their copies with who opened each, for the chosen players or all', () => {
    const rows = buildHandoutsRows(
      {
        pages: [
          revealed('a', {
            seenBy: [
              { userId: 'u1', name: 'Danni', at: new Date(2026, 9, 6, 20, 15).toISOString() },
            ],
          }),
          revealed('b', {
            feature: 'tarokka',
            copiedFrom: 'JournalEntry.X.JournalEntryPage.Y',
            players: ['u2'],
          }),
          revealed('c', { feature: 'tarokka' }), // not a handout: left out, like the dashboard
          revealed('d', { exists: false, observable: false, title: 'gone' }),
        ],
      },
      ctx()
    );
    expect(rows.revealed.map(r => r.title)).toEqual(['Page a', 'Page b', '(page deleted)']);
    expect(rows.revealed[0]?.audienceText).toBe('for all players');
    expect(rows.revealed[0]?.ticks).toEqual([
      { name: 'Danni', seen: true, time: '20:15' },
      { name: 'Chris', seen: false, time: '' },
    ]);
    expect(rows.revealed[1]?.ticks).toEqual([{ name: 'Chris', seen: false, time: '' }]);
    expect(rows.revealed[2]?.observable).toBe(false);
  });
});

describe('parseRevealPlan', () => {
  it('reads the plan id, summary, note and diff lines (objects or strings)', () => {
    expect(
      parseRevealPlan({
        planId: 'p1',
        summary: 'Reveal page "Letter" to all players',
        note: 'Copied into Handouts',
        diff: [{ text: 'adds the page to the allowlist' }, 'raise ownership', { text: '' }, 5],
      })
    ).toEqual({
      planId: 'p1',
      summary: 'Reveal page "Letter" to all players',
      diff: ['adds the page to the allowlist', 'raise ownership'],
      note: 'Copied into Handouts',
    });
  });

  it('is null for a result that carries no plan', () => {
    expect(parseRevealPlan({ note: 'removed' })).toBeNull();
    expect(parseRevealPlan({ planId: '' })).toBeNull();
    expect(parseRevealPlan(null)).toBeNull();
  });
});

describe('renderHandoutsHtml', () => {
  it('has Reveal next with an unticked Show it now, a Remove per row and no per-row Reveal', () => {
    const rows = buildHandoutsRows({ queue: [queued('a'), queued('b')] }, ctx());
    const html = renderHandoutsHtml(view({ ...rows }));
    expect(html).toContain('data-action="reveal"');
    expect(html).toContain('Reveal next: Page a');
    expect(html).toContain('<input type="checkbox" data-field="showNow">');
    expect(html).not.toMatch(/checked/);
    expect(html.match(/data-action="remove"/g)).toHaveLength(2);
    expect(html.match(/data-action="reveal"/g)).toHaveLength(1);
    expect(html).toContain('data-action="refresh"');
  });

  it('ticks Show it now only when the view says so (a redraw keeps the choice)', () => {
    const rows = buildHandoutsRows({ queue: [queued('a')] }, ctx());
    expect(renderHandoutsHtml(view({ ...rows, showNow: true }))).toContain(
      '<input type="checkbox" data-field="showNow" checked>'
    );
  });

  it('disables Reveal next when nothing is queued for the scene, and every button while busy', () => {
    expect(renderHandoutsHtml(view())).toMatch(/data-action="reveal" disabled/);
    const rows = buildHandoutsRows({ queue: [queued('a')] }, ctx());
    const busy = renderHandoutsHtml(view({ ...rows, busy: true }));
    expect(busy).toMatch(/data-action="reveal" disabled/);
    expect(busy).toMatch(/data-action="remove"[^>]*disabled/);
  });

  it('says what is empty, shows errors, and shows read receipts', () => {
    expect(renderHandoutsHtml(view())).toContain('Nothing queued.');
    expect(renderHandoutsHtml(view())).toContain('No handout revealed yet.');
    expect(renderHandoutsHtml(view({ status: 'error', error: 'not connected' }))).toContain(
      'role="alert">not connected'
    );
    expect(renderHandoutsHtml(view({ actionError: 'Could not reveal' }))).toContain(
      'Could not reveal'
    );
    const rows = buildHandoutsRows(
      { pages: [revealed('a', { seenBy: [{ userId: 'u1', at: new Date().toISOString() }] })] },
      ctx()
    );
    const html = renderHandoutsHtml(view({ ...rows }));
    expect(html).toContain('fmb-ho-seen');
    expect(html).toContain('Danni');
    expect(html).toContain('Chris');
  });

  it('escapes every string that comes from the backend', () => {
    const rows = buildHandoutsRows(
      {
        queue: [
          queued('a', { title: '<img src=x onerror=alert(1)>', sceneId: 'sx', players: ['"><b>'] }),
        ],
        pages: [revealed('p', { title: '<script>x</script>' })],
      },
      ctx({ sceneName: () => '<i>scene</i>' })
    );
    const html = renderHandoutsHtml(
      view({ ...rows, error: '<u>e</u>', actionError: '<s>a</s>', status: 'error' })
    );
    for (const raw of ['<img', '<script>', '<i>scene', '<u>e', '<s>a', '"><b>']) {
      expect(html).not.toContain(raw);
    }
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('renderRevealConfirmHtml', () => {
  it('shows the escaped summary, note and diff lines', () => {
    const html = renderRevealConfirmHtml({
      planId: 'p1',
      summary: 'Reveal "<b>Letter</b>"',
      diff: ['<i>raises ownership</i>', 'Show it now: Danni'],
      note: 'Copied & kept',
    });
    expect(html).toContain('Reveal &quot;&lt;b&gt;Letter&lt;/b&gt;&quot;');
    expect(html).toContain('&lt;i&gt;raises ownership&lt;/i&gt;');
    expect(html).toContain('Show it now: Danni');
    expect(html).toContain('Copied &amp; kept');
    expect(html).not.toContain('<b>Letter');
  });
});
