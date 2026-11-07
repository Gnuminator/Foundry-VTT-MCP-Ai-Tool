/**
 * Plain-words toasts for the GM when the bridge link drops and when it is back.
 *
 * The socket bridge reports every up and down; this decides what the GM sees.
 * A short drop (the backend restarting, a Wi-Fi blip) says nothing. A drop that
 * lasts past the grace period gets one "lost" toast, and only then does the
 * return get a "back" toast. A link that flaps never shows two toasts of the
 * same kind within the throttle window. Players never see these: `isGM` gates
 * everything, and the link is only held by the bridge user anyway.
 */

export const LINK_LOST_TOAST =
  'Lost the link to the AI Tool, so Claude cannot reach Foundry right now.';
export const LINK_BACK_TOAST = 'The AI Tool link is back. Claude can reach Foundry again.';

/** A drop shorter than this is not worth a toast. */
export const LINK_GRACE_MS = 10_000;
/** The same toast never shows twice within this window. */
export const LINK_TOAST_THROTTLE_MS = 60_000;

export interface LinkNotifierOptions {
  /** Shows a toast. */
  notify: (message: string, level: 'warn' | 'info') => void;
  /** True only for a GM; false means never toast. */
  isGM: () => boolean;
  /** The "Show connection messages" setting. */
  enabled: () => boolean;
  graceMs?: number;
  throttleMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /**
   * Called when this notifier decides the link is lost (`'lost'`), is back (`'up'`) or was stopped
   * on purpose after a "lost" (`'quiet'`), so other GM browsers can be told. Runs only where a toast
   * would show (GM, "Show connection messages" on).
   */
  publish?: (state: LinkRelayStateName) => void;
}

export type LinkRelayStateName = 'lost' | 'up' | 'quiet';

export interface LinkNotifier {
  /** The link opened. */
  up(): void;
  /** An open link was lost (not a failed retry). */
  down(): void;
  /**
   * The link never opened and the GM was already told so by another message: owe the "back"
   * toast for when it does open, without a "lost" toast of its own.
   */
  markLost(): void;
  /** The owner stopped the link on purpose: forget everything, say nothing. */
  reset(): void;
}

export function createLinkNotifier(options: LinkNotifierOptions): LinkNotifier {
  const graceMs = options.graceMs ?? LINK_GRACE_MS;
  const throttleMs = options.throttleMs ?? LINK_TOAST_THROTTLE_MS;
  const now = options.now ?? ((): number => Date.now());
  const setTimer = options.setTimer ?? ((fn, ms): unknown => setTimeout(fn, ms));
  const clearTimer =
    options.clearTimer ?? ((h): void => clearTimeout(h as ReturnType<typeof setTimeout>));

  let timer: unknown = null;
  /** True once a "lost" toast was shown and the "back" toast is still owed. */
  let lostShown = false;
  let lastLostAt = -Infinity;

  const allowed = (): boolean => options.isGM() && options.enabled();

  /** Wait `ms`, then show "lost"; inside the throttle window wait out the rest of it (the link is still down). */
  function arm(ms: number): void {
    timer = setTimer(() => {
      timer = null;
      const wait = throttleMs - (now() - lastLostAt);
      if (wait > 0) {
        arm(wait);
        return;
      }
      if (!allowed()) return;
      lostShown = true;
      lastLostAt = now();
      options.notify(LINK_LOST_TOAST, 'warn');
      options.publish?.('lost');
    }, ms);
  }

  function cancelTimer(): void {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  return {
    down(): void {
      if (timer !== null || lostShown) return;
      arm(graceMs);
    },
    up(): void {
      cancelTimer();
      if (!lostShown) return;
      // A "back" is only owed after a "lost" that was shown, and "lost" is throttled,
      // so pairs stay at one per window and the last toast never contradicts the link.
      lostShown = false;
      if (!allowed()) return;
      options.notify(LINK_BACK_TOAST, 'info');
      options.publish?.('up');
    },
    markLost(): void {
      cancelTimer();
      lostShown = true;
      if (allowed()) options.publish?.('lost');
    },
    reset(): void {
      cancelTimer();
      const wasLost = lostShown;
      lostShown = false;
      // Other GM browsers were told "lost": tell them it ended without a "back" toast.
      if (wasLost && allowed()) options.publish?.('quiet');
    },
  };
}

/** What the link holder stores in the `linkState` world setting. */
export interface LinkRelayState {
  state: LinkRelayStateName;
  /** Milliseconds since the epoch; makes every write a real change so the hook fires. */
  at: number;
}

/** Reads a stored value; anything unexpected counts as "up" (say nothing). */
export function parseLinkRelayState(value: unknown): LinkRelayState {
  const v = value as Partial<LinkRelayState> | null | undefined;
  if (
    v &&
    (v.state === 'lost' || v.state === 'up' || v.state === 'quiet') &&
    typeof v.at === 'number'
  ) {
    return { state: v.state, at: v.at };
  }
  return { state: 'up', at: 0 };
}

export interface LinkRelayReceiverOptions {
  notify: (message: string, level: 'warn' | 'info') => void;
  isGM: () => boolean;
  /** The "Show connection messages" setting. */
  enabled: () => boolean;
  /** True in the browser that holds the link itself: its own notifier already speaks. */
  holdsLink: () => boolean;
  throttleMs?: number;
  now?: () => number;
}

export interface LinkRelayReceiver {
  /** A new stored state arrived (a change, or the current value when this GM joined). */
  apply(state: LinkRelayState): void;
}

/**
 * The other GMs' side of the relay. The link holder already waited out the grace period, so this
 * shows at once; it keeps the same throttle, the same setting gate and no toast for players.
 */
export function createLinkRelayReceiver(options: LinkRelayReceiverOptions): LinkRelayReceiver {
  const throttleMs = options.throttleMs ?? LINK_TOAST_THROTTLE_MS;
  const now = options.now ?? ((): number => Date.now());
  let lostShown = false;
  let lastLostAt = -Infinity;
  return {
    apply(state): void {
      if (state.state === 'quiet') {
        lostShown = false;
        return;
      }
      if (!options.isGM() || options.holdsLink()) return;
      if (state.state === 'lost') {
        if (lostShown || now() - lastLostAt < throttleMs) return;
        if (!options.enabled()) return;
        lostShown = true;
        lastLostAt = now();
        options.notify(LINK_LOST_TOAST, 'warn');
        return;
      }
      if (!lostShown) return;
      lostShown = false;
      if (options.enabled()) options.notify(LINK_BACK_TOAST, 'info');
    },
  };
}
