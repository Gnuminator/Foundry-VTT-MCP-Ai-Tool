import { describe, expect, it } from 'vitest';
import { EFFECT_DEDUPE_WINDOW_MS, EffectEventDeduper } from './effect-dedupe.js';

const prone = { actor: 'Actor.a1', kind: 'add', name: 'Prone', statuses: ['prone'] };

describe('EffectEventDeduper (P-026)', () => {
  it('drops a matching second event within the window and lets it through after', () => {
    const d = new EffectEventDeduper();
    expect(d.isDuplicate(prone, 1000)).toBe(false);
    expect(d.isDuplicate(prone, 1000 + EFFECT_DEDUPE_WINDOW_MS)).toBe(true);
    expect(d.isDuplicate(prone, 1000 + EFFECT_DEDUPE_WINDOW_MS + 1)).toBe(false);
  });

  it('matches on the same name or any shared status', () => {
    const d = new EffectEventDeduper();
    expect(d.isDuplicate(prone, 0)).toBe(false);
    expect(d.isDuplicate({ ...prone, name: 'Prone (AC5e)' }, 10)).toBe(true);
    expect(d.isDuplicate({ ...prone, statuses: [] }, 20)).toBe(true);
  });

  it('keeps other actors, other kinds and other effects apart', () => {
    const d = new EffectEventDeduper();
    expect(d.isDuplicate(prone, 0)).toBe(false);
    expect(d.isDuplicate({ ...prone, actor: 'Actor.a2' }, 1)).toBe(false);
    expect(d.isDuplicate({ ...prone, kind: 'remove' }, 2)).toBe(false);
    expect(d.isDuplicate({ ...prone, name: 'Grappled', statuses: ['grappled'] }, 3)).toBe(false);
  });

  it('never dedupes events without an actor', () => {
    const d = new EffectEventDeduper();
    expect(d.isDuplicate({ ...prone, actor: null }, 0)).toBe(false);
    expect(d.isDuplicate({ ...prone, actor: null }, 1)).toBe(false);
  });
});
