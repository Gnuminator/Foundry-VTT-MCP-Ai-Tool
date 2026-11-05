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
}

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
    },
    markLost(): void {
      cancelTimer();
      lostShown = true;
    },
    reset(): void {
      cancelTimer();
      lostShown = false;
    },
  };
}
