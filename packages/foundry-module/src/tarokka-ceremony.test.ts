import { describe, expect, it } from 'vitest';
import {
  ceremonyFor,
  cleanLine,
  lineAdded,
  MAX_LINE,
  parsePublicTable,
  reconcile,
  renderCeremonyHtml,
  renderPlayerHtml,
  type PublicTable,
} from './tarokka-table-model.js';
import type { PositionRow } from './tarokka-model.js';

function table(overrides: Partial<PublicTable> = {}): PublicTable {
  return {
    readingId: 'r1',
    shown: true,
    slots: [
      { stage: 'placed' },
      { stage: 'placed' },
      { stage: 'empty' },
      { stage: 'empty' },
      { stage: 'empty' },
    ],
    ...overrides,
  };
}

function flipped(line?: string): PublicTable {
  const t = table();
  t.slots[0] = {
    stage: 'revealed',
    cardId: 'swords-7',
    name: 'Seven of Swords',
    ...(line ? { line } : {}),
  };
  return t;
}

describe('ceremonyFor', () => {
  it('fires for a card that just turned over, with the GM line', () => {
    expect(ceremonyFor(table(), flipped('Beware the dark.'))).toEqual({
      index: 0,
      cardId: 'swords-7',
      name: 'Seven of Swords',
      image: null,
      line: 'Beware the dark.',
    });
  });

  it('leaves the line out when it is only the card name', () => {
    expect(ceremonyFor(table(), flipped('Seven of Swords'))?.line).toBe('');
  });

  it('does not fire on a first look, another reading, an undo or a hidden table', () => {
    expect(ceremonyFor(null, flipped())).toBeNull();
    expect(ceremonyFor(table({ readingId: 'r0' }), flipped())).toBeNull();
    expect(ceremonyFor(flipped(), table())).toBeNull();
    expect(ceremonyFor(table(), flipped())).not.toBeNull();
    expect(ceremonyFor(table(), { ...flipped(), shown: false })).toBeNull();
    expect(ceremonyFor(flipped(), flipped())).toBeNull();
  });
});

describe('lineAdded', () => {
  it('sees a line that arrives after the flip, for the same card only', () => {
    expect(lineAdded(flipped(), flipped('Late line.'))).toEqual({
      cardId: 'swords-7',
      line: 'Late line.',
    });
    expect(lineAdded(flipped('Old'), flipped('Old'))).toBeNull();
    expect(lineAdded(table(), flipped('New'))).toBeNull();
    expect(lineAdded(null, flipped('x'))).toBeNull();
  });
});

describe('the line on the table', () => {
  it('is trimmed and cut at the limit', () => {
    expect(cleanLine('  hi ')).toBe('hi');
    expect(cleanLine('   ')).toBeNull();
    expect(cleanLine(5)).toBeNull();
    expect(cleanLine('x'.repeat(MAX_LINE + 50))?.length).toBe(MAX_LINE);
  });

  it('survives parsing only on a revealed slot', () => {
    const parsed = parsePublicTable({
      readingId: 'r1',
      shown: true,
      slots: [
        { stage: 'revealed', cardId: 'raven', name: 'The Raven', line: 'Hello' },
        { stage: 'placed', line: 'secret' },
      ],
    });
    expect(parsed.slots[0]?.line).toBe('Hello');
    expect(JSON.stringify(parsed.slots[1])).not.toContain('secret');
  });

  it('reconcile adds a new line and keeps an old one for the same card', () => {
    const positions = [
      {
        position: 'tome',
        label: 'Tome',
        cardId: 'swords-7',
        cardName: 'Seven of Swords',
        gmNote: null,
        links: {},
        revealed: true,
        revealPageUuid: null,
      },
    ] as unknown as PositionRow[];
    const first = reconcile(table(), positions, 'r1', {}, { 'swords-7': 'Beware.' });
    expect(first.slots[0]?.line).toBe('Beware.');
    expect(reconcile(first, positions, 'r1', {}).slots[0]?.line).toBe('Beware.');
    expect(reconcile(table(), positions, 'r1', {}).slots[0]?.line).toBeUndefined();
  });

  it('is escaped under the card on the player table and in the ceremony', () => {
    const t = flipped('<img src=x onerror=1> & more');
    expect(renderPlayerHtml(t)).toContain('&lt;img src=x onerror=1&gt; &amp; more');
    expect(renderPlayerHtml(t)).not.toContain('<img src=x');
    const c = ceremonyFor(table(), t);
    expect(c).not.toBeNull();
    const html = renderCeremonyHtml(c!);
    expect(html).toContain('fmb-tt-cer-line');
    expect(html).toContain('fmb-tt-cer-back');
    expect(html).not.toContain('<img src=x');
  });

  it('has no line paragraph when the GM typed none', () => {
    const c = ceremonyFor(table(), flipped());
    expect(renderCeremonyHtml(c!)).not.toContain('fmb-tt-cer-line');
  });
});
