// Table at a glance (item dashboard-glance-view): the rules of the /?glance=1 screen as plain data
// and functions, so they have unit tests. components/GlanceScreen.tsx draws them. GM only: the
// numbers are exact HP and hidden-token data from the GM's own routes, and a player is sent to
// the player view before this page loads (lib/role.ts).
import { hpPercent, hpTone, hpText, type CombatState } from './combat';

export { GLANCE_HREF } from './liveScreen';

/** How often the party and the scene are read again; the fight comes over the live stream. */
export const GLANCE_REFRESH_MS = 15_000;

/** A panel older than this is marked old. */
export const GLANCE_OLD_MS = 45_000;

/** "just now", "12 s ago", "3 min ago": how old a panel's data is. */
export function ageText(updatedAt: number | null, now: number): string {
  if (updatedAt === null) return 'not loaded yet';
  const s = Math.max(0, Math.round((now - updatedAt) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

/** Whether a panel's data is old enough to warn about. */
export function isOld(updatedAt: number | null, now: number): boolean {
  return updatedAt === null || now - updatedAt > GLANCE_OLD_MS;
}

export interface PartyRow {
  id: string;
  name: string;
  /** "12/40", plus " +5" with temporary hit points; a dash with no hit points. */
  hp: string;
  percent: number;
  tone: 'low' | 'mid' | '';
  down: boolean;
  conditions: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * The player characters of the primary party (get-party, GM only), one row each, with exhaustion
 * counted as a condition. Anything the bridge sent in another shape is skipped, not guessed.
 */
export function partyRows(raw: unknown): PartyRow[] {
  if (!isRecord(raw) || !Array.isArray(raw['groups'])) return [];
  const group = raw['groups'].find(isRecord);
  if (!group || !Array.isArray(group['members'])) return [];
  const rows: PartyRow[] = [];
  for (const m of group['members']) {
    if (!isRecord(m) || typeof m['name'] !== 'string') continue;
    const hp = isRecord(m['hp'])
      ? { value: num(m['hp']['value']), max: num(m['hp']['max']), temp: num(m['hp']['temp']) }
      : null;
    const conditions = Array.isArray(m['conditions'])
      ? m['conditions'].filter((c): c is string => typeof c === 'string')
      : [];
    const exhaustion = num(m['exhaustion']);
    if (exhaustion > 0) conditions.push(`Exhaustion ${exhaustion}`);
    rows.push({
      id: typeof m['actorId'] === 'string' ? m['actorId'] : m['name'],
      name: m['name'],
      hp: hp ? hpText(hp) : '–',
      percent: hp ? hpPercent(hp) : 0,
      tone: hp ? hpTone(hp) : '',
      down: hp !== null && hp.max > 0 && hp.value <= 0,
      conditions,
    });
  }
  return rows;
}

export interface CombatRow {
  id: string;
  name: string;
  initiative: number | null;
  current: boolean;
  defeated: boolean;
  /** 'pc', 'npc' or 'enemy'. */
  side: string;
  hp: string;
  percent: number;
  tone: 'low' | 'mid' | '';
  conditions: string[];
}

/** The fight in turn order, or null when none runs. */
export function combatRows(combat: CombatState | null): CombatRow[] | null {
  if (!combat?.active) return null;
  return combat.combatants.map(c => ({
    id: c.id,
    name: c.name,
    initiative: c.initiative,
    current: c.isCurrentTurn,
    defeated: c.defeated,
    side: c.isPC ? 'pc' : c.category === 'enemy' ? 'enemy' : 'npc',
    hp: hpText(c.hp),
    percent: hpPercent(c.hp),
    tone: hpTone(c.hp),
    conditions: c.conditions,
  }));
}

/** "Round 2, Brenna's turn", or an empty string with no fight. */
export function turnLine(combat: CombatState | null): string {
  if (!combat?.active) return '';
  const who = combat.combatants.find(c => c.isCurrentTurn)?.name;
  return who ? `Round ${combat.round}, ${who}'s turn` : `Round ${combat.round}`;
}

/** The scene's name from get-current-scene; null when the answer has none. */
export function sceneName(raw: unknown): string | null {
  return isRecord(raw) && typeof raw['name'] === 'string' && raw['name'] !== ''
    ? raw['name']
    : null;
}
