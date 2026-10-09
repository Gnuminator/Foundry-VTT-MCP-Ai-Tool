import * as shared from './shared.js';
import { eventTracker } from '../session-events.js';

/** The roll-shape fields `rollSavingThrows` forwards to the dnd5e roll dispatch. */
interface SaveRollRequest {
  rollType: 'save' | 'check' | 'skill';
  ability?: string;
  skill?: string;
  dc?: number;
}

/**
 * The combat members this domain reads or calls that the core `Combat` declaration lacks
 * (`turns`, the ordered combatants, and the initiative helpers). Optional where a partial
 * combat in the wild may omit them.
 */
interface TrackerCombat extends Combat {
  turns?: TrackerCombatant[];
  setInitiative(id: string, initiative: number): Promise<unknown>;
  rollNPC(): Promise<unknown>;
  rollAll(): Promise<unknown>;
}

/** A combatant as the tracker reads it: `isDefeated` is a core getter the declaration lacks. */
type TrackerCombatant = Combatant & { isDefeated?: boolean };

/** dnd5e config the encounter budget reads (`CONFIG.DND5E`); both entries may be absent. */
interface Dnd5eEncounterConfig {
  ENCOUNTER_DIFFICULTY?: unknown;
  CR_EXP_LEVELS?: number[];
}

/** What a dnd5e roll or rest returns, as far as this domain reads it. */
interface D20RollResult {
  total?: number | null;
  isSuccess?: unknown;
}
type RollOutcome = D20RollResult | null | undefined;

interface RestResult {
  deltas?: { hitPoints?: unknown; hitDice?: unknown };
  dhp?: unknown;
  dhd?: unknown;
}

/** dnd5e v4/v5 roll config: `{ ability|skill, target?: dc }`. */
interface Dnd5eRollConfig {
  skill?: string | undefined;
  ability?: string | undefined;
  target?: number;
}

/** dnd5e v3 flat roll options. */
interface Dnd5eV3RollOptions {
  fastForward: boolean;
  chatMessage: boolean;
  rollMode: string;
  targetValue?: number;
}

/** dnd5e v4/v5 actor roll methods (three config objects). */
interface Dnd5eV4Roller {
  rollSavingThrow(config: Dnd5eRollConfig, dialog: object, message: object): Promise<unknown>;
  rollSkill(config: Dnd5eRollConfig, dialog: object, message: object): Promise<unknown>;
  rollAbilityCheck(config: Dnd5eRollConfig, dialog: object, message: object): Promise<unknown>;
}

/** dnd5e v3 actor roll methods (positional key plus flat options). */
interface Dnd5eV3Roller {
  rollAbilitySave(ability: string | undefined, options: Dnd5eV3RollOptions): Promise<unknown>;
  rollSkill(skill: string | undefined, options: Dnd5eV3RollOptions): Promise<unknown>;
  rollAbilityTest(ability: string | undefined, options: Dnd5eV3RollOptions): Promise<unknown>;
}

/** dnd5e actor rests. */
interface Dnd5eRester {
  shortRest(config: object): Promise<unknown>;
  longRest(config: object): Promise<unknown>;
}

/** One combatant of the tracker snapshot (`getCombatState`). */
export interface CombatantSnapshot {
  id: string;
  name: string;
  initiative: number | null;
  isCurrentTurn: boolean;
  actedThisRound: boolean;
  tokenId: string | null;
  actorId: string | null;
  sceneId: string | null;
  hp: { value: number | null; max: number | null; temp: number } | null;
  conditions: string[];
  statuses: string[];
  isPC: boolean;
  category: 'pc' | 'enemy' | 'npc';
  defeated: boolean;
  deathSaves: { successes: number; failures: number } | null;
  hidden: boolean;
  boss: BossResources | null;
}

/** `getCombatState`: either "no encounter" or the full snapshot. */
export type CombatStateResult =
  | { success: true; active: false; message: string }
  | {
      success: true;
      active: boolean;
      round: number;
      turn: number;
      current: CombatantSnapshot | null;
      combatants: CombatantSnapshot[];
      downed: CombatantSnapshot[];
    };

/** A target that could not be resolved, or whose roll or rest threw. */
export interface TargetError {
  target: string;
  error: string;
}

/** A `{max, spent}` counter as the dashboard shows it; `remaining` is `max - spent`. */
export interface BossCounter {
  max: number;
  spent: number;
  remaining: number;
}

/** Legendary actions, legendary resistances and lair of an NPC (I-070). Read-only. */
export interface BossResources {
  legendary: BossCounter | null;
  resistances: BossCounter | null;
  /** The creature has a lair: `inside` is dnd5e's "in its lair" box, `initiative` the lair's count (null = 20). */
  lair: { inside: boolean; initiative: number | null } | null;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * dnd5e 6 stores `system.resources.legact` and `legres` as `{max, spent}` (verified live on
 * dnd5e 6.0.5: the 2024 Aboleth has `{max: 3, spent: 0, value: 3}`, `value` derived) and
 * `lair` as `{value, inside, initiative}`. Older data may carry only `value` (uses left).
 */
function bossCounter(raw: unknown): BossCounter | null {
  const r = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  const max = finite(r?.max) ?? 0;
  if (max <= 0) return null;
  const spentRaw = finite(r?.spent);
  const value = finite(r?.value);
  const spent = Math.min(max, Math.max(0, spentRaw ?? (value !== null ? max - value : 0)));
  return { max, spent, remaining: max - spent };
}

/** Boss resources of an actor, or null when it has none of them (every PC, most NPCs). */
export function bossResources(actor: unknown): BossResources | null {
  const a = actor !== null && typeof actor === 'object' ? (actor as Record<string, unknown>) : null;
  const system = a?.system as { resources?: Record<string, unknown> } | undefined;
  const resources = system?.resources;
  if (!resources) return null;
  const legendary = bossCounter(resources.legact);
  const resistances = bossCounter(resources.legres);
  const lairRaw = resources.lair as
    | { value?: unknown; inside?: unknown; initiative?: unknown }
    | undefined;
  const lair =
    lairRaw?.value === true
      ? { inside: lairRaw.inside === true, initiative: finite(lairRaw.initiative) }
      : null;
  if (!legendary && !resistances && !lair) return null;
  return { legendary, resistances, lair };
}

/** Combat tracker + resolution domain — extracted from FoundryDataAccess. */
export class CombatDataAccess {
  /**
   * Build a structured, human-readable play-by-play of the current/most-recent
   * combat. The narrative synthesis lives in the pure, separately-tested
   * EventTracker; this method only resolves the combat document and forwards the
   * lightweight `{ round, started }` descriptor (or null when there is none).
   */
  async getCombatPlayByPlay(): Promise<ReturnType<typeof eventTracker.buildPlayByPlay>> {
    shared.validateFoundryState();

    const combat = this.resolveActiveOrRecentCombat();
    return eventTracker.buildPlayByPlay(
      combat ? { round: combat.round, started: combat.started } : null
    );
  }

  /**
   * Snapshot of the current/most-recent encounter for the co-GM dashboard:
   * per-combatant turn state, HP, conditions, defeat/death-save status, and
   * category (pc / enemy / npc). Returns `{ active: false }` with a message when
   * no encounter exists.
   */
  async getCombatState(): Promise<CombatStateResult> {
    shared.validateFoundryState();

    const combat = this.resolveActiveOrRecentCombat();
    if (!combat) {
      return { success: true, active: false, message: 'No active or recent combat encounter.' };
    }

    const turns = combat.turns ?? [];
    const currentIndex = combat.turn ?? 0;
    const started = combat.started ?? false;

    const combatants = turns.map((c, idx) =>
      this.summarizeCombatant(c, idx, currentIndex, started)
    );

    return {
      success: true,
      active: started,
      round: combat.round ?? 0,
      turn: currentIndex,
      current: combatants[currentIndex] ?? null,
      combatants,
      downed: combatants.filter(c => c.defeated),
    };
  }

  /** The live combat, else the most recently registered encounter, else null. */
  private resolveActiveOrRecentCombat(): TrackerCombat | null {
    return (game.combat ??
      Array.from(game.combats ?? []).slice(-1)[0] ??
      null) as TrackerCombat | null;
  }

  /**
   * Build one combatant's snapshot. `defeated` honours an explicit `isDefeated`,
   * otherwise treats 0-or-less HP as down; `deathSaves` surface only while a
   * combatant is at 0 HP. `actedThisRound` is index-based — the turn index
   * resets to 0 each round, so any combatant before the current index has
   * already acted. `hidden` mirrors the tracker's GM-hidden flag (falling back
   * to the token) so the dashboard can drop it from the player view (Phase 6).
   * `tokenId`/`actorId`/`sceneId`/`statuses` (M2) let the dashboard name a
   * combatant the way players see it, via the player-visibility domain.
   * `boss` (I-070) carries legendary actions, resistances and lair for NPCs.
   */
  private summarizeCombatant(
    c: TrackerCombatant,
    idx: number,
    currentIndex: number,
    started: boolean
  ): CombatantSnapshot {
    const actor = c.actor;
    const hp = actor?.system?.attributes?.hp;
    const isPC = !!actor?.hasPlayerOwner && actor?.type === 'character';
    const death = actor?.system?.attributes?.death;
    // The M2 fields are read through narrow shapes: a combatant in the wild may carry
    // only some of them.
    const cExtra = c as {
      tokenId?: string | null;
      token?: { id?: string | null } | null;
      sceneId?: string | null;
    };
    const actorExtra = actor as { id?: string | null; statuses?: Iterable<unknown> } | null;
    return {
      id: c.id,
      name: c.name,
      initiative: c.initiative,
      isCurrentTurn: idx === currentIndex,
      actedThisRound: started ? idx < currentIndex : false,
      tokenId: cExtra.tokenId ?? cExtra.token?.id ?? null,
      actorId: actorExtra?.id ?? null,
      sceneId: cExtra.sceneId ?? null,
      hp: hp ? { value: hp.value ?? null, max: hp.max ?? null, temp: hp.temp ?? 0 } : null,
      conditions: shared.actorConditionNames(actor),
      statuses: Array.from(actorExtra?.statuses ?? []).filter(
        (s: unknown): s is string => typeof s === 'string'
      ),
      isPC,
      category: isPC ? 'pc' : c.token?.disposition === -1 ? 'enemy' : 'npc',
      defeated: c.isDefeated ?? (hp ? (hp.value ?? 0) <= 0 : false),
      deathSaves:
        hp && (hp.value ?? 1) <= 0
          ? { successes: death?.success ?? 0, failures: death?.failure ?? 0 }
          : null,
      hidden: c.hidden ?? c.token?.hidden ?? false,
      // I-070: GM-only (the /player projection copies an allowlist of fields).
      boss: isPC ? null : bossResources(actor),
    };
  }

  /**
   * Advance the encounter. With `skipTo`, jump straight to the named combatant
   * (matched by combatant name or actor id); otherwise step to the next turn and
   * let Foundry handle round rollover.
   */
  async advanceCombatTurn(data: {
    skipTo?: string;
  }): Promise<{ success: true; round: number; turn: number; current: string | null }> {
    shared.validateFoundryState();
    const combat = this.requireActiveCombat();

    if (data.skipTo) {
      const target = (combat.turns ?? []).findIndex(
        c => c.name?.toLowerCase() === data.skipTo!.toLowerCase() || c.actor?.id === data.skipTo
      );
      if (target < 0) throw new Error(`Combatant not found: ${data.skipTo}`);
      await combat.update({ turn: target });
      return {
        success: true,
        round: combat.round ?? 0,
        turn: target,
        current: combat.turns?.[target]?.name ?? null,
      };
    }

    await combat.nextTurn();
    return {
      success: true,
      round: combat.round ?? 0,
      turn: combat.turn ?? 0,
      current: combat.combatant?.name ?? null,
    };
  }

  /**
   * Set a combatant's initiative. The combatant is matched (case-insensitively)
   * by its own name or its actor's name, preferring the live `combatants`
   * collection and falling back to the ordered `turns`.
   */
  async setInitiative(data: {
    combatantName: string;
    initiative: number;
  }): Promise<{ success: true; combatant: string; initiative: number }> {
    shared.validateFoundryState();
    const combat = this.requireActiveCombat();

    const wanted = data.combatantName.toLowerCase();
    const combatant = (combat.combatants?.contents ?? combat.turns ?? []).find(
      c => c.name?.toLowerCase() === wanted || c.actor?.name?.toLowerCase() === wanted
    );
    if (!combatant) throw new Error(`Combatant not found: ${data.combatantName}`);

    await combat.setInitiative(combatant.id, data.initiative);

    return {
      success: true,
      combatant: combatant.name,
      initiative: data.initiative,
    };
  }

  /**
   * Roll initiative for combatants in the active combat. scope:
   *  - 'npcs' (default): non-player combatants (Combat#rollNPC)
   *  - 'all': everyone (Combat#rollAll)
   *  - 'missing': only combatants without an initiative value
   */
  async rollInitiativeForNpcs(data: {
    scope?: 'npcs' | 'all' | 'missing';
    combatantIds?: string[];
  }): Promise<{
    success: true;
    scope: string;
    round: number;
    order: { name: string; initiative: number | null; isPC: boolean }[];
  }> {
    shared.validateFoundryState();
    const combat = this.requireActiveCombat();

    // `combatants` is a collection in Foundry (its `contents` array); a partial combat may
    // hand over the plain array itself.
    const rawCombatants: unknown = combat.combatants;
    const all: Combatant[] =
      (rawCombatants as { contents?: Combatant[] } | undefined)?.contents ??
      (rawCombatants as Combatant[] | undefined) ??
      [];
    let scope: string;

    if (data.combatantIds && data.combatantIds.length > 0) {
      // Explicit selection (the dashboard's "Roll init" on picked combatants)
      // takes precedence over scope: roll separate initiative for just those.
      const present = new Set(all.map(c => c.id));
      const ids = data.combatantIds.filter(id => present.has(id));
      if (ids.length > 0) await combat.rollInitiative(ids);
      scope = 'selected';
    } else {
      scope = data.scope || 'npcs';
      if (scope === 'all') {
        await combat.rollAll();
      } else if (scope === 'missing') {
        const ids = all
          .filter(c => c.initiative === null || c.initiative === undefined)
          .map(c => c.id);
        if (ids.length > 0) await combat.rollInitiative(ids);
      } else {
        // 'npcs' — Foundry core rolls initiative for all non-player-owned combatants
        await combat.rollNPC();
      }
    }

    const turns = combat.turns ?? [];
    return {
      success: true,
      scope,
      round: combat.round ?? 0,
      order: turns.map(c => ({
        name: c.name,
        initiative: c.initiative,
        isPC: !!c.actor?.hasPlayerOwner,
      })),
    };
  }

  /**
   * Roll saving throws / ability checks / skill checks for one or more NPC
   * actors using the dnd5e system rules, optionally vs a DC, reporting pass/fail.
   * Handles dnd5e v3 (positional id + flat options, single roll, no isSuccess)
   * and v4/v5 (three config objects, array return, roll.isSuccess).
   */
  async rollSavingThrows(data: {
    targets: string[];
    rollType: 'save' | 'check' | 'skill';
    ability?: string;
    skill?: string;
    dc?: number;
    isPublic?: boolean;
  }): Promise<{
    success: true;
    rollType: 'save' | 'check' | 'skill';
    dc: number | null;
    results: ({ target: string; total: number | null; success: boolean | null } | TargetError)[];
  }> {
    shared.validateFoundryState();
    shared.requireDnd5e('roll-saving-throws');

    if (!Array.isArray(data.targets) || data.targets.length === 0) {
      throw new Error('targets array is required');
    }
    if (data.rollType === 'skill' && !data.skill)
      throw new Error('skill is required for skill rolls');
    if (data.rollType !== 'skill' && !data.ability) {
      throw new Error('ability is required for save/check rolls');
    }

    const major = shared.systemMajor();
    const rollMode = shared.rollModeFor(data.isPublic);

    const results = await this.forEachTarget(data.targets, async actor => {
      const roll =
        major >= 4
          ? await this.rollDnd5eV4(actor, data, rollMode)
          : await this.rollDnd5eV3(actor, data, rollMode);
      const total = roll?.total ?? null;
      // Prefer the system's own pass/fail verdict; otherwise compare to the DC.
      let success: boolean | null = null;
      if (data.dc != null && total != null) {
        success = typeof roll?.isSuccess === 'boolean' ? roll.isSuccess : total >= data.dc;
      }
      return { target: actor.name, total, success };
    });

    return {
      success: true,
      rollType: data.rollType,
      dc: data.dc ?? null,
      results,
    };
  }

  /**
   * Run a short or long rest for one or more characters (HP, hit dice, spell
   * slots, limited-use features) without opening dialogs.
   */
  async manageRest(data: {
    targets: string[];
    restType: 'short' | 'long';
    newDay?: boolean;
  }): Promise<{
    success: true;
    restType: 'short' | 'long';
    results: (
      | {
          target: string;
          hpRecovered: unknown;
          hitDiceRecovered: unknown;
          hp: { value: number | null; max: number | null } | null;
        }
      | TargetError
    )[];
  }> {
    shared.validateFoundryState();
    shared.requireDnd5e('manage-rest');

    if (!Array.isArray(data.targets) || data.targets.length === 0) {
      throw new Error('targets array is required');
    }
    const restType = data.restType === 'short' ? 'short' : 'long';

    const results = await this.forEachTarget(data.targets, async actor => {
      const cfg = {
        dialog: false,
        chat: false,
        autoHD: true,
        // Default a long rest to a new day (recovers daily uses); honor an explicit flag.
        newDay: data.newDay ?? restType === 'long',
      };
      const rester = actor as Actor & Dnd5eRester;
      const res = (
        restType === 'short' ? await rester.shortRest(cfg) : await rester.longRest(cfg)
      ) as RestResult | null | undefined;
      const hp = actor.system?.attributes?.hp;
      return {
        target: actor.name,
        // dnd5e v4+ reports recovery under `deltas`; v3 used `dhp`/`dhd`.
        hpRecovered: res?.deltas?.hitPoints ?? res?.dhp ?? null,
        hitDiceRecovered: res?.deltas?.hitDice ?? res?.dhd ?? null,
        hp: hp ? { value: hp.value ?? null, max: hp.max ?? null } : null,
      };
    });

    return { success: true, restType, results };
  }

  // --- Mutation internals ----------------------------------------------------

  /** The live combat (`game.combat`), or throw — mutation needs an *active* encounter. */
  private requireActiveCombat(): TrackerCombat {
    const combat = game.combat;
    if (!combat) throw new Error('No active combat encounter.');
    return combat as TrackerCombat;
  }

  /**
   * Resolve each target id/name to an actor (via {@link shared.resolveTargetActor})
   * and run `fn`, collecting one result per target. Unresolved targets become
   * `{ target, error: 'actor/token not found' }` and a thrown `fn` becomes
   * `{ target, error }`, so one bad target never aborts the batch.
   */
  private async forEachTarget<T>(
    targets: string[],
    fn: (actor: Actor) => Promise<T>
  ): Promise<(T | TargetError)[]> {
    const results: (T | TargetError)[] = [];
    for (const id of targets) {
      const resolved: unknown = shared.resolveTargetActor(id);
      const actor = resolved as Actor | null | undefined;
      if (!actor) {
        results.push({ target: id, error: 'actor/token not found' });
        continue;
      }
      try {
        results.push(await fn(actor));
      } catch (err) {
        results.push({
          target: actor.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return results;
  }

  /**
   * dnd5e v4/v5 roll dispatch: three config objects, with a possible array
   * return. `config = { ability|skill, target?: dc }`, `dialog = { configure:
   * false }`, `message = { create: true, rollMode }`.
   */
  private async rollDnd5eV4(
    actor: Actor,
    data: SaveRollRequest,
    rollMode: string
  ): Promise<RollOutcome> {
    const roller = actor as Actor & Dnd5eV4Roller;
    const config: Dnd5eRollConfig = {};
    if (data.rollType === 'skill') config.skill = data.skill;
    else config.ability = data.ability;
    if (data.dc != null) config.target = data.dc;
    const dialog = { configure: false };
    const message = { create: true, rollMode };
    const out =
      data.rollType === 'save'
        ? await roller.rollSavingThrow(config, dialog, message)
        : data.rollType === 'skill'
          ? await roller.rollSkill(config, dialog, message)
          : await roller.rollAbilityCheck(config, dialog, message);
    return (Array.isArray(out) ? (out as unknown[])[0] : out) as RollOutcome;
  }

  /**
   * dnd5e v3 roll dispatch: a positional ability/skill key plus one flat options
   * object (`{ fastForward, chatMessage, rollMode, targetValue? }`); single roll.
   */
  private async rollDnd5eV3(
    actor: Actor,
    data: SaveRollRequest,
    rollMode: string
  ): Promise<RollOutcome> {
    const roller = actor as Actor & Dnd5eV3Roller;
    const opts: Dnd5eV3RollOptions = { fastForward: true, chatMessage: true, rollMode };
    if (data.dc != null) opts.targetValue = data.dc;
    return (
      data.rollType === 'save'
        ? await roller.rollAbilitySave(data.ability, opts)
        : data.rollType === 'skill'
          ? await roller.rollSkill(data.skill, opts)
          : await roller.rollAbilityTest(data.ability, opts)
    ) as RollOutcome;
  }

  /**
   * Compute an XP budget for the party and suggest creature CRs to fill it.
   * Uses dnd5e's 2024 CONFIG.DND5E.ENCOUNTER_DIFFICULTY when present, otherwise
   * a built-in 2014 DMG threshold table. Returns the budget; use the existing
   * search/list-creatures tools to pick actual creatures near the suggested CRs.
   */
  async suggestBalancedEncounter(data: {
    partyLevels?: number[];
    difficulty?: 'low' | 'moderate' | 'high';
  }): Promise<{
    success: true;
    model: string;
    difficulty: 'low' | 'moderate' | 'high';
    partyLevels: number[];
    xpBudget: number;
    suggestions: {
      singleCreatureMaxCR: number;
      mixes: { count: number; crEach: number; xpEach: number; totalXp: number }[];
    };
    note: string;
  }> {
    shared.validateFoundryState();
    shared.requireDnd5e('suggest-balanced-encounter');

    const dnd5eConfig: unknown = CONFIG.DND5E;
    const cfg = (dnd5eConfig as Dnd5eEncounterConfig) || {};
    let levels = data.partyLevels;
    if (!levels || levels.length === 0) {
      levels = Array.from(game.actors || [])
        .filter(a => a.hasPlayerOwner && a.type === 'character')
        .map(a => a.system?.details?.level ?? 1);
    }
    if (!levels || levels.length === 0) {
      throw new Error('No party levels available — pass partyLevels.');
    }

    const difficulty = data.difficulty || 'moderate';
    let xpBudget = 0;
    let model: string;

    const table2024: unknown = cfg.ENCOUNTER_DIFFICULTY;
    if (Array.isArray(table2024)) {
      model = '2024';
      const col = { low: 0, moderate: 1, high: 2 }[difficulty];
      const table = table2024 as (number[] | undefined)[];
      for (const lvl of levels) {
        const row = table[lvl];
        if (Array.isArray(row)) xpBudget += row[col] ?? 0;
      }
    } else {
      // 2014 DMG thresholds [easy, medium, hard, deadly] per character level.
      model = '2014';
      const T: Record<number, number[]> = {
        1: [25, 50, 75, 100],
        2: [50, 100, 150, 200],
        3: [75, 150, 225, 400],
        4: [125, 250, 375, 500],
        5: [250, 500, 750, 1100],
        6: [300, 600, 900, 1400],
        7: [350, 750, 1100, 1700],
        8: [450, 900, 1300, 2100],
        9: [550, 1100, 1600, 2400],
        10: [600, 1200, 1900, 2800],
        11: [800, 1600, 2400, 3600],
        12: [1000, 2000, 3000, 4500],
        13: [1100, 2200, 3400, 5100],
        14: [1250, 2500, 3800, 5700],
        15: [1400, 2800, 4300, 6400],
        16: [1600, 3200, 4800, 7200],
        17: [2000, 3900, 5900, 8800],
        18: [2100, 4200, 6300, 9500],
        19: [2400, 4900, 7300, 10900],
        20: [2800, 5700, 8500, 12700],
      };
      const col = { low: 0, moderate: 1, high: 3 }[difficulty]; // map high→deadly
      for (const lvl of levels) {
        const row = T[Math.max(1, Math.min(20, lvl))];
        if (row) xpBudget += row[col] ?? 0;
      }
    }

    const crExp = cfg.CR_EXP_LEVELS ?? [];
    let singleCreatureMaxCR = 0;
    for (let cr = 0; cr < crExp.length; cr++) {
      if ((crExp[cr] ?? Infinity) <= xpBudget) singleCreatureMaxCR = cr;
    }
    const mixes = [1, 2, 4, 6].map(n => {
      const per = xpBudget / n;
      let cr = 0;
      for (let c = 0; c < crExp.length; c++) if ((crExp[c] ?? Infinity) <= per) cr = c;
      return { count: n, crEach: cr, xpEach: crExp[cr] ?? 0, totalXp: (crExp[cr] ?? 0) * n };
    });

    return {
      success: true,
      model,
      difficulty,
      partyLevels: levels,
      xpBudget,
      suggestions: { singleCreatureMaxCR, mixes },
      note: 'Use list-creatures-by-criteria / search-compendium to pick creatures near these CRs.',
    };
  }
}
