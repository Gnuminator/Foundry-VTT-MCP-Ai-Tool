/**
 * The Tarokka flip ceremony, on every client's screen: when the GM flips a card the screen dims,
 * the card turns over slowly with a sound, the GM's line fades in under it, and after a few
 * seconds it all fades away. The reading stays in the table window and on the player page.
 *
 * Pure parts (what to show) are in tarokka-table-model.ts. This file is the browser glue: one
 * overlay element, one sound. The sound is the world file set in the module settings, or a soft
 * chime made with Web Audio when none is set, so the module ships no audio.
 */
import { MODULE_ID } from './constants.js';
import { renderCeremonyHtml, safeImage, type Ceremony } from './tarokka-table-model.js';

/** World setting: an optional audio file played when a card turns over. */
export const FLIP_SOUND_SETTING = 'tarokkaFlipSound';

/** Total time on screen: the turn takes 3.2 s, the line fades in after it, then all fades out. */
const HOLD_MS = 11000;
const FADE_MS = 1200;

let current: { el: HTMLElement; timer: number; cardId: string } | null = null;

/** Escape closes the overlay. Added while one is on screen, removed when it goes. */
function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') endCeremony();
}

/** Register the optional sound setting. Call from the module `init` hook, every client. */
export function registerCeremonySettings(): void {
  game.settings.register(MODULE_ID, FLIP_SOUND_SETTING, {
    name: 'Tarokka card flip sound',
    hint: 'An audio file played on every screen when the GM flips a Tarokka card. Leave empty for a soft built-in chime.',
    scope: 'world',
    config: true,
    type: String,
    default: '',
    filePicker: 'audio',
  });
}

function soundPath(): string | null {
  try {
    return safeImage(game.settings.get(MODULE_ID, FLIP_SOUND_SETTING));
  } catch {
    return null;
  }
}

/** A low, slow bell with a rising shimmer under it, about three seconds. */
function playChime(): void {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    // A browser keeps a new context suspended until the page has had a click or key press.
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.25, now + 0.6);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 3.6);
    master.connect(ctx.destination);
    for (const [freq, delay] of [
      [196, 0],
      [293.66, 1.4],
      [392, 2.2],
    ] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.6, now + delay + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 1.8);
      osc.connect(gain).connect(master);
      osc.start(now + delay);
      osc.stop(now + delay + 2);
    }
    window.setTimeout(() => void ctx.close(), 4500);
  } catch {
    // Sound is a bonus: a browser that blocks audio still gets the picture.
  }
}

async function playSound(): Promise<void> {
  const src = soundPath();
  if (src) {
    try {
      const audio = (
        foundry as unknown as {
          audio?: { AudioHelper?: { play(data: object, push?: boolean): Promise<unknown> } };
        }
      ).audio?.AudioHelper;
      if (audio) {
        await audio.play({ src, volume: 0.8, autoplay: true, loop: false }, false);
        return;
      }
    } catch {
      // Fall through to the built-in chime.
    }
  }
  playChime();
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/**
 * The GM's line reached the table after the card turned (another GM client wrote the flip first):
 * add it to the ceremony that is on screen for that card. Does nothing when there is none.
 */
export function addCeremonyLine(cardId: string, line: string): void {
  if (current?.cardId !== cardId) return;
  const stage = current.el.querySelector('.fmb-tt-cer-stage');
  if (!stage || stage.querySelector('.fmb-tt-cer-line')) return;
  const p = document.createElement('p');
  p.className = 'fmb-tt-cer-line';
  p.textContent = line;
  stage.appendChild(p);
}

/** Remove the overlay now (a click, a newer flip, or the end of the show). */
export function endCeremony(): void {
  if (!current) return;
  const { el, timer } = current;
  current = null;
  window.clearTimeout(timer);
  document.removeEventListener('keydown', onKeyDown);
  el.classList.add('fmb-tt-cer-out');
  window.setTimeout(() => el.remove(), FADE_MS);
}

/** Show the ceremony for a flipped card on this client. One at a time; a newer flip replaces it. */
export function playCeremony(ceremony: Ceremony): void {
  if (typeof document === 'undefined') return;
  if (current) {
    current.el.remove();
    window.clearTimeout(current.timer);
    document.removeEventListener('keydown', onKeyDown);
    current = null;
  }
  const el = document.createElement('div');
  el.className = `fmb-tt-ceremony${reducedMotion() ? ' fmb-tt-cer-still' : ''}`;
  el.innerHTML = renderCeremonyHtml(ceremony);
  el.addEventListener('click', () => endCeremony());
  document.body.appendChild(el);
  document.addEventListener('keydown', onKeyDown);
  const timer = window.setTimeout(() => endCeremony(), HOLD_MS);
  current = { el, timer, cardId: ceremony.cardId };
  void playSound();
}
