import { describe, expect, it } from 'vitest';
import type { PositionRow } from './tarokka-model.js';
import {
  allRevealed,
  canFlip,
  cardLook,
  emptyGmView,
  emptyTable,
  nextToPlace,
  parsePublicTable,
  placeNext,
  publicHasNoSecrets,
  readingIdOf,
  reconcile,
  renderBack,
  renderFace,
  renderGmHtml,
  renderPlayerHtml,
  safeImage,
  type GmSlot,
  type PublicTable,
} from './tarokka-table-model.js';

const CARDS: Record<string, [string, string]> = {
  tome: ['swords-7', 'Seven of Swords'],
  holySymbol: ['coins-master', 'Master of Coins'],
  sunsword: ['stars-3', 'Three of Stars'],
  ally: ['raven', 'The Raven'],
  strahdLocation: ['donjon', 'The Donjon'],
};

function rows(revealed: string[] = []): PositionRow[] {
  return Object.entries(CARDS).map(([position, [cardId, cardName]]) => ({
    position,
    label: position.toUpperCase(),
    cardId,
    cardName,
    gmNote: 'SECRET NOTE',
    links: [],
    revealed: revealed.includes(position),
    revealPageUuid: null,
  }));
}

describe('placing and flipping', () => {
  it('places cards in deal order, one at a time, and stops at five', () => {
    let table = emptyTable('r1');
    expect(nextToPlace(table)).toBe(0);
    for (let i = 0; i < 5; i++) {
      expect(nextToPlace(table)).toBe(i);
      table = placeNext(table);
    }
    expect(nextToPlace(table)).toBe(-1);
    expect(placeNext(table)).toBe(table);
    expect(table.slots.every(s => s.stage === 'placed')).toBe(true);
  });

  it('flips only a card that is face down on the table', () => {
    let table = emptyTable('r1');
    expect(canFlip(table, 0)).toBe(false);
    table = placeNext(table);
    expect(canFlip(table, 0)).toBe(true);
    expect(canFlip(table, 1)).toBe(false);
    expect(canFlip(table, 9)).toBe(false);
  });
});

describe('reconcile with the vault reading', () => {
  it('starts a clean table for a new reading, with the old shown flag dropped', () => {
    const old: PublicTable = { ...placeNext(emptyTable('old')), shown: true };
    const next = reconcile(old, rows(), 'new', {});
    expect(next.readingId).toBe('new');
    expect(next.shown).toBe(false);
    expect(next.slots.every(s => s.stage === 'empty')).toBe(true);
  });

  it('keeps placed cards and the shown flag for the same reading', () => {
    let table = placeNext(placeNext(emptyTable('r1')));
    table = { ...table, shown: true };
    const next = reconcile(table, rows(), 'r1', {});
    expect(next.shown).toBe(true);
    expect(next.slots.map(s => s.stage)).toEqual(['placed', 'placed', 'empty', 'empty', 'empty']);
  });

  it('shows the face of a position the vault has revealed, with its picture', () => {
    const next = reconcile(emptyTable('r1'), rows(['ally']), 'r1', {
      raven: '/worlds/x/raven.webp',
    });
    expect(next.slots[3]).toEqual({
      stage: 'revealed',
      cardId: 'raven',
      name: 'The Raven',
      image: '/worlds/x/raven.webp',
    });
    expect(next.slots[0]).toEqual({ stage: 'empty' });
  });

  it('turns a card face down again when its reveal was undone', () => {
    const revealed = reconcile(emptyTable('r1'), rows(['tome']), 'r1', {});
    const undone = reconcile(revealed, rows(), 'r1', {});
    expect(undone.slots[0]).toEqual({ stage: 'placed' });
  });

  it('is empty without a reading', () => {
    const next = reconcile({ ...emptyTable('r1'), shown: true }, null, '', {});
    expect(next).toEqual(emptyTable());
  });
});

describe('what a player can see', () => {
  const secrets = [
    'swords-7',
    'Seven of Swords',
    'coins-master',
    'stars-3',
    'donjon',
    'The Donjon',
    'SECRET NOTE',
    'holySymbol',
    'strahdLocation',
    'sunsword',
    'tome',
    'HOLYSYMBOL',
  ];

  it('holds no unrevealed card id or name, position name or GM note, at any stage', () => {
    let table = reconcile(emptyTable('r1'), rows(['ally']), 'r1', {});
    expect(publicHasNoSecrets(table, secrets)).toBe(true);
    table = placeNext(table);
    expect(publicHasNoSecrets(table, secrets)).toBe(true);
    expect(JSON.stringify(table)).toContain('raven');
    const html = renderPlayerHtml(table);
    for (const s of secrets) expect(html).not.toContain(s);
    expect(html).toContain('The Raven');
  });

  it('draws a back for a placed card and nothing readable on it', () => {
    const html = renderPlayerHtml(placeNext(emptyTable('r1')));
    expect(html).toContain('fmb-tt-back');
    expect(html.match(/fmb-tt-empty/g)).toHaveLength(4);
  });

  it('parses a hand-edited setting down to the safe shape', () => {
    const parsed = parsePublicTable({
      readingId: 'r1',
      shown: true,
      slots: [
        { stage: 'revealed', cardId: 'Not A Card', name: 'x' },
        { stage: 'revealed', cardId: 'raven', name: 'R', image: 'javascript:alert(1)' },
        { stage: 'placed', cardId: 'swords-7', name: 'leak' },
        'junk',
      ],
    });
    expect(parsed.slots[0]).toEqual({ stage: 'empty' });
    expect(parsed.slots[1]).toEqual({ stage: 'revealed', cardId: 'raven', name: 'R' });
    expect(parsed.slots[2]).toEqual({ stage: 'placed' });
    expect(parsed.slots).toHaveLength(5);
    expect(parsePublicTable(null)).toEqual(emptyTable());
    expect(parsePublicTable({ shown: true }).shown).toBe(false);
  });

  it('allRevealed is true only with five faces', () => {
    expect(allRevealed(emptyTable('r'))).toBe(false);
    const all = reconcile(emptyTable('r'), rows(Object.keys(CARDS)), 'r', {});
    expect(allRevealed(all)).toBe(true);
  });
});

describe('cards drawn in CSS', () => {
  it('reads suit and value from the card id', () => {
    expect(cardLook('swords-7')).toMatchObject({ suit: 'swords', value: '7' });
    expect(cardLook('coins-master').value).toBe('M');
    expect(cardLook('raven').suit).toBe('crown');
  });

  it('escapes names and picture paths', () => {
    const html = renderFace('raven', '<img onerror=x>', '/a.webp');
    expect(html).not.toContain('<img onerror');
    expect(html).toContain('&lt;img onerror=x&gt;');
    expect(renderBack()).toContain('fmb-tt-back');
  });

  it('refuses scripts and quotes in a picture path', () => {
    expect(safeImage('javascript:alert(1)')).toBeNull();
    expect(safeImage('data:image/png;base64,AAAA')).toBeNull();
    expect(safeImage('/a" onerror="x')).toBeNull();
    expect(safeImage('worlds/w/a b.webp')).toBe('worlds/w/a b.webp');
    expect(safeImage('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(safeImage(5)).toBeNull();
  });

  it('reads the reading id from a result', () => {
    expect(readingIdOf({ reading: { readingId: 'roll-abc_1' } })).toBe('roll-abc_1');
    expect(readingIdOf({ reading: { readingId: 'bad id' } })).toBe('');
    expect(readingIdOf(null)).toBe('');
  });
});

describe('the GM view', () => {
  const slots: GmSlot[] = Object.entries(CARDS).map(([position, [cardId, cardName]]) => ({
    position,
    label: position,
    cardId,
    cardName,
    gmNote: 'SECRET NOTE',
    image: null,
  }));

  it('hides faces and notes until Show cards is ticked, and offers Place on the next slot only', () => {
    const table = placeNext(emptyTable('r1'));
    const view = { ...emptyGmView(), status: 'ready' as const, slots, table };
    const html = renderGmHtml(view);
    expect(html).not.toContain('Seven of Swords');
    expect(html).not.toContain('SECRET NOTE');
    expect(html.match(/data-action="place"/g)).toHaveLength(1);
    expect(html).toContain('data-action="place" data-index="1"');
    expect(html.match(/data-action="flip"/g)).toHaveLength(1);
    const shown = renderGmHtml({ ...view, showCards: true });
    expect(shown).toContain('Seven of Swords');
    expect(shown).toContain('SECRET NOTE');
  });

  it('shows the Show to players button only with a reading, and Stop showing once shown', () => {
    const none = renderGmHtml({ ...emptyGmView(), status: 'ready' });
    expect(none).toMatch(/data-action="show"[^>]*disabled/);
    expect(none).toContain('No reading yet');
    const view = {
      ...emptyGmView(),
      status: 'ready' as const,
      slots,
      table: { ...emptyTable('r1'), shown: true },
    };
    expect(renderGmHtml(view)).toContain('data-action="hide"');
  });
});
