// The three moments of the evening (D-085, PB-16): Before, During and After, as tabs in the header
// and one view each. The moment follows the play session (lib/session.ts); a tab click pins it.
// Panels dock in their view's slots (Drawer.tsx, DockContext); the ones not in React yet show a
// small card that points to the full dashboard. The look is the old page's moments.css.
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import type { DuringScreen } from '../lib/duringTrial';
import { usePlaySession, type PlaySession } from '../lib/session';

export type Moment = 'before' | 'during' | 'after';
export type DockName = 'preflight' | 'prep' | 'party' | 'handouts';

const ORDER: readonly Moment[] = ['before', 'during', 'after'];

/** The panels docked in each moment, as on the old page. Tarokka and the Tool runner never dock. */
export const DOCKS: Record<Moment, readonly DockName[]> = {
  before: ['preflight', 'prep'],
  during: ['handouts', 'party'],
  after: ['prep', 'handouts'],
};

/** After shows for this long after a session ended. */
export const AFTER_WINDOW_MS = 12 * 60 * 60 * 1000;

/** The moment the session asks for: During while open, After for 12 hours after the end. */
export function momentFromSession(session: PlaySession, now: number): Moment {
  if (session.open) return 'during';
  const ended = session.endedAt ? Date.parse(session.endedAt) : NaN;
  return Number.isFinite(ended) && now - ended <= AFTER_WINDOW_MS ? 'after' : 'before';
}

/**
 * The moment on screen: the one the GM picked with a tab, else the session's. Null until the
 * first answer, so a reload during a session does not show Before (and run its panels) first.
 * A failed read shows Before. The pick holds until a session starts or ends (the open flag
 * flips), or the page reloads.
 */
export function useMoment(): { moment: Moment | null; pick: (moment: Moment) => void } {
  const { session, failed, checkedAt } = usePlaySession();
  const [pinned, setPinned] = useState<Moment | null>(null);
  const open = session?.open;
  const [seenOpen, setSeenOpen] = useState(open);
  if (open !== seenOpen) {
    setSeenOpen(open);
    if (seenOpen !== undefined) setPinned(null);
  }
  // The time of the last poll (answered or failed), not the clock: each poll checks the 12 hours
  // again, also while the bridge is down.
  const fromSession = session ? momentFromSession(session, checkedAt) : failed ? 'before' : null;
  return { moment: pinned ?? fromSession, pick: setPinned };
}

type SlotKey = `${Moment}-${DockName}`;
const SLOT_KEYS: SlotKey[] = ORDER.flatMap(m => DOCKS[m].map(d => `${m}-${d}` as const));
type SlotRefs = Record<SlotKey, (el: HTMLElement | null) => void>;

/** The slot elements of the views, and the one each panel docks in for the moment on screen. */
export function useDocks(moment: Moment | null): {
  slotRefs: SlotRefs;
  dockOf: (name: DockName) => HTMLElement | null;
} {
  const [slots, setSlots] = useState<Partial<Record<SlotKey, HTMLElement>>>({});
  // Stable callbacks: React calls each once with the element and once with null on unmount.
  const slotRefs = useMemo(
    () =>
      Object.fromEntries(
        SLOT_KEYS.map(key => [
          key,
          (el: HTMLElement | null): void =>
            setSlots(s => (s[key] === (el ?? undefined) ? s : { ...s, [key]: el ?? undefined })),
        ])
      ) as SlotRefs,
    []
  );
  const dockOf = (name: DockName): HTMLElement | null =>
    moment && DOCKS[moment].includes(name) ? (slots[`${moment}-${name}`] ?? null) : null;
  return { slotRefs, dockOf };
}

/**
 * A moment change can take the focused element away (a docked panel leaves, or its view hides).
 * The focus then goes back to the same element if it is still on screen (a panel docked in both
 * moments moved with it), else to the tab of the new moment, never to the page body. Call it in
 * the component that renders the drawers, so it runs after they moved.
 */
export function useFocusAfterMoment(moment: Moment | null): void {
  // The element focused last, and whether it was in the views then (it may be gone now).
  const last = useRef<{ el: HTMLElement; inViews: boolean } | null>(null);
  useEffect(() => {
    const onFocus = (e: FocusEvent): void => {
      if (!(e.target instanceof HTMLElement)) return;
      last.current = { el: e.target, inViews: e.target.closest('#moment-views') !== null };
    };
    document.addEventListener('focusin', onFocus);
    return (): void => document.removeEventListener('focusin', onFocus);
  }, []);
  useLayoutEffect(() => {
    if (!moment) return;
    // A removed element hands the focus to the body; a hidden one may still hold it until the
    // browser's next rendering step.
    const active = document.activeElement;
    const lost =
      !active || active === document.body || (active as HTMLElement).closest('[hidden]') !== null;
    const prev = last.current;
    if (!lost || !prev?.inViews) return;
    if (prev.el.isConnected && !prev.el.closest('[hidden]')) prev.el.focus({ preventScroll: true });
    else document.getElementById(`tab-${moment}`)?.focus({ preventScroll: true });
  }, [moment]);
}

/**
 * The tabs in the header (the old nav#moments): a tablist with arrow keys, Home and End. A click
 * or a key pins the moment it picks.
 */
export function MomentTabs({
  moment,
  onPick,
}: {
  moment: Moment | null;
  onPick: (moment: Moment) => void;
}): JSX.Element {
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, from: Moment): void => {
    const i = ORDER.indexOf(from);
    const to =
      e.key === 'ArrowRight'
        ? ORDER[(i + 1) % ORDER.length]
        : e.key === 'ArrowLeft'
          ? ORDER[(i + ORDER.length - 1) % ORDER.length]
          : e.key === 'Home'
            ? ORDER[0]
            : e.key === 'End'
              ? ORDER[ORDER.length - 1]
              : undefined;
    if (!to) return;
    e.preventDefault();
    onPick(to);
    document.getElementById(`tab-${to}`)?.focus();
  };
  // Until the moment is known, the first tab takes the Tab key.
  const tab = (m: Moment): ComponentProps<'button'> => ({
    type: 'button',
    role: 'tab',
    id: `tab-${m}`,
    className: 'moment-tab',
    'aria-selected': moment === m,
    'aria-controls': `moment-${m}`,
    tabIndex: moment === m || (moment === null && m === 'before') ? 0 : -1,
    onClick: () => onPick(m),
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => onKeyDown(e, m),
  });
  return (
    <div className="moments" id="moments" role="tablist" aria-label="Moment of the evening">
      <button {...tab('before')} data-track="dash.moment.before">
        Before
      </button>
      <button {...tab('during')} data-track="dash.moment.during">
        During
      </button>
      <button {...tab('after')} data-track="dash.moment.after">
        After
      </button>
    </div>
  );
}

/** A slot whose panel is not in the new dashboard yet. */
function NotHereYet({ title, wide = false }: { title: string; wide?: boolean }): JSX.Element {
  return (
    <section
      className={wide ? 'pane not-here-yet not-here-yet-wide' : 'pane not-here-yet'}
      aria-label={title}
    >
      <div className="pane-head">
        <h2>{title}</h2>
      </div>
      <p className="not-here-yet-text">
        Not in the new dashboard yet. It is on the <a href="/">full dashboard</a>.
      </p>
    </section>
  );
}

/**
 * The three views (the old main#moment-views). All three stay in the page and the ones not on
 * screen are hidden, so the slots stay put and a panel docked in two moments only moves.
 */
export function MomentViews({
  moment,
  slotRefs,
  duringScreen,
  duringBar,
  beforeTop,
}: {
  moment: Moment | null;
  slotRefs: SlotRefs;
  /** What the During layouts ask of #moment-during (lib/duringTrial.ts); Cards when not given. */
  duringScreen?: DuringScreen;
  /** The During bar (components/During.tsx), the first row of the During view. */
  duringBar?: ReactNode;
  /** The layout trial's card, the first thing in Before. */
  beforeTop?: ReactNode;
}): JSX.Element {
  return (
    <main className="moment-views" id="moment-views" aria-busy={moment === null}>
      {moment === null && <p className="empty">Checking the play session…</p>}
      <section
        className="moment"
        id="moment-before"
        role="tabpanel"
        aria-labelledby="tab-before"
        hidden={moment !== 'before'}
      >
        {beforeTop}
        <div className="slot" data-slot="preflight" ref={slotRefs['before-preflight']} />
        <div className="slot" data-slot="prep" ref={slotRefs['before-prep']} />
        <NotHereYet title="Features" wide />
      </section>
      {/* The folds and the turn strip's rows come with their own panels. */}
      <section
        className={duringBar ? 'moment' : 'moment during-no-bar'}
        id="moment-during"
        role="tabpanel"
        aria-labelledby="tab-during"
        data-layout={duringScreen?.layout ?? 'layered'}
        data-context={duringScreen?.context}
        data-view={duringScreen?.view}
        hidden={moment !== 'during'}
      >
        {duringBar}
        <div className="slot slot-strip" data-slot="strip" />
        <div className="slot slot-feed" data-slot="feed">
          <NotHereYet title="Live Feed" />
        </div>
        <div className="slot slot-changes" data-slot="changes">
          <NotHereYet title="Recent Changes" />
        </div>
        <div
          className="slot slot-handouts"
          data-slot="handouts"
          ref={slotRefs['during-handouts']}
        />
        <div className="slot slot-party" data-slot="party" ref={slotRefs['during-party']} />
      </section>
      <section
        className="moment"
        id="moment-after"
        role="tabpanel"
        aria-labelledby="tab-after"
        hidden={moment !== 'after'}
      >
        <NotHereYet title="Tonight's stats and session notes" wide />
        <div className="slot" data-slot="prep" ref={slotRefs['after-prep']} />
        <div className="moment-side">
          <div className="slot" data-slot="handouts" ref={slotRefs['after-handouts']} />
          <div className="slot" data-slot="changes">
            <NotHereYet title="Recent Changes" />
          </div>
        </div>
      </section>
    </main>
  );
}
