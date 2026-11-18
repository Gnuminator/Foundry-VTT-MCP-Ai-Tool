/**
 * Stingers on the table TV (I-176): a natural 20 or 1 on an attack or saving throw flashes a
 * short overlay on the Table user's screen only (the TV, see table-viewer-user.ts). The GM
 * setting turns it off or limits it to natural 20s; at most one every 20 seconds.
 */
import { MODULE_ID } from './constants.js';
import { dnd5eRollType } from './systems/dnd5e/chat-roll-kind.js';
import {
  DEFAULT_STINGER_MODE,
  parseStingerMode,
  planStinger,
  STINGER_SHOW_MS,
  stingerText,
  type StingerKind,
  type StingerMessage,
  type StingerMode,
} from './stinger-model.js';
import { isTableViewerUser } from './table-viewer-user.js';

/** World setting: off, natural 20s only, or natural 20s and 1s. */
const STINGER_SETTING = 'tvStingers';

let lastAt: number | null = null;

/** Longest wait for Dice So Nice to finish before the stinger shows anyway. */
const DICE_WAIT_MS = 6000;

/** Register the setting. Call from the module `init` hook, every client. */
export function registerStingerSettings(): void {
  game.settings.register(MODULE_ID, STINGER_SETTING, {
    name: 'Table TV stingers',
    hint: 'A natural 20 or 1 on an attack or saving throw flashes a short overlay on the Table TV user only. At most one every 20 seconds.',
    scope: 'world',
    config: true,
    type: String,
    default: DEFAULT_STINGER_MODE,
    choices: {
      both: 'Natural 20s and natural 1s',
      crits: 'Natural 20s only',
      off: 'Off',
    },
  });
}

function currentMode(): StingerMode {
  try {
    return parseStingerMode(game.settings.get(MODULE_ID, STINGER_SETTING));
  } catch {
    return DEFAULT_STINGER_MODE;
  }
}

function showStinger(kind: StingerKind, who: string): void {
  if (typeof document === 'undefined') return;
  const { big, small } = stingerText(kind, who);
  const el = document.createElement('div');
  el.className = `fmb-stinger fmb-stinger-${kind}`;
  const b = document.createElement('div');
  b.className = 'fmb-stinger-big';
  b.textContent = big;
  const s = document.createElement('div');
  s.className = 'fmb-stinger-small';
  s.textContent = small;
  el.append(b, s);
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), STINGER_SHOW_MS);
}

/** A chat message arrived: flash a stinger when it is a natural 20 or 1 and the TV may show it. */
function onStingerMessage(message: unknown, now: number = Date.now()): void {
  try {
    const plan = planStinger(message as StingerMessage, {
      isTableUser: isTableViewerUser(game.user),
      mode: currentMode(),
      rollType: dnd5eRollType(message as Parameters<typeof dnd5eRollType>[0]),
      now,
      lastAt,
    });
    if (!plan) return;
    lastAt = now;
    const { kind, who } = plan;
    const id = (message as { id?: string }).id;
    // Dice So Nice shows the 3D dice after the message exists: wait for them to stop so the
    // stinger does not give the result away (a fallback timer covers a roll it never animates).
    if (id && (game as unknown as { dice3d?: unknown }).dice3d) {
      let done = false;
      const hookId: number = Hooks.on('diceSoNiceRollComplete', (rolledId: unknown) => {
        if (rolledId === id) go();
      });
      const go = (): void => {
        if (done) return;
        done = true;
        Hooks.off('diceSoNiceRollComplete', hookId);
        showStinger(kind, who);
      };
      window.setTimeout(go, DICE_WAIT_MS);
      return;
    }
    showStinger(kind, who);
  } catch (error) {
    console.warn(`[${MODULE_ID}] Stinger failed:`, error);
  }
}

/** Hook the chat on this client. Call at `ready`, every client (it acts for the TV user only). */
export function startStingers(): void {
  Hooks.on('createChatMessage', (message: unknown) => onStingerMessage(message));
}
