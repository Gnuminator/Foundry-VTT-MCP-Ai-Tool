// The folds of the During cards (D-092, I-107), ported from the old page: Live Feed, Recent
// Changes, Handouts and Party each have a fold button first in their head, and a folded card
// shows only its head. The rules are in lib/duringFolds.ts; moments.css draws the button and hides
// what is inside a card with `.is-folded`.
//
// What is new: a card the GM folded or opened keeps that choice for the same layout, fight and
// width class (the old page started over at every fight and breakpoint), the button has a name
// ("Fold Party") and points at the card's body, and its usage names are literals so the usage
// catalogue lists them.
import {
  createContext,
  useCallback,
  useContext,
  useState,
  useSyncExternalStore,
  type JSX,
  type ReactNode,
} from 'react';

import {
  FOLD_TITLES,
  NO_CHOICES,
  foldBodyId,
  foldsFor,
  openFold,
  toggleFold,
  widthClass,
  type FoldCard,
  type FoldChoices,
  type FoldSituation,
} from '../lib/duringFolds';
import type { DuringScreen } from '../lib/duringTrial';

/** moments.css switches to one column under 900 px, and the feed folds on a phone under 600 px. */
const WIDE_QUERY = '(min-width: 900px)';
const PHONE_QUERY = '(max-width: 599px)';

/** Whether a media query matches now, following the window. False where there is no matchMedia. */
function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    notify => {
      const list = window.matchMedia(query);
      list.addEventListener('change', notify);
      return (): void => list.removeEventListener('change', notify);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}

/** What the During components know about the folds. */
export interface DuringFolds {
  isFolded: (card: FoldCard) => boolean;
  /** A click on a fold button (or a folded card's title). */
  toggle: (card: FoldCard) => void;
  /** Opens a folded card from outside (the Advanced menu's Party and Handouts); no-op if open. */
  open: (card: FoldCard) => void;
}

/**
 * The folds for the screen on show. The GM's choices stay in memory for as long as the page is
 * open, per layout, fight and width class, so leaving During and coming back finds them as they
 * were (the cards stay mounted, so their data stays too).
 */
export function useDuringFolds(screen: Pick<DuringScreen, 'layout' | 'context'>): DuringFolds {
  const wide = useMediaQuery(WIDE_QUERY);
  const phone = useMediaQuery(PHONE_QUERY);
  const [choices, setChoices] = useState<FoldChoices>(NO_CHOICES);
  const { layout, context } = screen;
  const width = widthClass(wide, phone);
  const situation: FoldSituation = { layout, context, width };
  const folds = foldsFor(choices, situation);
  const toggle = useCallback(
    (card: FoldCard) => setChoices(c => toggleFold(c, { layout, context, width }, card)),
    [layout, context, width]
  );
  const open = useCallback(
    (card: FoldCard) => setChoices(c => openFold(c, { layout, context, width }, card)),
    [layout, context, width]
  );
  return { isFolded: card => folds[card], toggle, open };
}

interface ButtonProps {
  card: FoldCard;
  folds: DuringFolds;
  'data-track': string;
}

function Button({ card, folds, ...rest }: ButtonProps): JSX.Element {
  const folded = folds.isFolded(card);
  const title = FOLD_TITLES[card];
  return (
    <button
      type="button"
      className="fold-btn"
      data-fold={card}
      aria-label={`${folded ? 'Open' : 'Fold'} ${title}`}
      aria-expanded={!folded}
      aria-controls={foldBodyId(card)}
      title={folded ? 'Open' : 'Fold'}
      onClick={() => folds.toggle(card)}
      {...rest}
    >
      {folded ? '▸' : '▾'}
    </button>
  );
}

/**
 * The fold button for a card, first in its head. The four usage names are written out here so
 * scripts/usage-catalog.mjs finds them (it reads string literals).
 */
export function FoldButton({ card, folds }: { card: FoldCard; folds: DuringFolds }): JSX.Element {
  switch (card) {
    case 'feed':
      return <Button card={card} folds={folds} data-track="dash.during.fold-feed" />;
    case 'changes':
      return <Button card={card} folds={folds} data-track="dash.during.fold-changes" />;
    case 'handouts':
      return <Button card={card} folds={folds} data-track="dash.during.fold-handouts" />;
    case 'party':
      return <Button card={card} folds={folds} data-track="dash.during.fold-party" />;
  }
}

/** What a docked panel needs to be a fold card. */
export interface CardFold {
  folded: boolean;
  toggle: () => void;
  /** The fold button, for the start of the head. */
  button: ReactNode;
}

/** Set around a panel that docks in During (Handouts, Party); Drawer reads it when docked. */
export const FoldContext = createContext<CardFold | null>(null);

export function useCardFold(): CardFold | null {
  return useContext(FoldContext);
}

/** Makes the panels inside a fold card while `active` (During is on screen); else nothing. */
export function FoldScope({
  card,
  folds,
  active,
  children,
}: {
  card: FoldCard;
  folds: DuringFolds;
  active: boolean;
  children: ReactNode;
}): JSX.Element {
  const value: CardFold | null = active
    ? {
        folded: folds.isFolded(card),
        toggle: () => folds.toggle(card),
        button: <FoldButton card={card} folds={folds} />,
      }
    : null;
  return <FoldContext.Provider value={value}>{children}</FoldContext.Provider>;
}
