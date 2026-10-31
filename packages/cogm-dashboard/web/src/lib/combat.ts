// The combat strip's rules (D-092, I-070, I-095), as plain data and functions: how a fight reads
// off the stream, which side a combatant is on, which rows get a reaction button, the boss
// prompts, the hit point bar, when the action bar shows, and when the strip is out of date. No
// React here, so the rules have unit tests; components/CombatStrip.tsx does the rest.
//
// Three things differ from the old page, on purpose: the reaction button shows only on a living
// boss (the old page gave every combatant one once Boss prompts was on, with no way to switch it
// off in a fight without a boss), a fight is marked old when the bridge is away (the old page
// kept showing it as live), and a fight with nobody in it says so.

export interface CombatantHp {
  value: number;
  max: number;
  temp: number;
}

/** A `{max, spent}` counter the bridge sends; `remaining` is `max - spent`. */
export interface BossCounter {
  max: number;
  spent: number;
  remaining: number;
}

/** An NPC's legendary actions, legendary resistances and lair (get-combat-state, GM only). */
export interface BossResources {
  legendary: BossCounter | null;
  resistances: BossCounter | null;
  /** `inside`: dnd5e's "in its lair" box; `initiative`: the lair's count (null means 20). */
  lair: { inside: boolean; initiative: number | null } | null;
}

export interface Combatant {
  id: string;
  name: string;
  initiative: number | null;
  isCurrentTurn: boolean;
  hp: CombatantHp;
  conditions: string[];
  /** Rounds left on the timed conditions, by name (0 = time is up); empty from an older module. */
  timed?: Record<string, unknown>;
  isPC: boolean;
  /** 'pc', 'npc' or 'enemy'. */
  category: string;
  defeated: boolean;
  deathSaves: { successes: number; failures: number } | null;
  boss: BossResources | null;
  /** The combatant's token (null from an older module or the sample fight): what a plan targets. */
  tokenId: string | null;
  /** The token's uuid (null from an older module): what the ribbon pans to. */
  tokenUuid: string | null;
  /** The token's image address (null from an older module or with no image): the ribbon portrait. */
  img: string | null;
}

/** The fight the stream last reported (`combat`, GM only). Combatants are in the bridge's order. */
export interface CombatState {
  active: boolean;
  round: number;
  turn: number;
  current: Combatant | null;
  combatants: Combatant[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

function readCounter(v: unknown): BossCounter | null {
  if (!isRecord(v)) return null;
  const max = num(v['max'], 0);
  const spent = num(v['spent'], 0);
  return { max, spent, remaining: num(v['remaining'], Math.max(0, max - spent)) };
}

function readBoss(v: unknown): BossResources | null {
  if (!isRecord(v)) return null;
  const lair = v['lair'];
  return {
    legendary: readCounter(v['legendary']),
    resistances: readCounter(v['resistances']),
    lair: isRecord(lair)
      ? {
          inside: lair['inside'] === true,
          initiative: typeof lair['initiative'] === 'number' ? lair['initiative'] : null,
        }
      : null,
  };
}

function readCombatant(v: unknown): Combatant | null {
  if (!isRecord(v) || typeof v['id'] !== 'string' || typeof v['name'] !== 'string') return null;
  const hp = isRecord(v['hp']) ? v['hp'] : {};
  const saves = isRecord(v['deathSaves']) ? v['deathSaves'] : null;
  return {
    id: v['id'],
    name: v['name'],
    initiative: typeof v['initiative'] === 'number' ? v['initiative'] : null,
    isCurrentTurn: v['isCurrentTurn'] === true,
    hp: { value: num(hp['value'], 0), max: num(hp['max'], 0), temp: num(hp['temp'], 0) },
    conditions: Array.isArray(v['conditions'])
      ? v['conditions'].filter((c): c is string => typeof c === 'string')
      : [],
    timed: isRecord(v['timed']) ? v['timed'] : {},
    isPC: v['isPC'] === true,
    category: typeof v['category'] === 'string' ? v['category'] : 'npc',
    defeated: v['defeated'] === true,
    deathSaves: saves
      ? { successes: num(saves['successes'], 0), failures: num(saves['failures'], 0) }
      : null,
    boss: readBoss(v['boss']),
    tokenId: typeof v['tokenId'] === 'string' && v['tokenId'] ? v['tokenId'] : null,
    tokenUuid: typeof v['tokenUuid'] === 'string' && v['tokenUuid'] ? v['tokenUuid'] : null,
    img: typeof v['img'] === 'string' && /^https?:\/\//i.test(v['img']) ? v['img'] : null,
  };
}

/** The `combat` of a stream event: a fight that runs, or null (no fight, or nothing readable). */
export function readCombat(raw: unknown): CombatState | null {
  if (!isRecord(raw) || raw['active'] !== true) return null;
  const combatants = Array.isArray(raw['combatants'])
    ? raw['combatants'].map(readCombatant).filter((c): c is Combatant => c !== null)
    : [];
  return {
    active: true,
    round: num(raw['round'], 0),
    turn: num(raw['turn'], 0),
    current: readCombatant(raw['current']),
    combatants,
  };
}

/** The dash shown where there is no value (no initiative, no fight). Built from its code point. */
export const NO_VALUE = String.fromCharCode(0x2014);

// --- One row ---------------------------------------------------------------------------------

export type Side = 'pc' | 'enemy' | 'npc';

export const SIDE_LABEL: Record<Side, string> = { pc: 'PC', enemy: 'Enemy', npc: 'NPC' };

export function sideOf(c: Pick<Combatant, 'isPC' | 'category'>): Side {
  if (c.isPC) return 'pc';
  return c.category === 'enemy' ? 'enemy' : 'npc';
}

/** The hit point bar's fill, 0 to 100 (a combatant with no maximum shows empty). */
export function hpPercent(hp: Pick<CombatantHp, 'value' | 'max'>): number {
  if (hp.max <= 0) return 0;
  return Math.max(0, Math.min(100, (hp.value / hp.max) * 100));
}

/** The fill's colour class: `low` at a third or less, `mid` at two thirds or less. */
export function hpTone(hp: Pick<CombatantHp, 'value' | 'max'>): 'low' | 'mid' | '' {
  const ratio = hp.max > 0 ? hp.value / hp.max : 0;
  if (ratio <= 0.33) return 'low';
  if (ratio <= 0.66) return 'mid';
  return '';
}

/** "12/40", plus " +5" with temporary hit points. */
export function hpText(hp: CombatantHp): string {
  return `${hp.value}/${hp.max}${hp.temp ? ` +${hp.temp}` : ''}`;
}

/** What the bar says in words: "12 of 40 hit points, 5 temporary". */
export function hpWords(hp: CombatantHp): string {
  return `${hp.value} of ${hp.max} hit points${hp.temp ? `, ${hp.temp} temporary` : ''}`;
}

/** Death saves show at zero hit points or less, once the bridge sends them. */
export function showDeathSaves(c: Pick<Combatant, 'hp' | 'deathSaves'>): boolean {
  return c.deathSaves !== null && c.hp.value <= 0;
}

export function deathSavesWords(saves: { successes: number; failures: number }): string {
  const s = saves.successes;
  const f = saves.failures;
  return `${s} ${s === 1 ? 'success' : 'successes'}, ${f} ${f === 1 ? 'failure' : 'failures'}`;
}

/** "Round 2 · 4 combatants" while a fight runs, a dash otherwise. */
export function metaText(combat: CombatState | null): string {
  if (!combat) return NO_VALUE;
  const n = combat.combatants.length;
  return `Round ${combat.round} · ${n} ${n === 1 ? 'combatant' : 'combatants'}`;
}

// --- Boss prompts ----------------------------------------------------------------------------

/** A boss has legendary actions or a lair. Resistances alone do not make one. */
export function isBoss(c: Pick<Combatant, 'boss'>): boolean {
  const b = c.boss;
  if (!b) return false;
  return (b.legendary !== null && b.legendary.max > 0) || b.lair !== null;
}

/** The bosses still standing. */
export function livingBosses(combat: CombatState | null): Combatant[] {
  return combat ? combat.combatants.filter(c => isBoss(c) && !c.defeated) : [];
}

/** Whether the Boss prompts switch shows: in a fight, when the flag is on or a boss is in it. */
export function showBossToggle(flagOn: boolean, combat: CombatState | null): boolean {
  return combat !== null && (flagOn || livingBosses(combat).length > 0);
}

/** Whether a row gets the reaction button: Boss prompts on, and a boss that is still up. */
export function showReaction(flagOn: boolean, c: Pick<Combatant, 'boss' | 'defeated'>): boolean {
  return flagOn && isBoss(c) && !c.defeated;
}

/** A counter as pips: "◆◆◇" with 2 of 3 left. */
export interface Pips {
  filled: string;
  empty: string;
  remaining: number;
  max: number;
}

function pips(counter: BossCounter): Pips {
  return {
    filled: '◆'.repeat(Math.max(0, counter.remaining)),
    empty: '◇'.repeat(Math.max(0, counter.max - counter.remaining)),
    remaining: counter.remaining,
    max: counter.max,
  };
}

/** The line under a boss's name: legendary actions, legendary resistances and the lair. */
export interface BossLine {
  legendary: Pips | null;
  resistances: Pips | null;
  /** "in lair" or "lair"; null without one. */
  lair: string | null;
}

/** The row's boss line, or null when Boss prompts is off or it has nothing to say. */
export function bossLine(flagOn: boolean, c: Pick<Combatant, 'boss'>): BossLine | null {
  const b = c.boss;
  if (!flagOn || !b) return null;
  const line: BossLine = {
    legendary: b.legendary ? pips(b.legendary) : null,
    resistances: b.resistances ? pips(b.resistances) : null,
    lair: b.lair ? (b.lair.inside ? 'in lair' : 'lair') : null,
  };
  return line.legendary || line.resistances || line.lair ? line : null;
}

export interface BossPrompt {
  kind: 'lair' | 'legendary';
  /** A key: the boss's id and the kind. */
  key: string;
  icon: string;
  text: string;
}

/**
 * The combatant whose turn the lair action comes before: the first below the lair's count. This
 * reads the bridge's order, which is turn order; nothing on the server sorts it.
 */
export function lairTurnIndex(combatants: readonly Combatant[], count: number): number {
  const i = combatants.findIndex(c => c.initiative === null || c.initiative < count);
  return i === -1 ? 0 : i;
}

/** The reminders for the turn on screen: a lair action, and legendary actions left. */
export function bossPrompts(combat: CombatState | null): BossPrompt[] {
  const bosses = livingBosses(combat);
  if (!combat || bosses.length === 0) return [];
  const current = combat.combatants[combat.turn] ?? combat.current;
  const lines: BossPrompt[] = [];
  for (const b of bosses) {
    const lair = b.boss?.lair;
    if (!lair || !(lair.inside || typeof lair.initiative === 'number')) continue;
    const count = typeof lair.initiative === 'number' ? lair.initiative : 20;
    if (combat.turn !== lairTurnIndex(combat.combatants, count)) continue;
    lines.push({
      kind: 'lair',
      key: `${b.id}-lair`,
      icon: '🏰',
      text: `Lair action for ${b.name} (initiative ${count}), before ${current ? current.name : 'this turn'}'s turn.`,
    });
  }
  for (const b of bosses) {
    const left = b.boss?.legendary?.remaining ?? 0;
    if (left <= 0 || current?.id === b.id) continue;
    lines.push({
      kind: 'legendary',
      key: `${b.id}-legendary`,
      icon: '⚡',
      text: `${b.name}: ${left} legendary action${left === 1 ? '' : 's'} left, one after this turn.`,
    });
  }
  return lines;
}

// --- Reactions (kept in this browser, cleared each round) -----------------------------------

export interface Reactions {
  round: number | null;
  used: ReadonlySet<string>;
}

export const NO_REACTIONS: Reactions = { round: null, used: new Set() };

/** The ticks for this round: a new round starts with none. */
export function reactionsFor(state: Reactions, round: number): ReadonlySet<string> {
  return state.round === round ? state.used : NO_REACTIONS.used;
}

/** Ticks or unticks one combatant's reaction for this round. */
export function toggleReaction(state: Reactions, round: number, id: string): Reactions {
  const used = new Set(reactionsFor(state, round));
  if (used.has(id)) used.delete(id);
  else used.add(id);
  return { round, used };
}

/** The R button's name: "Reaction used: Sorvan" or "Reaction ready: Sorvan". */
export function reactionLabel(name: string, used: boolean): string {
  return `${used ? 'Reaction used' : 'Reaction ready'}: ${name}`;
}

// --- Selection and the action bar -----------------------------------------------------------

/** Rows can be picked and the action bar shows: GM Actions on, a real fight. */
export function canSelect(input: {
  gmActions: boolean;
  fightActive: boolean;
  sample: boolean;
}): boolean {
  return input.gmActions && input.fightActive && !input.sample;
}

/** The picked ids that are still in the fight; the same set when none left. */
export function pruneSelection(
  selected: ReadonlySet<string>,
  combat: CombatState | null,
  allowed: boolean
): ReadonlySet<string> {
  if (selected.size === 0) return selected;
  if (!allowed || !combat) return new Set();
  const ids = new Set(combat.combatants.map(c => c.id));
  const kept = [...selected].filter(id => ids.has(id));
  return kept.length === selected.size ? selected : new Set(kept);
}

export function toggleSelection(selected: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * What a plan targets for the picked combatants, in the bridge's order: the token's id (two
 * "Wolf" rows stay two tokens), the name where there is no token id (older module, sample fight).
 */
export function selectedTargets(
  combat: CombatState | null,
  selected: ReadonlySet<string>
): string[] {
  return combat
    ? combat.combatants.filter(c => selected.has(c.id)).map(c => c.tokenId ?? c.name)
    : [];
}

export type SelectionAction = 'damage' | 'condition';

/** The tool runner's request for Damage / Heal or Condition on these targets (plan, then apply). */
export function planRequest(
  action: SelectionAction,
  targets: string[]
): { name: 'plan-actor-change'; prefill: { action: SelectionAction; targets: string[] } } {
  return { name: 'plan-actor-change', prefill: { action, targets } };
}

/** The tool runner's request to end the fight (plan, confirm, then apply; Undo in Recent Changes). */
export function endCombatRequest(): {
  name: 'plan-combat-change';
  prefill: { action: 'end' };
} {
  return { name: 'plan-combat-change', prefill: { action: 'end' } };
}

// --- The bridge --------------------------------------------------------------------------------

/**
 * Whether the bridge is away: the control channel is down, or Foundry is not known to be
 * reachable. Nothing is known before the first status event (the strip has no fight then anyway).
 */
export function bridgeAway(
  status: { controlChannel: string; foundry: string } | undefined
): boolean {
  return (
    status !== undefined &&
    (status.controlChannel !== 'connected' || status.foundry !== 'reachable')
  );
}

export const AWAY_TEXT = 'The bridge is away: this is the fight as last seen.';

/**
 * What the strip is: `none` without a fight, `live`, or `stale` (a fight, but the bridge is away,
 * so it may have moved on). The server sends a fight only when it changes, so the strip is live
 * again when the bridge is back, and a fight that ended meanwhile arrives as `none`.
 */
export function stripMode(combat: CombatState | null, away: boolean): 'none' | 'live' | 'stale' {
  if (!combat) return 'none';
  return away ? 'stale' : 'live';
}

/**
 * Away only because a poll failed: the control channel is up and Foundry's state is unknown (a
 * timeout or channel error on one poll, polling-feed.ts handlePollError). That is the status that
 * flickers; a dropped channel or a Foundry that said it is unreachable is not a blip.
 */
export function bridgeBlip(
  status: { controlChannel: string; foundry: string } | undefined
): boolean {
  return status?.controlChannel === 'connected' && status.foundry === 'unknown';
}

// --- The trial's sample fight -----------------------------------------------------------------

function sampleCombatant(
  n: number,
  name: string,
  side: 'pc' | 'enemy',
  initiative: number,
  value: number,
  max: number,
  extra: Partial<Combatant> = {}
): Combatant {
  return {
    id: `sample-${n}`,
    name,
    initiative,
    isCurrentTurn: false,
    hp: { value, max, temp: 0 },
    conditions: [],
    isPC: side === 'pc',
    category: side,
    defeated: false,
    deathSaves: null,
    boss: null,
    tokenId: null,
    tokenUuid: null,
    img: null,
    ...extra,
  };
}

const SAMPLE_FIGHTER = sampleCombatant(1, 'Fighter', 'pc', 18, 31, 44, { isCurrentTurn: true });

/** A made-up fight for the layout trial's Auto step: never sent anywhere, no campaign names. */
export const SAMPLE_COMBAT: CombatState = {
  active: true,
  round: 2,
  turn: 0,
  current: SAMPLE_FIGHTER,
  combatants: [
    SAMPLE_FIGHTER,
    sampleCombatant(2, 'Wolf', 'enemy', 15, 4, 11, { conditions: ['Prone'] }),
    sampleCombatant(3, 'Cleric', 'pc', 12, 27, 27),
    sampleCombatant(4, 'Wolf', 'enemy', 9, 11, 11),
  ],
};
