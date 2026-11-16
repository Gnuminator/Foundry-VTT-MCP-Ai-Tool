// The folds of the During cards, as plain data and rules (D-092, I-107): which cards there are,
// which are folded by default for a layout, a fight and a screen width, what a click does (each card
// opens and folds on its own, so any of them can be open together), and how the GM's own choices are kept. No
// React here, so the rules have unit tests; components/Folds.tsx does the rest.
//
// A card the GM folded or opened keeps that choice for the same layout, fight and width class
// (it does not start over when a fight begins or ends or the window crosses 600 or 900 px). The choices are kept in this browser (lib/remember.ts).
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

/** The element ids of the cards (#pane-feed, #party-drawer, ...). */
const FOLD_IDS: Record<FoldCard, string> = {
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
 * one opens, and the other cards stay as they are. Only the
 * cards that change are kept as the GM's choice, so the rest still follow the defaults.
 */
export function toggleFold(choices: FoldChoices, s: FoldSituation, card: FoldCard): FoldChoices {
  const before = foldsFor(choices, s);
  const after: Folds = { ...before, [card]: !before[card] };
  const key = keyOf(s);
  const kept: Partial<Folds> = { ...choices[key] };
  for (const name of FOLD_CARDS) if (after[name] !== before[name]) kept[name] = after[name];
  return { ...choices, [key]: kept };
}

/**
 * Saved choices, checked: only situations of the form layout|context|width with boolean folds of
 * the four cards are kept; anything else (an old shape, a hand edit) is dropped.
 */
export function readFoldChoices(raw: unknown): FoldChoices {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return NO_CHOICES;
  const out: Record<string, Partial<Folds>> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!/^(layered|toggle|auto)\|(calm|combat)\|(phone|medium|wide)$/.test(key)) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const kept: Partial<Folds> = {};
    for (const card of FOLD_CARDS) {
      const v = (value as Record<string, unknown>)[card];
      if (typeof v === 'boolean') kept[card] = v;
    }
    if (Object.keys(kept).length > 0) out[key] = kept;
  }
  return out;
}

/** The choices after opening a card from outside (the Advanced menu's Party and Handouts). */
export function openFold(choices: FoldChoices, s: FoldSituation, card: FoldCard): FoldChoices {
  return foldsFor(choices, s)[card] ? toggleFold(choices, s, card) : choices;
}
