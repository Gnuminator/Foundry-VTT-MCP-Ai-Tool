/**
 * Stingers on the table TV (I-176): what a chat message's roll counts as (a natural 20, a natural
 * 1 or nothing), what the GM setting lets through, and the cool-down. Pure, no Foundry globals.
 */

/** World setting values: no stingers, only natural 20s, or natural 20s and 1s. */
export type StingerMode = 'off' | 'crits' | 'both';

export type StingerKind = 'crit' | 'fumble';

const STINGER_MODES: readonly StingerMode[] = ['off', 'crits', 'both'];
export const DEFAULT_STINGER_MODE: StingerMode = 'both';

/** Never more than one stinger in this time, whatever the rolls. */
export const STINGER_COOLDOWN_MS = 20000;

/** How long one stinger stays on screen. */
export const STINGER_SHOW_MS = 2000;

export function parseStingerMode(value: unknown): StingerMode {
  return STINGER_MODES.find(m => m === value) ?? DEFAULT_STINGER_MODE;
}

/** Only attack rolls and saving throws get a stinger (not checks, damage or death saves). */
function isStingerRollType(rollType: string): boolean {
  return rollType === 'attack' || rollType === 'save';
}

interface DieLike {
  faces?: unknown;
  results?: unknown;
}

/**
 * The natural result of the first d20 that counted in the first roll: kept dice only (a dropped
 * die of advantage or disadvantage does not count). Null when there is no d20.
 */
export function naturalD20(rolls: unknown): number | null {
  if (!Array.isArray(rolls)) return null;
  const roll = rolls[0] as { dice?: unknown } | undefined;
  const dice = Array.isArray(roll?.dice) ? (roll?.dice as DieLike[]) : [];
  for (const die of dice) {
    if (die?.faces !== 20 || !Array.isArray(die.results)) continue;
    for (const r of die.results as Array<{ result?: unknown; active?: unknown }>) {
      if (r?.active === false) continue;
      if (typeof r?.result === 'number') return r.result;
    }
  }
  return null;
}

/** What a roll is worth a stinger as, for this mode. */
export function stingerFor(
  mode: StingerMode,
  rollType: string,
  rolls: unknown
): StingerKind | null {
  if (mode === 'off' || !isStingerRollType(rollType)) return null;
  const natural = naturalD20(rolls);
  if (natural === 20) return 'crit';
  if (natural === 1 && mode === 'both') return 'fumble';
  return null;
}

/** True when enough time has passed since the last stinger (or there was none). */
export function cooldownOver(now: number, lastAt: number | null): boolean {
  return lastAt === null || now - lastAt >= STINGER_COOLDOWN_MS;
}

/** The big word and the small line under it. */
export function stingerText(kind: StingerKind, who: string): { big: string; small: string } {
  const name = who.trim();
  return kind === 'crit'
    ? { big: 'CRITICAL!', small: name ? `${name} rolled a natural 20` : 'A natural 20' }
    : { big: 'FUMBLE!', small: name ? `${name} rolled a natural 1` : 'A natural 1' };
}
