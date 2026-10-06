/**
 * Tests for the "Tarokka" window's pure model (I-108 part 3): the reading, the veil
 * over the cards and notes, the links, the reveal forms and the escaping. The card
 * names and texts are made up.
 */
import { describe, expect, it } from 'vitest';
import {
  checkRevealForm,
  emptyForm,
  formatReadAt,
  parseReading,
  renderTarokkaConfirmHtml,
  renderTarokkaHtml,
  type TarokkaView,
} from './tarokka-model.js';

function position(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    position: id,
    label: `Slot ${id}`,
    deck: 'common',
    cardId: `card-${id}`,
    cardName: `Test card ${id}`,
    gmNote: null,
    links: {},
    linked: false,
    revealed: false,
    revealPageUuid: null,
    ...over,
  };
}

function result(positions: unknown[], over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    available: true,
    reading: {
      readingId: 'r1',
      source: 'builtin-roll',
      readAt: '2026-10-06T19:30:00.000Z',
      providerVersion: null,
      positions,
    },
    archivedReadings: 2,
    revealJournalUuid: null,
    note: '',
    ...over,
  };
}

function view(over: Partial<TarokkaView> = {}): TarokkaView {
  return {
    status: 'ready',
    error: '',
    actionError: '',
    reading: parseReading(result([position('a'), position('b')])),
    showCards: false,
    forms: {},
    busy: false,
    ...over,
  };
}

describe('parseReading', () => {
  it('reads the source, the time, the archive count and the positions', () => {
    const reading = parseReading(result([position('a')]));
    expect(reading).toMatchObject({
      source: 'builtin-roll',
      readAt: '2026-10-06T19:30:00.000Z',
      archived: 2,
    });
    expect(reading?.positions).toEqual([
      {
        position: 'a',
        label: 'Slot a',
        cardId: 'card-a',
        cardName: 'Test card a',
        gmNote: '',
        links: [],
        revealed: false,
        revealPageUuid: null,
      },
    ]);
  });

  it('is null when no reading is available or the result is odd', () => {
    expect(parseReading({ available: false, archivedReadings: 0, note: 'none' })).toBeNull();
    expect(parseReading({ available: true })).toBeNull();
    expect(parseReading(null)).toBeNull();
    expect(parseReading('x')).toBeNull();
  });

  it('keeps the links in a fixed order with the dashboard labels and drops anything else', () => {
    const reading = parseReading(
      result([
        position('a', {
          links: {
            actorUuid: 'Actor.A',
            journalPageUuid: 'JournalEntry.J.JournalEntryPage.P',
            sceneUuid: '',
            mystery: 'X',
          },
        }),
      ])
    );
    expect(reading?.positions[0]?.links).toEqual([
      { label: 'Journal', uuid: 'JournalEntry.J.JournalEntryPage.P' },
      { label: 'Actor', uuid: 'Actor.A' },
    ]);
  });

  it('drops positions without an id and tolerates a bad archive count', () => {
    const reading = parseReading(
      result([position('a'), { label: 'no id' }, null], { archivedReadings: -3 })
    );
    expect(reading?.positions.map(p => p.position)).toEqual(['a']);
    expect(reading?.archived).toBe(0);
  });
});

describe('formatReadAt', () => {
  it('formats a date and keeps text that is not one', () => {
    expect(formatReadAt('2026-10-06T19:30:00.000Z')).not.toBe('2026-10-06T19:30:00.000Z');
    expect(formatReadAt('some day')).toBe('some day');
  });
});

describe('checkRevealForm', () => {
  it('needs text, trims it, and drops an empty title', () => {
    expect(checkRevealForm(emptyForm())).toMatchObject({ ok: false });
    expect(checkRevealForm({ text: '   ', title: '', showNow: false })).toMatchObject({
      ok: false,
    });
    expect(checkRevealForm({ text: '  Words  ', title: '  ', showNow: true })).toEqual({
      ok: true,
      text: 'Words',
      title: '',
    });
  });

  it('refuses text over 5000 characters and a title over 120', () => {
    expect(checkRevealForm({ text: 'x'.repeat(5000), title: '', showNow: false }).ok).toBe(true);
    expect(checkRevealForm({ text: 'x'.repeat(5001), title: '', showNow: false })).toMatchObject({
      ok: false,
      error: expect.stringContaining('5000'),
    });
    expect(checkRevealForm({ text: 'x', title: 't'.repeat(121), showNow: false })).toMatchObject({
      ok: false,
      error: expect.stringContaining('120'),
    });
  });
});

describe('renderTarokkaHtml', () => {
  it('veils the card names and ids and shows no note while Show cards is unticked', () => {
    const reading = parseReading(result([position('a', { gmNote: 'Secret note' })]));
    const html = renderTarokkaHtml(view({ reading }));
    expect(html).toContain('Slot a');
    expect(html).toContain('fmb-tk-veiled');
    expect(html).not.toContain('Test card a');
    expect(html).not.toContain('card-a');
    expect(html).not.toContain('Secret note');
    expect(html).toContain('<input type="checkbox" data-field="showCards"> Show cards');
  });

  it('shows the card, its id and the GM note when Show cards is ticked (a note only when there is one)', () => {
    const reading = parseReading(result([position('a', { gmNote: 'Secret note' }), position('b')]));
    const html = renderTarokkaHtml(view({ reading, showCards: true }));
    expect(html).toContain('Test card a <code>card-a</code>');
    expect(html).toContain('Secret note');
    expect(html.match(/fmb-tk-note/g)).toHaveLength(1);
    expect(html).toContain('data-field="showCards" checked');
    expect(html).not.toContain('fmb-tk-veiled');
  });

  it('shows the header: GM only, source, read time and the archive count', () => {
    const html = renderTarokkaHtml(view());
    expect(html).toContain('GM only');
    expect(html).toContain('builtin-roll');
    expect(html).toContain(formatReadAt('2026-10-06T19:30:00.000Z'));
    expect(html).toContain('2 archived');
  });

  it('says there is no reading yet and where one comes from', () => {
    const html = renderTarokkaHtml(view({ reading: null }));
    expect(html).toContain('No reading yet');
    expect(html).toContain('dashboard');
    expect(html).toContain('Claude');
    expect(html).not.toContain('<ul class="fmb-ai-list">');
  });

  it('shows Open buttons for links, or "not linked"', () => {
    const reading = parseReading(
      result([
        position('a', {
          links: { journalPageUuid: 'JournalEntry.J.JournalEntryPage.P', sceneUuid: 'Scene.S' },
        }),
        position('b'),
      ])
    );
    const html = renderTarokkaHtml(view({ reading }));
    expect(html).toContain(
      'data-action="openDoc" data-uuid="JournalEntry.J.JournalEntryPage.P">Open Journal'
    );
    expect(html).toContain('data-uuid="Scene.S">Open Scene');
    expect(html.match(/not linked/g)).toHaveLength(1);
  });

  it('shows revealed with Open page, or hidden from players, and Reveal... only for unrevealed positions', () => {
    const reading = parseReading(
      result([
        position('a', { revealed: true, revealPageUuid: 'JournalEntry.R.JournalEntryPage.Q' }),
        position('b', { revealed: true }),
        position('c'),
      ])
    );
    const html = renderTarokkaHtml(view({ reading }));
    expect(html.match(/>revealed</g)).toHaveLength(2);
    expect(html).toContain('data-uuid="JournalEntry.R.JournalEntryPage.Q">Open page');
    expect(html.match(/Open page/g)).toHaveLength(1);
    expect(html.match(/hidden from players/g)).toHaveLength(1);
    expect(html.match(/data-action="revealOpen"/g)).toHaveLength(1);
    expect(html).toContain('data-action="revealOpen" data-position="c"');
  });

  it('draws an open form with the typed text, the title and the Show it now tick (unticked unless set)', () => {
    const form = { text: 'Line one\n<b>two</b>', title: 'My "title"', showNow: false };
    const html = renderTarokkaHtml(view({ forms: { a: form } }));
    expect(html).toContain('What the players read');
    expect(html).toContain('maxlength="5000"');
    expect(html).toContain('required');
    expect(html).toContain('Line one\n&lt;b&gt;two&lt;/b&gt;</textarea>');
    expect(html).toContain('value="My &quot;title&quot;"');
    expect(html).toContain('data-field="revealShowNow" data-position="a"> Show it now');
    expect(html).not.toContain('data-field="revealShowNow" data-position="a" checked');
    expect(html).toContain('data-action="revealGo" data-position="a"');
    expect(html).toContain('data-action="revealCancel" data-position="a"');
    // The other position still has its Reveal... button.
    expect(html).toContain('data-action="revealOpen" data-position="b"');

    const ticked = renderTarokkaHtml(view({ forms: { a: { ...form, showNow: true } } }));
    expect(ticked).toContain('data-field="revealShowNow" data-position="a" checked');
  });

  it('draws no form for a revealed position, even if one is kept', () => {
    const reading = parseReading(result([position('a', { revealed: true })]));
    const html = renderTarokkaHtml(view({ reading, forms: { a: emptyForm() } }));
    expect(html).not.toContain('data-form=');
  });

  it('disables the reveal buttons while a reveal runs', () => {
    const idle = renderTarokkaHtml(view({ forms: { a: emptyForm() } }));
    expect(idle).not.toMatch(/data-action="revealGo"[^>]*disabled/);
    const busy = renderTarokkaHtml(view({ forms: { a: emptyForm() }, busy: true }));
    expect(busy).toMatch(/data-action="revealGo"[^>]*disabled/);
    expect(busy).toMatch(/data-action="revealOpen"[^>]*disabled/);
  });

  it('shows loading, errors and action errors, escaped', () => {
    expect(renderTarokkaHtml(view({ status: 'loading', reading: null }))).toContain(
      'Loading the reading'
    );
    expect(renderTarokkaHtml(view({ status: 'error', error: '<i>not connected</i>' }))).toContain(
      'role="alert">&lt;i&gt;not connected&lt;/i&gt;'
    );
    expect(renderTarokkaHtml(view({ actionError: 'Could not <b>reveal</b>' }))).toContain(
      'Could not &lt;b&gt;reveal&lt;/b&gt;'
    );
  });

  it('escapes every string from the backend', () => {
    const reading = parseReading(
      result(
        [
          position('a', {
            label: '<script>x</script>',
            cardName: '<img src=x>',
            cardId: '"><b>',
            gmNote: '<u>note</u>',
            links: { sceneUuid: '"><script>' },
          }),
        ],
        {}
      )
    );
    (reading as { source: string }).source = '<s>src</s>';
    const html = renderTarokkaHtml(view({ reading, showCards: true }));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<u>');
    expect(html).not.toContain('<s>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x&gt;');
  });
});

describe('renderTarokkaConfirmHtml', () => {
  it('shows the summary, note and diff lines escaped, and says a reveal cannot be taken back', () => {
    const html = renderTarokkaConfirmHtml({
      planId: 'p',
      summary: 'Reveal <b>slot</b>',
      note: 'A <i>note</i>',
      diff: ['adds <u>a page</u>'],
    });
    expect(html).toContain('Reveal this to the players?');
    expect(html).toContain('Reveal &lt;b&gt;slot&lt;/b&gt;');
    expect(html).toContain('A &lt;i&gt;note&lt;/i&gt;');
    expect(html).toContain('adds &lt;u&gt;a page&lt;/u&gt;');
    expect(html).not.toContain('<b>');
    expect(html).toContain('cannot be taken back');
  });
});
