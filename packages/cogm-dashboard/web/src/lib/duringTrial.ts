// The During layouts, as plain data and rules (I-107): the three steps of the layout trial and
// what the screen looks like for a layout, a fight and the trial. No React here, so the rules
// have unit tests; components/During.tsx does the rest.
import type { DuringLayout, DuringPrefs } from './prefsModel';

export interface TourStep {
  layout: DuringLayout;
  title: string;
  text: string;
  /** The step shows a made-up fight when no real one runs, so Auto can show its combat look. */
  sampleCombat?: true;
}

/**
 * The trial's steps. The Simple/Full text points at "Show everything", which the bar shows in
 * the trial (the old page hid it there, so the text pointed at nothing).
 */
export const TOUR: readonly TourStep[] = [
  {
    layout: 'layered',
    title: 'Cards',
    text: 'The Live Feed is the big column. Recent Changes, Handouts and Party are cards at the side: open one and the others fold. The turn order shows only while a fight runs.',
  },
  {
    layout: 'toggle',
    title: 'Simple/Full',
    text: 'Simple shows only the Live Feed, Recent Changes and Handouts. "Show everything" on the bar switches to Full: the turn order and Party as well, all open.',
  },
  {
    layout: 'auto',
    title: 'Auto',
    text: 'Follows the game. Without a fight it looks like Cards. When combat starts, the turn order grows and Party opens. This preview shows a sample fight.',
    sampleCombat: true,
  },
];

/** A running trial: the step on screen, and whether its Simple/Full step previews Full. */
export interface Trial {
  step: number;
  full: boolean;
}

export const FIRST_TRIAL: Trial = { step: 0, full: false };

/** The step after this one; the last goes back to the first. Each step starts on Simple. */
export function nextTrial(trial: Trial): Trial {
  return { step: (trial.step + 1) % TOUR.length, full: false };
}

/** The Next button's text: the last step says it goes back to the first. */
export function nextLabel(trial: Trial): string {
  return trial.step === TOUR.length - 1 ? 'Back to the first' : 'Next';
}

/** "Layout 2 of 3". */
export function stepLine(trial: Trial): string {
  return `Layout ${trial.step + 1} of ${TOUR.length}`;
}

export type DuringContext = 'calm' | 'combat';
export type DuringView = 'simple' | 'full';

/** What `#moment-during` shows for the prefs, a fight and the trial (the CSS reads these). */
export interface DuringScreen {
  layout: DuringLayout;
  context: DuringContext;
  /** Only in Simple/Full. */
  view: DuringView | undefined;
}

/**
 * The layout on screen: the trial's step while it runs, else the saved one. The context is
 * `combat` while a real fight runs, or while the trial's Auto step shows its sample fight. The
 * Simple/Full view is the trial's own preview during the trial (it starts on Simple and saves
 * nothing), else the saved one.
 */
export function duringScreen(input: {
  prefs: DuringPrefs | undefined;
  trial: Trial | null;
  combatActive: boolean;
}): DuringScreen {
  const { prefs, trial, combatActive } = input;
  const step = trial ? TOUR[trial.step] : undefined;
  const layout = step ? step.layout : (prefs?.duringLayout ?? 'layered');
  const context: DuringContext = combatActive || step?.sampleCombat ? 'combat' : 'calm';
  const full = trial ? trial.full : prefs?.duringFull === true;
  return { layout, context, view: layout === 'toggle' ? (full ? 'full' : 'simple') : undefined };
}

/** The note beside the switch in Auto. */
export function autoNote(context: DuringContext): string {
  return context === 'combat'
    ? 'Combat: the turn order and the party come forward.'
    : 'No combat: the Live Feed comes first.';
}

/** The bar's Full button: shown in Simple/Full, in the trial too. */
export function fullButtonLabel(view: DuringView | undefined): string {
  return view === 'full' ? 'Show less' : 'Show everything';
}

/** What "Use this one" saves: the step's layout, and the view the GM was looking at. */
export function keepChange(trial: Trial): {
  duringLayout: DuringLayout;
  layoutPicked: true;
  duringFull?: boolean;
} {
  const step = TOUR[trial.step];
  if (!step) throw new Error(`No trial step ${trial.step}`);
  return {
    duringLayout: step.layout,
    layoutPicked: true,
    ...(step.layout === 'toggle' ? { duringFull: trial.full } : {}),
  };
}
