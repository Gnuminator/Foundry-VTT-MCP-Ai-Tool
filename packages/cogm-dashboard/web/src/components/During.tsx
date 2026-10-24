// The During layouts (D-092, I-107), ported from the old page: the bar with the layout switch
// (Cards, Simple/Full, Auto), the quiet hint, the Before card and the guide of the layout trial,
// and the two "During screen" entries of the Advanced menu. The old page's moments.css lays the
// slots out per `data-layout`, `data-context` and `data-view` on #moment-during (Moments.tsx sets
// them); the choice is kept per world on the server (lib/prefs.ts), so either page shows it.
import { lazy, Suspense, useEffect, useRef, useState, type JSX } from 'react';
import { flushSync } from 'react-dom';

import { hasOpenPanel, hasOpenPopper } from '../lib/escape';
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

// The picker is a lazy chunk (bundle budget): it loads when the bar's Start combat is clicked.
const StartCombat = lazy(() => import('./StartCombat').then(m => ({ default: m.StartCombat })));

/** What the layout buttons say while the world (and so the saved choice) is not known yet. */
export const NOT_READY_TIP =
  'Your choice is saved for the world, which Foundry has not told the dashboard yet.';

const NOT_READY_BAR_ID = 'during-not-ready';
const NOT_READY_TOUR_ID = 'layout-tour-not-ready';
const NOT_READY_MENU_ID = 'combat-buttons-not-ready';

/** The reason the controls are off, in the page for screen readers (a disabled button gets no
 * tooltip, and the title is not read as its description everywhere). Only while not ready. */
function NotReadyNote({ id, show }: { id: string; show: boolean }): JSX.Element | null {
  return show ? (
    <span className="visually-hidden" id={id}>
      {NOT_READY_TIP}
    </span>
  ) : null;
}

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
  /** The version tracker switch (I-127); lives here because this controller owns the prefs. */
  toggleVersionTracker: () => void;
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
  // menu or a confirm window (the panels listed in escape.ts), or a popup such as a tooltip or a
  // popover (open in a Radix popper). Capture runs this before they close, so it still sees them
  // open.
  const savedLayout = useRef(prefs?.duringLayout);
  savedLayout.current = prefs?.duringLayout;
  useEffect(() => {
    if (!running) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || hasOpenPanel() || hasOpenPopper()) return;
      // The guide hides under the focus: move it on, as Use this one and Stop do.
      const inGuide = document.getElementById('layout-tour')?.contains(document.activeElement);
      setTrial(null);
      if (inGuide) focusAfterTrial(savedLayout.current);
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
    toggleVersionTracker: () => {
      void save({ versionTracker: prefs?.versionTracker !== true });
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
      // Off with aria-disabled, not disabled: the keyboard still lands on it and a screen reader
      // reads the reason, which is in the page (NotReadyNote), not only in the title.
      {...(ready ? {} : { 'aria-disabled': true, 'aria-describedby': NOT_READY_BAR_ID })}
      title={ready ? tip : NOT_READY_TIP}
      onClick={() => {
        if (ready) during.actions.pickLayout(layout);
      }}
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
  const settings = useDashboardSettings();
  const [picking, setPicking] = useState(false);
  // The strip has its own Start combat in the Full view; everywhere else with no fight, it is here.
  const startHere =
    settings?.gmActionsEnabled === true &&
    trial === null &&
    screen.context === 'calm' &&
    screen.view !== 'full';
  const pickerRow = useRef<HTMLDivElement>(null);
  const giveFocusBack = useRef(false);
  // The picker belongs to the button: when the button goes away (a fight began, Full, GM Actions
  // off), the next calm screen starts closed.
  useEffect(() => {
    if (!startHere) setPicking(false);
  }, [startHere]);
  // Focus follows the swap: into the picker when it opens (the list loads later), back onto the
  // button when it closes by the GM's hand.
  useEffect(() => {
    const row = pickerRow.current;
    if (picking && row) {
      const first = (): HTMLElement | null =>
        row.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled)');
      let focused = first();
      focused?.focus();
      // The loading row's Close button gives way to the list: when the focused control is
      // swapped out of the page, focus goes to the new first control. A click on empty page
      // leaves the control in place, so the focus is not pulled back.
      const watch = new MutationObserver(() => {
        if (focused?.isConnected) return;
        focused = first();
        focused?.focus();
      });
      watch.observe(row, { childList: true, subtree: true });
      return () => watch.disconnect();
    }
    if (!picking && giveFocusBack.current) {
      giveFocusBack.current = false;
      document.getElementById('btn-during-start-combat')?.focus();
    }
    return undefined;
  }, [picking]);
  return (
    <div className="during-bar" id="during-bar">
      <NotReadyNote id={NOT_READY_BAR_ID} show={prefs === undefined} />
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
      <Button
        variant="quiet"
        id="btn-layout-tour-bar"
        data-track="dash.during.layout-tour"
        hidden={trial !== null}
        title="Try the three layouts on the real screen, with a sample fight, and keep one"
        onClick={() => {
          // The button hides as the trial starts: keep the focus on the guide's Next button.
          flushSync(() => actions.startTrial());
          document.getElementById('layout-tour-next')?.focus();
        }}
      >
        Try layouts
      </Button>
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
      <span
        className="during-auto-note"
        id="during-auto-note"
        data-auto-pick={screen.context === 'combat' ? 'combat' : 'cards'}
        hidden={screen.layout !== 'auto'}
      >
        {autoNote(screen.context)}
      </span>
      {startHere && !picking && (
        <Button
          variant="quiet"
          id="btn-during-start-combat"
          data-track="dash.during.start-combat"
          onClick={() => setPicking(true)}
        >
          Start combat
        </Button>
      )}
      {startHere && picking && (
        <div className="during-start" ref={pickerRow}>
          <Suspense fallback={null}>
            <StartCombat
              onDismiss={() => {
                giveFocusBack.current = true;
                setPicking(false);
              }}
            />
          </Suspense>
        </div>
      )}
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
 * Where the focus goes when the guide closes under it (Use this one, Stop): the layout button on
 * the During bar, else the button that started the trial if it is still on screen, else the
 * Advanced button. Without this the focus drops to the page body.
 */
function focusAfterTrial(layout: DuringLayout | undefined): void {
  const visible = (el: Element | null): el is HTMLElement =>
    el instanceof HTMLElement && el.offsetParent !== null && !el.matches(':disabled');
  const targets = [
    layout ? document.querySelector(`.layout-switch [data-layout-pick="${layout}"]`) : null,
    document.getElementById('btn-layout-trial'),
    document.getElementById('btn-layout-tour-bar'),
    document.getElementById('btn-advanced'),
  ];
  targets.find(visible)?.focus();
}

/**
 * The trial's guide: a small card in the corner, never over the screen. It does not take the
 * focus when it opens; the step is announced from a live region that is always in the page (one
 * that appears together with its text is often not announced), and when Use this one or Stop
 * closes the guide the focus moves to the layout switch.
 */
export function LayoutTourGuide({ during }: { during: DuringController }): JSX.Element {
  const { trial, prefs, actions } = during;
  const step = trial ? TOUR[trial.step] : undefined;
  return (
    <>
      <p className="visually-hidden" id="layout-tour-live" aria-live="polite" aria-atomic="true">
        {trial && step ? `${stepLine(trial)}: ${step.title}` : ''}
      </p>
      <aside
        className="layout-tour"
        id="layout-tour"
        aria-label="Try the During layouts"
        hidden={!trial}
      >
        <p className="layout-tour-step" id="layout-tour-step">
          {trial ? stepLine(trial) : ''}
        </p>
        <h3 id="layout-tour-title">{step?.title}</h3>
        <p className="layout-tour-text" id="layout-tour-text">
          {step?.text}
        </p>
        <NotReadyNote id={NOT_READY_TOUR_ID} show={!prefs} />
        <div className="ready-actions">
          <Button
            className="lamp"
            id="layout-tour-use"
            data-track="dash.trial.use"
            title={prefs ? undefined : NOT_READY_TIP}
            {...(prefs ? {} : { 'aria-disabled': true, 'aria-describedby': NOT_READY_TOUR_ID })}
            onClick={() => {
              if (!prefs) return;
              const kept = step?.layout;
              actions.useStep();
              focusAfterTrial(kept);
            }}
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
            onClick={() => {
              actions.stopTrial();
              focusAfterTrial(prefs?.duringLayout);
            }}
          >
            Stop
          </Button>
        </div>
      </aside>
    </>
  );
}

/** The "During screen" group of the Advanced menu: Combat buttons, and the layout trial. */
export function DuringMenuItems({ during }: { during: DuringController }): JSX.Element {
  const { prefs, actions } = during;
  const on = prefs?.combatButtons === true;
  return (
    <>
      <AdvancedLabel>During screen</AdvancedLabel>
      <NotReadyNote id={NOT_READY_MENU_ID} show={!prefs} />
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
          {...(prefs ? {} : { 'aria-describedby': NOT_READY_MENU_ID })}
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
