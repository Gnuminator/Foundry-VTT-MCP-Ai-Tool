// The During layouts (D-092, I-107), ported from the old page: the bar with the layout switch
// (Cards, Simple/Full, Auto), the quiet hint, the Before card and the guide of the layout trial,
// and the two "During screen" entries of the Advanced menu. The old page's moments.css lays the
// slots out per `data-layout`, `data-context` and `data-view` on #moment-during (Moments.tsx sets
// them); the choice is kept per world on the server (lib/prefs.ts), so either page shows it.
import { useEffect, useRef, useState, type JSX } from 'react';

import { hasOpenPanel } from '../lib/escape';
import {
  FIRST_TRIAL,
  TOUR,
  autoNote,
  duringScreen,
  fullButtonLabel,
  keepChange,
  nextLabel,
  nextTrial,
  stepLine,
  type DuringScreen,
  type Trial,
} from '../lib/duringTrial';
import { useSavePrefs, usePrefs } from '../lib/prefs';
import {
  hintSessionKey,
  showLayoutHint,
  type DuringLayout,
  type DuringPrefs,
} from '../lib/prefsModel';
import { usePlaySession } from '../lib/session';
import { useCombatActive, useDashboardSettings } from '../lib/stream';
import { usage } from '../lib/usage';
import { Button, IconButton, Tooltip } from '../ui';

import { AdvancedItem, AdvancedLabel } from './AdvancedMenu';
import { useDuringFolds, type DuringFolds } from './Folds';
import { useHelp } from './HelpButton';
import type { Moment } from './Moments';
import { useToast } from './Toasts';

/** What the layout buttons say while the world (and so the saved choice) is not known yet. */
export const NOT_READY_TIP =
  'Your choice is saved for the world, which Foundry has not told the dashboard yet.';

export interface DuringActions {
  pickLayout: (layout: DuringLayout) => void;
  toggleFull: () => void;
  dismissHint: () => void;
  startTrial: () => void;
  skipTrial: () => void;
  nextStep: () => void;
  useStep: () => void;
  stopTrial: () => void;
  toggleCombatButtons: () => void;
}

/** Everything the During components show, and what they can do. */
export interface DuringController {
  /** The saved choices; undefined until the world is known. */
  prefs: DuringPrefs | undefined;
  /** What #moment-during shows now: the layout (the trial's, while it runs), fight and view. */
  screen: DuringScreen;
  trial: Trial | null;
  hintVisible: boolean;
  /** Which of the During cards are folded (components/Folds.tsx). */
  folds: DuringFolds;
  actions: DuringActions;
}

/**
 * The During layouts for the page: reads the saved choices and the fight, runs the trial, counts
 * the hint. `pinDuring` puts the page on During (the trial starts there and stays, as on the old
 * page).
 */
export function useDuringLayout(moment: Moment | null, pinDuring: () => void): DuringController {
  const toast = useToast();
  const prefs = usePrefs();
  const combatActive = useCombatActive();
  const { session } = usePlaySession();
  const settings = useDashboardSettings();
  const save = useSavePrefs(toast);
  const [trial, setTrial] = useState<Trial | null>(null);

  const screen = duringScreen({ prefs, trial, combatActive });
  const folds = useDuringFolds(screen);
  const sessionKey = session ? hintSessionKey(session) : null;
  const hintVisible = showLayoutHint({
    duringOnScreen: moment === 'during',
    trialRunning: trial !== null,
    sessionKey,
    prefs,
  });

  // The first time the hint shows for a session, the server counts that session (quietly).
  const counted = useRef(new Set<string>());
  const seen = prefs?.hintSessions;
  useEffect(() => {
    if (!hintVisible || !sessionKey || !seen || seen.includes(sessionKey)) return;
    if (counted.current.has(sessionKey)) return;
    counted.current.add(sessionKey);
    void save({ hintSession: sessionKey }, { quiet: true });
  }, [hintVisible, sessionKey, seen, save]);

  // The usage log counts the time the guide is up.
  const running = trial !== null;
  useEffect(() => {
    if (!running) return;
    usage().trackView('dash.trial.view');
    return (): void => usage().endView('dash.trial.view');
  }, [running]);

  // Escape ends the trial, unless it is closing something else: a drawer, a pane, the Advanced
  // menu or a confirm window (the panels listed in escape.ts). Capture runs this before they
  // close, so it still sees them open.
  useEffect(() => {
    if (!running) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || hasOpenPanel()) return;
      setTrial(null);
    };
    document.addEventListener('keydown', onKey, true);
    return (): void => document.removeEventListener('keydown', onKey, true);
  }, [running]);

  const actions: DuringActions = {
    pickLayout: layout => {
      setTrial(null);
      void save({ duringLayout: layout, layoutPicked: true });
    },
    toggleFull: () => {
      if (trial) setTrial({ ...trial, full: !trial.full });
      else void save({ duringFull: !prefs?.duringFull });
    },
    dismissHint: () => void save({ hintDismissed: true }),
    startTrial: () => {
      setTrial(t => t ?? FIRST_TRIAL);
      pinDuring();
    },
    skipTrial: () => void save({ duringLayout: 'layered', layoutPicked: true }),
    nextStep: () => setTrial(t => (t ? nextTrial(t) : t)),
    useStep: () => {
      if (!trial) return;
      const title = TOUR[trial.step]?.title ?? '';
      setTrial(null);
      // The "kept" line only once it is saved; a failed save has its own error toast.
      void save(keepChange(trial)).then(saved => {
        if (saved)
          toast(`✓ ${title} kept. Switch any time with Layout on the During screen.`, 'ok');
      });
    },
    stopTrial: () => setTrial(null),
    toggleCombatButtons: () => {
      const on = prefs?.combatButtons !== true;
      void save({ combatButtons: on }).then(saved => {
        if (!saved || !on) return;
        toast(
          settings?.gmActionsEnabled
            ? '✓ Combat buttons on: click combatants in the turn-order strip to pick them.'
            : '✓ Combat buttons on. They show in the turn-order strip once GM Actions are on.',
          'ok'
        );
      });
    },
  };
  return { prefs, screen, trial, hintVisible, folds, actions };
}

/** One of the three layout buttons; the choice is pressed when it is the one on screen. */
function LayoutButton({
  layout,
  during,
  tip,
  children,
  ...rest
}: {
  layout: DuringLayout;
  during: DuringController;
  tip: string;
  children: string;
  'data-track': string;
}): JSX.Element {
  const ready = during.prefs !== undefined;
  return (
    <button
      type="button"
      data-layout-pick={layout}
      aria-pressed={during.screen.layout === layout}
      disabled={!ready}
      title={ready ? tip : NOT_READY_TIP}
      onClick={() => during.actions.pickLayout(layout)}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * The During bar (the first row of the During view): the layout switch and its help, the Simple/
 * Full switch, the note for Auto, and the quiet hint. The hint and the notes are in the page and
 * hidden when they do not apply, as on the old page.
 */
export function DuringBar({ during }: { during: DuringController }): JSX.Element {
  const openHelp = useHelp();
  const { screen, hintVisible, prefs, trial, actions } = during;
  return (
    <div className="during-bar" id="during-bar">
      <div className="layout-switch" role="group" aria-label="During layout">
        <span className="layout-switch-label">Layout</span>
        <LayoutButton
          layout="layered"
          during={during}
          tip="Live Feed first, cards at the side"
          data-track="dash.during.layout-layered"
        >
          Cards
        </LayoutButton>
        <LayoutButton
          layout="toggle"
          during={during}
          tip="A short screen, or everything with one switch"
          data-track="dash.during.layout-toggle"
        >
          Simple/Full
        </LayoutButton>
        <LayoutButton
          layout="auto"
          during={during}
          tip="Follows the game: combat brings the turn order and the party forward"
          data-track="dash.during.layout-auto"
        >
          Auto
        </LayoutButton>
      </div>
      <Tooltip content="What the layouts do. Opens the guide">
        <button
          type="button"
          className="help-q"
          data-help="dashboard#during-layouts"
          data-track="dash.help.during-layouts"
          aria-label="Help for the During layouts"
          onClick={() => openHelp('dashboard#during-layouts')}
        >
          ?
        </button>
      </Tooltip>
      <Button
        variant="quiet"
        id="btn-during-full"
        data-track="dash.during.full-toggle"
        hidden={screen.layout !== 'toggle'}
        disabled={!trial && !prefs}
        onClick={actions.toggleFull}
      >
        {fullButtonLabel(screen.view)}
      </Button>
      <span className="during-auto-note" id="during-auto-note" hidden={screen.layout !== 'auto'}>
        {autoNote(screen.context)}
      </span>
      <p className="layout-hint" id="layout-hint" hidden={!hintVisible}>
        <span>
          New: the During screen has three layouts. Try Simple/Full or Auto here, or keep Cards.
        </span>
        <IconButton
          id="layout-hint-close"
          data-track="dash.during.hint-dismiss"
          label="Hide this hint"
          tip="It stays hidden for this world"
          onClick={actions.dismissHint}
        >
          ✕
        </IconButton>
      </p>
    </div>
  );
}

/**
 * The card at the top of Before that offers the layout trial, until a layout is kept. Never a
 * blocker: skipping keeps Cards. Hidden until the saved choice is known (and once it is picked).
 */
export function LayoutTrialCard({ during }: { during: DuringController }): JSX.Element {
  const { prefs, actions } = during;
  return (
    <section
      className="layout-trial"
      id="layout-trial"
      aria-label="Pick your During layout"
      hidden={!prefs || prefs.layoutPicked}
    >
      <div>
        <h2>Pick your During layout</h2>
        <p className="pf-detail">
          The During screen comes in three layouts. Try each one on the real screen and keep the one
          you like. Skip this and Cards stays; you can switch any time on the During screen.
        </p>
      </div>
      <div className="ready-actions">
        <Button
          className="lamp"
          id="btn-layout-trial"
          data-track="dash.trial.start"
          onClick={actions.startTrial}
        >
          Try the layouts
        </Button>
        <Button
          variant="quiet"
          id="btn-layout-trial-skip"
          data-track="dash.trial.skip"
          onClick={actions.skipTrial}
        >
          Keep Cards
        </Button>
      </div>
    </section>
  );
}

/**
 * The trial's guide: a small card in the corner, never over the screen. It does not take the
 * focus when it opens; the step line is announced when the step changes.
 */
export function LayoutTourGuide({ during }: { during: DuringController }): JSX.Element {
  const { trial, prefs, actions } = during;
  const step = trial ? TOUR[trial.step] : undefined;
  return (
    <aside
      className="layout-tour"
      id="layout-tour"
      aria-label="Try the During layouts"
      hidden={!trial}
    >
      <p className="layout-tour-step" id="layout-tour-step" aria-live="polite" aria-atomic="true">
        {trial ? stepLine(trial) : ''}
      </p>
      <h3 id="layout-tour-title">{step?.title}</h3>
      <p className="layout-tour-text" id="layout-tour-text">
        {step?.text}
      </p>
      <div className="ready-actions">
        <Button
          className="lamp"
          id="layout-tour-use"
          data-track="dash.trial.use"
          disabled={!prefs}
          title={prefs ? undefined : NOT_READY_TIP}
          onClick={actions.useStep}
        >
          Use this one
        </Button>
        <Button id="layout-tour-next" data-track="dash.trial.next" onClick={actions.nextStep}>
          {trial ? nextLabel(trial) : 'Next'}
        </Button>
        <Button
          variant="quiet"
          id="layout-tour-stop"
          data-track="dash.trial.stop"
          onClick={actions.stopTrial}
        >
          Stop
        </Button>
      </div>
    </aside>
  );
}

/** The "During screen" group of the Advanced menu: Combat buttons, and the layout trial. */
export function DuringMenuItems({ during }: { during: DuringController }): JSX.Element {
  const { prefs, actions } = during;
  const on = prefs?.combatButtons === true;
  return (
    <>
      <AdvancedLabel>During screen</AdvancedLabel>
      <AdvancedItem
        disabled={!prefs}
        onSelect={() => {
          actions.toggleCombatButtons();
          // Nothing opens, so the focus goes back to the Advanced button.
          return false;
        }}
      >
        <Button
          id="btn-combat-buttons"
          className={on ? 'on' : undefined}
          data-track="dash.header.combat-buttons"
          disabled={!prefs}
          title={
            prefs
              ? "Damage / Heal, Condition and Clear on selected combatants in the turn-order strip. Off by default: dnd5e's chat cards already apply damage."
              : NOT_READY_TIP
          }
        >
          {`⚔ Combat buttons: ${on ? 'on' : 'off'}`}
        </Button>
      </AdvancedItem>
      <AdvancedItem onSelect={() => actions.startTrial()}>
        <Button
          id="btn-layout-tour"
          data-track="dash.header.layout-tour"
          title="Try the three During layouts on the real screen and keep one"
        >
          ▦ Try the During layouts
        </Button>
      </AdvancedItem>
    </>
  );
}
