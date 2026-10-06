/**
 * Tests for the "AI changes" window's pure model (I-108): the row model (time,
 * state text, the Undo button), the HTML, and the escaping of backend strings.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  FIRST_PAGE_LIMIT,
  MORE_LIMIT,
  buildChangeRow,
  buildRows,
  canShowMore,
  escapeHtml,
  formatLocalTime,
  parseChanges,
  renderChangesHtml,
  renderUndoConfirmHtml,
  type AiChange,
  type ChangesView,
} from './ai-changes-model.js';

const g = globalThis as any;

function change(over: Partial<AiChange> = {}): AiChange {
  return {
    changeId: 'c1',
    feature: 'live-play',
    summary: 'Ireena: 5 damage',
    mode: 'apply',
    appliedAt: new Date(2026, 9, 6, 9, 5, 30).toISOString(),
    risk: 'write',
    diff: ['Ireena hp 20 -> 15'],
    canUndo: true,
    ...over,
  };
}

function view(over: Partial<ChangesView> = {}): ChangesView {
  return {
    status: 'ready',
    rows: [],
    error: '',
    limit: FIRST_PAGE_LIMIT,
    busyId: null,
    openIds: new Set(),
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

describe('buildChangeRow', () => {
  it('builds a plain applied row with an Undo button', () => {
    expect(buildChangeRow(change())).toEqual({
      id: 'c1',
      time: '09:05',
      summary: 'Ireena: 5 damage',
      feature: 'live play',
      isUndo: false,
      state: '',
      diff: ['Ireena hp 20 -> 15'],
      canUndo: true,
    });
  });

  it('marks a change that was undone and takes its Undo button away', () => {
    const row = buildChangeRow(change({ undoneBy: 'c2', canUndo: true }));
    expect(row.state).toBe('undone');
    expect(row.canUndo).toBe(false);
  });

  it('shows an undo entry as "Undo of ..." without a second Undo', () => {
    const row = buildChangeRow(
      change({ mode: 'undo', summary: 'Undo: Ireena: 5 damage', canUndo: true })
    );
    expect(row.summary).toBe('Undo of Ireena: 5 damage');
    expect(row.isUndo).toBe(true);
    expect(row.canUndo).toBe(false);
  });

  it('keeps Undo off when the backend says the change can no longer be undone', () => {
    expect(buildChangeRow(change({ canUndo: false })).canUndo).toBe(false);
  });
});

describe('parseChanges / buildRows', () => {
  it('keeps the backend order and drops malformed entries', () => {
    const rows = buildRows({
      changes: [
        { changeId: 'new', summary: 'B', mode: 'apply', canUndo: true, diff: ['x', 3] },
        null,
        { summary: 'no id' },
        { changeId: 'old', summary: 'A', mode: 'undo', undoOf: 'new' },
      ],
    });
    expect(rows.map(r => r.id)).toEqual(['new', 'old']);
    expect(rows[0]?.diff).toEqual(['x']);
    expect(rows[1]?.isUndo).toBe(true);
  });

  it('gives an empty list for anything else', () => {
    expect(parseChanges(undefined)).toEqual([]);
    expect(parseChanges({ changes: 'nope' })).toEqual([]);
    expect(buildRows(null)).toEqual([]);
  });
});

describe('canShowMore', () => {
  it('is offered only when the first page came back full', () => {
    const full = Array.from({ length: 20 }, (_, i) =>
      buildChangeRow(change({ changeId: `c${i}` }))
    );
    expect(canShowMore({ limit: FIRST_PAGE_LIMIT, rows: full })).toBe(true);
    expect(canShowMore({ limit: FIRST_PAGE_LIMIT, rows: full.slice(0, 5) })).toBe(false);
    expect(canShowMore({ limit: MORE_LIMIT, rows: full })).toBe(false);
  });
});

describe('renderChangesHtml', () => {
  it('shows the loading, empty and error lines', () => {
    expect(renderChangesHtml(view({ status: 'loading' }))).toContain('Loading the changes');
    expect(renderChangesHtml(view())).toContain('No AI changes yet.');
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

  it('draws a row with time, summary, tag, collapsed diff and an Undo button', () => {
    const html = renderChangesHtml(view({ rows: [buildChangeRow(change())] }));
    expect(html).toContain('<span class="fmb-ai-time">09:05</span>');
    expect(html).toContain('<span class="fmb-ai-summary">Ireena: 5 damage</span>');
    expect(html).toContain('<span class="fmb-ai-tag">live play</span>');
    expect(html).toContain('<summary>Changes (1)</summary>');
    expect(html).toContain('<li>Ireena hp 20 -&gt; 15</li>');
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html).toContain('data-action="undo" data-change-id="c1"');
  });

  it('opens the diffs the viewer had open, and disables Undo while one runs', () => {
    const html = renderChangesHtml(
      view({ rows: [buildChangeRow(change())], openIds: new Set(['c1']), busyId: 'c1' })
    );
    expect(html).toMatch(/<details[^>]* open>/);
    expect(html).toMatch(/data-action="undo"[^>]* disabled/);
  });

  it('shows "undone" and no Undo button for an undone change', () => {
    const html = renderChangesHtml(view({ rows: [buildChangeRow(change({ undoneBy: 'c2' }))] }));
    expect(html).toContain('<span class="fmb-ai-state">undone</span>');
    expect(html).not.toContain('data-action="undo"');
    expect(html).toContain('fmb-ai-undone');
  });

  it('offers Show more only on a full first page', () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      buildChangeRow(change({ changeId: `c${i}` }))
    );
    expect(renderChangesHtml(view({ rows }))).toContain('data-action="more"');
    expect(renderChangesHtml(view({ rows, limit: MORE_LIMIT }))).not.toContain(
      'data-action="more"'
    );
  });

  it('escapes every string that comes from the backend', () => {
    const evil = '<script>alert(1)</script>';
    const html = renderChangesHtml(
      view({
        rows: [
          buildChangeRow(
            change({
              changeId: `"><img src=x onerror=alert(1)>`,
              summary: evil,
              feature: evil,
              diff: [evil],
            })
          ),
        ],
      })
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(renderChangesHtml(view({ status: 'error', error: evil }))).not.toContain('<script>');
  });
});

describe('renderUndoConfirmHtml', () => {
  it('names the change and lists its diff lines, escaped', () => {
    const html = renderUndoConfirmHtml(
      buildChangeRow(change({ summary: 'A <b>bold</b> move', diff: ['x -> <i>y</i>'] }))
    );
    expect(html).toContain('A &lt;b&gt;bold&lt;/b&gt; move');
    expect(html).toContain('<li>x -&gt; &lt;i&gt;y&lt;/i&gt;</li>');
    expect(html).not.toContain('<b>');
  });
});
