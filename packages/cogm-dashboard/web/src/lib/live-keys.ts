// Live keys (item live-keys): one letter for the things the GM does most in a fight. The page
// listener only clicks the strip's own buttons, so a key opens exactly the confirm the button
// opens and never applies a write by itself. Pure rules here; the listener is in LiveStrip.

type LiveKey = 'next' | 'undo' | 'damage' | 'roll' | 'handout' | 'help';

/** What the keys do, in the order the sheet lists them. */
export const LIVE_KEYS: ReadonlyArray<{ key: string; action: LiveKey; text: string }> = [
  { key: 'N', action: 'next', text: 'Next turn' },
  { key: 'U', action: 'undo', text: 'Undo the last change' },
  { key: 'D', action: 'damage', text: 'Damage or heal (jumps to the amount)' },
  { key: 'R', action: 'roll', text: 'Ask the party to roll' },
  { key: 'H', action: 'handout', text: 'Show the next handout' },
  { key: '?', action: 'help', text: 'This list' },
];

/** The slice of a keyboard event the rules read. */
export interface KeyLike {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
  repeat?: boolean;
}

/** True when the key goes to a field the GM is typing in. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el?.tagName) return false;
  const tag = el.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

/**
 * The action a key press asks for, or null. No action while typing, with Ctrl, Alt or Meta held
 * (browser and Foundry shortcuts keep working), on a held key, or while another dialog is open.
 */
export function liveKeyAction(
  event: KeyLike,
  target: EventTarget | null,
  dialogOpen: boolean
): LiveKey | null {
  if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing || event.repeat) {
    return null;
  }
  if (isTypingTarget(target) || dialogOpen) return null;
  switch (event.key.toLowerCase()) {
    case 'n':
      return 'next';
    case 'u':
      return 'undo';
    case 'd':
      return 'damage';
    case 'r':
      return 'roll';
    case 'h':
      return 'handout';
    case '?':
      return 'help';
    default:
      return null;
  }
}

/** The element each action presses; the strip's buttons carry their own off and confirm rules. */
export const LIVE_KEY_TARGET: Record<Exclude<LiveKey, 'help' | 'damage'>, string> = {
  next: 'live-next-turn',
  undo: 'live-undo',
  roll: 'live-roll-party',
  handout: 'live-show-handout',
};
