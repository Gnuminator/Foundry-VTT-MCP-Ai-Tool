// The During folds: the defaults per layout, fight and width, what a click does, and that the
// GM's own choices are kept for the same layout, fight and width class.
import { describe, expect, it } from 'vitest';

import {
  FOLD_CARDS,
  NO_CHOICES,
  defaultFolds,
  foldBodyId,
  foldsFor,
  openFold,
  sideCards,
  toggleFold,
  widthClass,
  type FoldChoices,
  type FoldSituation,
  type Folds,
} from './duringFolds';

const at = (
  layout: FoldSituation['layout'],
  context: FoldSituation['context'] = 'calm',
  width: FoldSituation['width'] = 'wide'
): FoldSituation => ({ layout, context, width });

const folds = (feed: boolean, changes: boolean, handouts: boolean, party: boolean): Folds => ({
  feed,
  changes,
  handouts,
  party,
});

describe('widthClass', () => {
  it('names the three classes; the phone wins', () => {
    expect(widthClass(false, true)).toBe('phone');
    expect(widthClass(false, false)).toBe('medium');
    expect(widthClass(true, false)).toBe('wide');
  });
});

describe('defaultFolds', () => {
  it('Cards: the feed and Recent Changes open, Handouts and Party folded', () => {
    expect(defaultFolds(at('layered'))).toEqual(folds(false, false, true, true));
  });

  it('Simple/Full: everything open', () => {
    expect(defaultFolds(at('toggle'))).toEqual(folds(false, false, false, false));
    expect(defaultFolds(at('toggle', 'combat'))).toEqual(folds(false, false, false, false));
  });

  it('Auto without a fight looks like Cards', () => {
    expect(defaultFolds(at('auto'))).toEqual(defaultFolds(at('layered')));
  });

  it('Auto in a fight folds the feed and opens Party', () => {
    expect(defaultFolds(at('auto', 'combat'))).toEqual(folds(true, false, true, false));
  });

  it('Cards in a fight are the same as without one', () => {
    expect(defaultFolds(at('layered', 'combat'))).toEqual(defaultFolds(at('layered')));
  });

  it('on a phone the feed is folded in every layout', () => {
    for (const layout of ['layered', 'toggle', 'auto'] as const) {
      expect(defaultFolds(at(layout, 'calm', 'phone')).feed).toBe(true);
      expect(defaultFolds(at(layout, 'calm', 'medium')).feed).toBe(false);
    }
    expect(defaultFolds(at('toggle', 'calm', 'phone'))).toEqual(folds(true, false, false, false));
  });
});

describe('sideCards', () => {
  it('Simple/Full has no side set', () => {
    expect(sideCards('toggle', 'calm')).toEqual([]);
  });
  it('Cards: Recent Changes, Handouts and Party', () => {
    expect(sideCards('layered', 'calm')).toEqual(['changes', 'handouts', 'party']);
    expect(sideCards('auto', 'calm')).toEqual(['changes', 'handouts', 'party']);
  });
  it('Auto in a fight: the feed is at the side, Party is not', () => {
    expect(sideCards('auto', 'combat')).toEqual(['changes', 'handouts', 'feed']);
  });
});

describe('toggleFold', () => {
  it('folds an open card and opens a folded one', () => {
    let c = toggleFold(NO_CHOICES, at('layered'), 'feed');
    expect(foldsFor(c, at('layered')).feed).toBe(true);
    c = toggleFold(c, at('layered'), 'feed');
    expect(foldsFor(c, at('layered')).feed).toBe(false);
  });

  it('on a wide screen opening a side card folds the other side cards', () => {
    const s = at('layered');
    const c = toggleFold(NO_CHOICES, s, 'handouts');
    expect(foldsFor(c, s)).toEqual(folds(false, true, false, true));
    // Opening Party now folds Handouts and Recent Changes (already folded).
    expect(foldsFor(toggleFold(c, s, 'party'), s)).toEqual(folds(false, true, true, false));
  });

  it('folding a side card does not touch the others', () => {
    const s = at('layered');
    const open = toggleFold(NO_CHOICES, s, 'handouts');
    const c = toggleFold(open, s, 'handouts');
    expect(foldsFor(c, s)).toEqual(folds(false, true, true, true));
  });

  it('the feed is not a side card in Cards: folding and opening it moves nothing else', () => {
    const s = at('layered');
    const c = toggleFold(toggleFold(NO_CHOICES, s, 'handouts'), s, 'feed');
    const d = toggleFold(c, s, 'feed');
    expect(foldsFor(d, s)).toEqual(folds(false, true, false, true));
  });

  it('in Auto during a fight the feed is a side card, Party is not', () => {
    const s = at('auto', 'combat');
    const c = toggleFold(NO_CHOICES, s, 'feed');
    expect(foldsFor(c, s)).toEqual(folds(false, true, true, false));
    // Opening Handouts folds Recent Changes (folded) and the feed again; Party stays open.
    expect(foldsFor(toggleFold(c, s, 'handouts'), s)).toEqual(folds(true, true, false, false));
  });

  it('not on a medium width or a phone: opening a card leaves the others', () => {
    for (const width of ['medium', 'phone'] as const) {
      const s = at('layered', 'calm', width);
      const c = toggleFold(NO_CHOICES, s, 'handouts');
      expect(foldsFor(c, s).party).toBe(true);
      expect(foldsFor(c, s).handouts).toBe(false);
    }
  });

  it('Simple/Full has no side set: opening a card leaves the others', () => {
    const s = at('toggle');
    // Fold Handouts and Party, then open Handouts: Party stays folded.
    const c = toggleFold(toggleFold(NO_CHOICES, s, 'handouts'), s, 'party');
    expect(foldsFor(c, s)).toEqual(folds(false, false, true, true));
    expect(foldsFor(toggleFold(c, s, 'handouts'), s)).toEqual(folds(false, false, false, true));
  });

  it('does not change the choices it was given', () => {
    const before: FoldChoices = {};
    toggleFold(before, at('layered'), 'feed');
    expect(before).toEqual({});
  });
});

describe('the GM choice is kept', () => {
  it('for the same layout, fight and width, also after a trip through another situation', () => {
    const calm = at('auto');
    const fight = at('auto', 'combat');
    // The GM folds the feed in calm Auto.
    let c = toggleFold(NO_CHOICES, calm, 'feed');
    expect(foldsFor(c, calm).feed).toBe(true);
    // The fight starts: Auto shows its own defaults the first time.
    expect(foldsFor(c, fight)).toEqual(defaultFolds(fight));
    // The GM opens the feed in the fight, then the fight ends: calm is as the GM left it.
    c = toggleFold(c, fight, 'feed');
    expect(foldsFor(c, fight).feed).toBe(false);
    expect(foldsFor(c, calm).feed).toBe(true);
    // A second fight remembers the GM's choice there too.
    expect(foldsFor(c, fight).feed).toBe(false);
  });

  it('the width classes keep their own choices', () => {
    const wide = at('layered', 'calm', 'wide');
    const phone = at('layered', 'calm', 'phone');
    const c = toggleFold(NO_CHOICES, phone, 'feed');
    expect(foldsFor(c, phone).feed).toBe(false);
    expect(foldsFor(c, wide).feed).toBe(false);
    expect(foldsFor(c, at('layered', 'calm', 'medium')).feed).toBe(false);
    const d = toggleFold(NO_CHOICES, wide, 'handouts');
    expect(foldsFor(d, phone)).toEqual(defaultFolds(phone));
  });

  it('each layout keeps its own choices', () => {
    const c = toggleFold(NO_CHOICES, at('layered'), 'handouts');
    expect(foldsFor(c, at('layered')).handouts).toBe(false);
    expect(foldsFor(c, at('toggle'))).toEqual(defaultFolds(at('toggle')));
    expect(foldsFor(c, at('auto')).handouts).toBe(true);
  });

  it('a card the GM did not touch keeps following the defaults', () => {
    const s = at('layered');
    const c = toggleFold(NO_CHOICES, s, 'feed');
    expect(foldsFor(c, s).party).toBe(defaultFolds(s).party);
    expect(Object.keys(c['layered|calm|wide'] ?? {})).toEqual(['feed']);
  });

  it('side cards folded by an opening are kept as the GM choice', () => {
    const s = at('layered');
    const c = toggleFold(toggleFold(NO_CHOICES, s, 'handouts'), s, 'party');
    expect(foldsFor(c, s)).toEqual(folds(false, true, true, false));
  });
});

describe('openFold', () => {
  it('opens a folded card like a click, and leaves an open card alone', () => {
    const s = at('layered');
    const c = openFold(NO_CHOICES, s, 'party');
    expect(foldsFor(c, s)).toEqual(folds(false, true, true, false));
    expect(openFold(c, s, 'party')).toBe(c);
  });
});

describe('foldBodyId', () => {
  it('names the body after the old element id', () => {
    expect(FOLD_CARDS.map(foldBodyId)).toEqual([
      'pane-feed-body',
      'pane-changes-body',
      'handouts-drawer-body',
      'party-drawer-body',
    ]);
  });
});
