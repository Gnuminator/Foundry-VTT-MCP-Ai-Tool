// The folds of the During cards, as plain data and rules (D-092, I-107): which cards there are,
// which are folded by default for a layout, a fight and a screen width, what a click does (on a
// wide screen opening a side card folds the others), and how the GM's own choices are kept. No
// React here, so the rules have unit tests; components/Folds.tsx does the rest.
//
// Unlike the old page, which started over whenever a fight began or ended or the window crossed
// 600 or 900 px, a card the GM folded or opened keeps that choice for the same layout, fight and
// width class. State lives in memory for the page load only.
import type { DuringContext } from './duringTrial';
import type { DuringLayout } from './prefsModel';

export type FoldCard = 'feed' | 'changes' | 'handouts' | 'party';

export const FOLD_CARDS: readonly FoldCard[] = ['feed', 'changes', 'handouts', 'party'];

/** What the fold button calls each card ("Fold Recent Changes"). */
export const FOLD_TITLES: Record<FoldCard, string> = {
  feed: 'Live Feed',
  changes: 'Recent Changes',
  handouts: 'Handouts',
  party: 'Party',
};

/** The old page's element ids of the cards (#pane-feed, #party-drawer, ...). */
export const FOLD_IDS: Record<FoldCard, string> = {
  feed: 'pane-feed',
  changes: 'pane-changes',
  handouts: 'handouts-drawer',
  party: 'party-drawer',
};

/** The id of a card's body, which its fold button controls. */
export const foldBodyId = (card: FoldCard): string => `${FOLD_IDS[card]}-body`;

/** Folded or not, for each card. */
export type Folds = Record<FoldCard, boolean>;

/** The width classes the layout cares about: under 600 px, 600 to 899 px, 900 px and wider. */
export type WidthClass = 'phone' | 'medium' | 'wide';

export function widthClass(wide: boolean, phone: boolean): WidthClass {
  return phone ? 'phone' : wide ? 'wide' : 'medium';
}

/** What the folds depend on: the layout, the fight and the width class. */
export interface FoldSituation {
  layout: DuringLayout;
  context: DuringContext;
  width: WidthClass;
}

/**
 * The cards at the side on a wide screen: opening one folds the others there. Simple/Full has
 * none; in Auto during a fight the feed is a side card and Party takes the big column.
 */
export function sideCards(layout: DuringLayout, context: DuringContext): FoldCard[] {
  if (layout === 'toggle') return [];
  return layout === 'auto' && context === 'combat'
    ? ['changes', 'handouts', 'feed']
    : ['changes', 'handouts', 'party'];
}

/** The folds a layout starts with. */
export function defaultFolds(s: FoldSituation): Folds {
  const folds: Folds = { feed: false, changes: false, handouts: true, party: true };
  if (s.layout === 'toggle') {
    folds.handouts = false;
    folds.party = false;
  }
  if (s.layout === 'auto' && s.context === 'combat') {
    folds.party = false;
    folds.feed = true;
  }
  // On a phone the feed is long and fast: Recent Changes comes first, the feed opens on a tap.
  if (s.width === 'phone') folds.feed = true;
  return folds;
}

/** The GM's choices, per situation: only the cards they folded or opened there. */
export type FoldChoices = Readonly<Record<string, Partial<Folds>>>;

export const NO_CHOICES: FoldChoices = {};

const keyOf = (s: FoldSituation): string => `${s.layout}|${s.context}|${s.width}`;

/** The folds on screen: the defaults, with the GM's choices for this situation on top. */
export function foldsFor(choices: FoldChoices, s: FoldSituation): Folds {
  return { ...defaultFolds(s), ...choices[keyOf(s)] };
}

/**
 * The choices after a click on a card's fold button (or its title). An open card folds; a folded
 * one opens, and on a wide screen, when it is a side card, the other side cards fold. Only the
 * cards that change are kept as the GM's choice, so the rest still follow the defaults.
 */
export function toggleFold(choices: FoldChoices, s: FoldSituation, card: FoldCard): FoldChoices {
  const before = foldsFor(choices, s);
  const after: Folds = { ...before, [card]: !before[card] };
  if (before[card] && s.width === 'wide') {
    const side = sideCards(s.layout, s.context);
    if (side.includes(card)) for (const other of side) if (other !== card) after[other] = true;
  }
  const key = keyOf(s);
  const kept: Partial<Folds> = { ...choices[key] };
  for (const name of FOLD_CARDS) if (after[name] !== before[name]) kept[name] = after[name];
  return { ...choices, [key]: kept };
}

/** The choices after opening a card from outside (the Advanced menu's Party and Handouts). */
export function openFold(choices: FoldChoices, s: FoldSituation, card: FoldCard): FoldChoices {
  return foldsFor(choices, s)[card] ? toggleFold(choices, s, card) : choices;
}
