/**
 * Tests for the "Changes" window's pure model (I-108, I-109 part 4): reading both list shapes,
 * the row model (who, state text, Undo and Redo), the filter, the HTML and the escaping of
 * backend strings.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  FIRST_PAGE_LIMIT,
  MORE_LIMIT,
  buildChangeRow,
  buildRows,
  canShowMore,
  escapeHtml,
  filterArgs,
  formatLocalTime,
  parseChanges,
  parseNote,
  renderChangesHtml,
  userFilter,
  validFilter,
  type ChangeEntry,
  type ChangesView,
} from './ai-changes-model.js';

const g = globalThis as any;

function entry(over: Partial<ChangeEntry> = {}): ChangeEntry {
  return {
    id: 'c1',
    kind: 'ai',
    at: new Date(2026, 9, 6, 9, 5, 30).toISOString(),
    by: 'AI',
    userId: '',
    summary: 'Ireena: 5 damage',
    lines: ['Ireena hp 20 -> 15'],
    feature: 'live-play',
    mode: 'apply',
    requestedBy: '',
    thing: '',
    canUndo: true,
    undone: false,
    undoneBy: '',
    ...over,
  };
}

/** A `list-changes` item of a person's action. */
function humanItem(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'human',
    id: 'act:a1',
    at: new Date(2026, 9, 6, 9, 5).toISOString(),
    by: 'Ireena',
    userId: 'u-ireena',
    isGM: false,
    summary: 'Ireena: HP 10 -> 5',
    lines: ['Ireena: HP 10 -> 5'],
    things: [{ uuid: 'Actor.a', name: 'Ireena' }],
    records: 1,
    canUndo: true,
    undone: false,
    ...over,
  };
}

/** A `list-changes` item of an AI change. */
function aiItem(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'ai',
    id: 'chg-1',
    at: new Date(2026, 9, 6, 9, 10).toISOString(),
    by: 'AI',
    summary: 'Wolf: 4 damage',
    lines: ['Wolf hp 11 -> 7'],
    mode: 'apply',
    feature: 'live-play',
    canUndo: true,
    undone: false,
    ...over,
  };
}

function view(over: Partial<ChangesView> = {}): ChangesView {
  return {
    status: 'ready',
    rows: [],
    error: '',
    note: '',
    limit: FIRST_PAGE_LIMIT,
    busyId: null,
    openIds: new Set(),
    filter: 'all',
    users: [],
    legacy: false,
    ...over,
  };
}

afterEach(() => {
  delete g.foundry;
});

describe('escapeHtml', () => {
  it('escapes the five HTML characters (own fallback)', () => {
    expect(escapeHtml(`<img src=x onerror="a('b')">&`)).toBe(
      '&lt;img src=x onerror=&quot;a(&#x27;b&#x27;)&quot;&gt;&amp;'
    );
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(42)).toBe('42');
  });

  it("uses Foundry's helper when it exists", () => {
    g.foundry = { utils: { escapeHTML: (v: string): string => `[${v}]` } };
    expect(escapeHtml('a<b')).toBe('[a<b]');
  });
});

describe('formatLocalTime', () => {
  it('formats local HH:MM with a leading zero', () => {
    expect(formatLocalTime(new Date(2026, 9, 6, 9, 5).toISOString())).toBe('09:05');
    expect(formatLocalTime(new Date(2026, 9, 6, 23, 45).toISOString())).toBe('23:45');
  });

  it('shows --:-- for a missing or invalid time', () => {
    expect(formatLocalTime('')).toBe('--:--');
    expect(formatLocalTime('not a date')).toBe('--:--');
  });
});

describe('the filter', () => {
  it('turns the Show choice into list-changes arguments (person = user id, AI = source ai)', () => {
    expect(filterArgs('all', 20)).toEqual({ limit: 20 });
    expect(filterArgs('ai', 100)).toEqual({ limit: 100, source: 'ai' });
    expect(filterArgs(userFilter('u1'), 20)).toEqual({ limit: 20, person: 'u1' });
    expect(filterArgs('user:', 20)).toEqual({ limit: 20 });
    expect(filterArgs('nonsense', 20)).toEqual({ limit: 20 });
  });

  it('falls back to All for a person who is not in the list', () => {
    const users = [{ id: 'u1', name: 'Danni' }];
    expect(validFilter('ai', users)).toBe('ai');
    expect(validFilter('user:u1', users)).toBe('user:u1');
    expect(validFilter('user:gone', users)).toBe('all');
    expect(validFilter('whatever', users)).toBe('all');
  });
});

describe('parseChanges', () => {
  it('reads a list-changes result: people and the AI, in the backend order', () => {
    const list = parseChanges({
      changes: [humanItem(), aiItem({ requestedBy: 'Danni' }), null, { summary: 'no id' }],
    });
    expect(list.map(e => e.id)).toEqual(['act:a1', 'chg-1']);
    expect(list[0]).toMatchObject({
      kind: 'human',
      by: 'Ireena',
      userId: 'u-ireena',
      thing: 'Ireena',
      lines: ['Ireena: HP 10 -> 5'],
      canUndo: true,
      undone: false,
    });
    expect(list[1]).toMatchObject({ kind: 'ai', by: 'AI', requestedBy: 'Danni', mode: 'apply' });
  });

  it('reads the AI-only list of an older bridge (changeId, diff, appliedAt)', () => {
    const [a, b] = parseChanges({
      changes: [
        { changeId: 'new', summary: 'B', mode: 'apply', canUndo: true, diff: ['x', 3] },
        { changeId: 'old', summary: 'A', mode: 'undo', undoneBy: 'x', requestedBy: 42 },
      ],
    });
    expect(a).toMatchObject({ id: 'new', kind: 'ai', by: 'AI', lines: ['x'], undone: false });
    expect(b).toMatchObject({ id: 'old', mode: 'undo', undone: true, requestedBy: '' });
  });

  it('gives an empty list for anything else, and reads the backend note', () => {
    expect(parseChanges(undefined)).toEqual([]);
    expect(parseChanges({ changes: 'nope' })).toEqual([]);
    expect(buildRows(null)).toEqual([]);
    expect(parseNote({ changes: [], note: 'The history is off.' })).toBe('The history is off.');
    expect(parseNote({ note: 5 })).toBe('');
    expect(parseNote(null)).toBe('');
  });
});

describe('buildChangeRow', () => {
  it('builds a plain AI row with an Undo button', () => {
    expect(buildChangeRow(entry())).toEqual({
      id: 'c1',
      time: '09:05',
      at: entry().at,
      summary: 'Ireena: 5 damage',
      feature: 'live play',
      isUndo: false,
      isAi: true,
      who: 'AI',
      requestedBy: '',
      thing: '',
      state: '',
      undoneByWho: '',
      diff: ['Ireena hp 20 -> 15'],
      canUndo: true,
      redoId: '',
    });
  });

  it("builds a person's row: their name, no feature tag", () => {
    const [row] = buildRows({ changes: [humanItem()] });
    expect(row).toMatchObject({
      isAi: false,
      who: 'Ireena',
      feature: '',
      thing: 'Ireena',
      canUndo: true,
    });
  });

  it('marks a change that was undone, takes Undo away and names who undid it', () => {
    const rows = buildRows({
      changes: [
        aiItem({ id: 'u1', mode: 'undo', summary: 'Undo: Wolf: 4 damage', requestedBy: 'Danni' }),
        humanItem({ undone: true, undoneBy: 'u1', canUndo: true }),
      ],
    });
    expect(rows[1]).toMatchObject({ state: 'undone', canUndo: false, undoneByWho: 'Danni' });
  });

  it('offers Redo on an undone change when the undo entry is itself live and undoable', () => {
    const changes = (undoer: Record<string, unknown>): unknown => ({
      changes: [
        aiItem({ id: 'u1', mode: 'undo', summary: 'Undo: x', ...undoer }),
        humanItem({ undone: true, undoneBy: 'u1' }),
      ],
    });
    expect(buildRows(changes({ canUndo: true }))[1]?.redoId).toBe('u1');
    // The undo cannot be undone, or was itself undone (the change is back), or is not in the list.
    expect(buildRows(changes({ canUndo: false }))[1]?.redoId).toBe('');
    expect(buildRows(changes({ canUndo: true, undone: true }))[1]?.redoId).toBe('');
    expect(buildRows({ changes: [humanItem({ undone: true, undoneBy: 'gone' })] })[0]?.redoId).toBe(
      ''
    );
    // Never on an older bridge, which has no redo flow.
    expect(buildRows(changes({ canUndo: true }), { legacy: true })[1]?.redoId).toBe('');
  });

  it('shows an undo entry as "Undo of ..." without a second Undo', () => {
    const row = buildChangeRow(
      entry({ mode: 'undo', summary: 'Undo: Ireena: 5 damage', canUndo: true })
    );
    expect(row.summary).toBe('Undo of Ireena: 5 damage');
    expect(row.isUndo).toBe(true);
    expect(row.canUndo).toBe(false);
  });

  it('keeps Undo off when the backend says the change can no longer be undone', () => {
    expect(buildChangeRow(entry({ canUndo: false })).canUndo).toBe(false);
  });
});

describe('canShowMore', () => {
  it('is offered only when the first page came back full', () => {
    const rows = (n: number): ChangesView['rows'] =>
      Array.from({ length: n }, (_, i) => buildChangeRow(entry({ id: `c${i}` })));
    expect(canShowMore({ limit: FIRST_PAGE_LIMIT, rows: rows(20) })).toBe(true);
    expect(canShowMore({ limit: FIRST_PAGE_LIMIT, rows: rows(19) })).toBe(false);
    expect(canShowMore({ limit: MORE_LIMIT, rows: rows(100) })).toBe(false);
  });
});

describe('renderChangesHtml', () => {
  const ui = (...items: Array<Record<string, unknown>>): ChangesView['rows'] =>
    buildRows({ changes: items });

  it('shows the loading, empty and error lines', () => {
    expect(renderChangesHtml(view({ status: 'loading' }))).toContain('Loading the changes');
    expect(renderChangesHtml(view())).toContain('No changes yet.');
    expect(renderChangesHtml(view({ filter: 'ai' }))).toContain('No changes match this filter.');
    expect(renderChangesHtml(view({ legacy: true }))).toContain('No AI changes yet.');
    const html = renderChangesHtml(
      view({
        status: 'error',
        error: 'The AI Tool bridge is not connected. Is the Assistant GM browser running?',
      })
    );
    expect(html).toContain('fmb-ai-error');
    expect(html).toContain('The AI Tool bridge is not connected.');
    expect(html).not.toContain('<ol');
  });

  it("shows the backend's note about the list", () => {
    const html = renderChangesHtml(view({ note: 'The change history is switched off.' }));
    expect(html).toContain('The change history is switched off.');
  });

  it('has a Show filter with All, AI and each user, and marks the current choice', () => {
    const users = [
      { id: 'u1', name: 'Danni' },
      { id: 'u2', name: '<b>Evil</b>' },
    ];
    const html = renderChangesHtml(view({ users, filter: 'user:u1' }));
    expect(html).toContain('Show:');
    expect(html).toContain('<option value="all">All</option>');
    expect(html).toContain('<option value="ai">AI</option>');
    expect(html).toContain('<option value="user:u1" selected>Danni</option>');
    expect(html).toContain('&lt;b&gt;Evil&lt;/b&gt;');
    expect(html).not.toContain('<b>');
  });

  it('has no filter on an older bridge', () => {
    expect(renderChangesHtml(view({ legacy: true }))).not.toContain('data-fmb-filter');
  });

  it('draws an AI row with time, summary, tags, collapsed diff and an Undo button', () => {
    const html = renderChangesHtml(view({ rows: ui(aiItem()) }));
    expect(html).toContain('<span class="fmb-ai-time">09:10</span>');
    expect(html).toContain('<span class="fmb-ai-summary">Wolf: 4 damage</span>');
    expect(html).toContain('<span class="fmb-ai-tag">AI</span>');
    expect(html).toContain('<span class="fmb-ai-tag">live play</span>');
    expect(html).toContain('<summary>Changes (1)</summary>');
    expect(html).toContain('<li>Wolf hp 11 -&gt; 7</li>');
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html).toContain('data-action="undo" data-change-id="chg-1"');
  });

  it("draws a person's row as by NAME", () => {
    const html = renderChangesHtml(view({ rows: ui(humanItem()) }));
    expect(html).toContain('<span class="fmb-ai-tag">by Ireena</span>');
    expect(html).not.toContain('<span class="fmb-ai-tag">AI</span>');
    expect(html).toContain('data-change-id="act:a1"');
  });

  it('shows who asked next to the AI tag, escaped, and nothing when Claude or the dashboard did', () => {
    const plain = renderChangesHtml(view({ rows: ui(aiItem()) }));
    expect(plain).not.toContain('by ');
    const html = renderChangesHtml(
      view({
        rows: ui(
          aiItem({ requestedBy: 'Danni' }),
          aiItem({ id: 'c2', requestedBy: '<img src=x onerror=1>' })
        ),
      })
    );
    expect(html).toContain('<span class="fmb-ai-tag">by Danni</span>');
    expect(html).not.toContain('<img');
    expect(html).toContain('by &lt;img');
  });

  it('opens the diffs the viewer had open, and disables the buttons while one flow runs', () => {
    const html = renderChangesHtml(
      view({ rows: ui(aiItem()), openIds: new Set(['chg-1']), busyId: 'chg-1' })
    );
    expect(html).toMatch(/<details[^>]* open>/);
    expect(html).toMatch(/data-action="undo"[^>]* disabled/);
  });

  it('shows "undone by NAME" with a Redo button that names the undo entry', () => {
    const rows = ui(
      aiItem({ id: 'u1', mode: 'undo', summary: 'Undo: x', requestedBy: 'Danni' }),
      humanItem({ undone: true, undoneBy: 'u1' })
    );
    const html = renderChangesHtml(view({ rows }));
    expect(html).toContain('<span class="fmb-ai-state">undone by Danni</span>');
    expect(html).toContain('data-action="redo" data-change-id="u1"');
    expect(html).toContain('fmb-ai-undone');
  });

  it('shows plain "undone" and no button when nothing can bring it back', () => {
    const html = renderChangesHtml(
      view({ rows: ui(humanItem({ undone: true, undoneBy: 'gone', canUndo: false })) })
    );
    expect(html).toContain('<span class="fmb-ai-state">undone</span>');
    expect(html).not.toContain('data-action="undo"');
    expect(html).not.toContain('data-action="redo"');
  });

  it('offers Show more only on a full first page', () => {
    const rows = Array.from({ length: 20 }, (_, i) => buildChangeRow(entry({ id: `c${i}` })));
    expect(renderChangesHtml(view({ rows }))).toContain('data-action="more"');
    expect(renderChangesHtml(view({ rows, limit: MORE_LIMIT }))).not.toContain(
      'data-action="more"'
    );
  });

  it('escapes every string that comes from the backend', () => {
    const evil = '<script>alert(1)</script>';
    const html = renderChangesHtml(
      view({
        rows: ui(
          humanItem({
            id: `"><img src=x onerror=alert(1)>`,
            summary: evil,
            by: evil,
            lines: [evil],
          })
        ),
      })
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(renderChangesHtml(view({ status: 'error', error: evil }))).not.toContain('<script>');
    expect(renderChangesHtml(view({ note: evil }))).not.toContain('<script>');
  });
});
