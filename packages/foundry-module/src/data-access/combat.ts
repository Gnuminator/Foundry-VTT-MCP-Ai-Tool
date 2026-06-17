import * as shared from './shared.js';
import { eventTracker } from '../session-events.js';

/** The roll-shape fields `rollSavingThrows` forwards to the dnd5e roll dispatch. */
interface SaveRollRequest {
  rollType: 'save' | 'check' | 'skill';
  ability?: string;
  skill?: string;
  dc?: number;
}

/** Combat tracker + resolution domain — extracted from FoundryDataAccess. */
export class CombatDataAccess {
  /**
   * Build a structured, human-readable play-by-play of the current/most-recent
   * combat. The narrative synthesis lives in the pure, separately-tested
   * EventTracker; this method only resolves the combat document and forwards the
   * lightweight `{ round, started }` descriptor (or null when there is none).
   */
  async getCombatPlayByPlay(): Promise<any> {
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
  async getCombatState(): Promise<any> {
    shared.validateFoundryState();

    const combat = this.resolveActiveOrRecentCombat();
    if (!combat) {
      return { success: true, active: false, message: 'No active or recent combat encounter.' };
    }

    const turns: any[] = combat.turns ?? [];
    const currentIndex = combat.turn ?? 0;
    const started = combat.started ?? false;

    const combatants = turns.map((c: any, idx: number) =>
      this.summarizeCombatant(c, idx, currentIndex, started)
    );

    return {
      success: true,
      active: started,
      round: combat.round ?? 0,
      turn: currentIndex,
      current: combatants[currentIndex] ?? null,
      combatants,
      downed: combatants.filter((c: any) => c.defeated),
    };
  }

  /** The live combat, else the most recently registered encounter, else null. */
  private resolveActiveOrRecentCombat(): any {
    return (game as any).combat || Array.from((game as any).combats ?? []).slice(-1)[0] || null;
  }

  /**
   * Build one combatant's snapshot. `defeated` honours an explicit `isDefeated`,
   * otherwise treats 0-or-less HP as down; `deathSaves` surface only while a
   * combatant is at 0 HP. `actedThisRound` is index-based — the turn index
   * resets to 0 each round, so any combatant before the current index has
   * already acted. `hidden` mirrors the tracker's GM-hidden flag (falling back
   * to the token) so the dashboard can drop it from the player view (Phase 6).
   */
  private summarizeCombatant(c: any, idx: number, currentIndex: number, started: any): any {
    const actor = c.actor;
    const hp = actor?.system?.attributes?.hp;
    const isPC = !!actor?.hasPlayerOwner && actor?.type === 'character';
    const death = actor?.system?.attributes?.death;
    return {
      id: c.id,
      name: c.name,
      initiative: c.initiative,
      isCurrentTurn: idx === currentIndex,
      actedThisRound: started ? idx < currentIndex : false,
      hp: hp ? { value: hp.value ?? null, max: hp.max ?? null, temp: hp.temp ?? 0 } : null,
      conditions: shared.actorConditionNames(actor),
      isPC,
      category: isPC ? 'pc' : c.token?.disposition === -1 ? 'enemy' : 'npc',
      defeated: c.isDefeated ?? (hp ? (hp.value ?? 0) <= 0 : false),
      deathSaves:
        hp && (hp.value ?? 1) <= 0
          ? { successes: death?.success ?? 0, failures: death?.failure ?? 0 }
          : null,
      hidden: c.hidden ?? c.token?.hidden ?? false,
    };
  }

  /**
   * Advance the encounter. With `skipTo`, jump straight to the named combatant
   * (matched by combatant name or actor id); otherwise step to the next turn and
   * let Foundry handle round rollover.
   */
  async advanceCombatTurn(data: { skipTo?: string }): Promise<any> {
    shared.validateFoundryState();
    const combat = this.requireActiveCombat();

    if (data.skipTo) {
      const target = (combat.turns ?? []).findIndex(
        (c: any) =>
          c.name?.toLowerCase() === data.skipTo!.toLowerCase() || c.actor?.id === data.skipTo
      );
      if (target < 0) throw new Error(`Combatant not found: ${data.skipTo}`);
      await combat.update({ turn: target });
      return {
        success: true,
        round: combat.round ?? 0,
        turn: target,
        current: combat.turns[target]?.name ?? null,
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
  async setInitiative(data: { combatantName: string; initiative: number }): Promise<any> {
    shared.validateFoundryState();
    const combat = this.requireActiveCombat();

    const wanted = data.combatantName.toLowerCase();
    const combatant = (combat.combatants?.contents ?? combat.turns ?? []).find(
      (c: any) => c.name?.toLowerCase() === wanted || c.actor?.name?.toLowerCase() === wanted
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
  }): Promise<any> {
    shared.validateFoundryState();
    const combat = this.requireActiveCombat();

    const all = combat.combatants?.contents ?? combat.combatants ?? [];
    let scope: string;

    if (data.combatantIds && data.combatantIds.length > 0) {
      // Explicit selection (the dashboard's "Roll init" on picked combatants)
      // takes precedence over scope: roll separate initiative for just those.
      const present = new Set(all.map((c: any) => c.id));
      const ids = data.combatantIds.filter((id: string) => present.has(id));
      if (ids.length > 0) await combat.rollInitiative(ids);
      scope = 'selected';
    } else {
      scope = data.scope || 'npcs';
      if (scope === 'all') {
        await combat.rollAll();
      } else if (scope === 'missing') {
        const ids = all
          .filter((c: any) => c.initiative === null || c.initiative === undefined)
          .map((c: any) => c.id);
        if (ids.length > 0) await combat.rollInitiative(ids);
      } else {
        // 'npcs' — Foundry core rolls initiative for all non-player-owned combatants
        await combat.rollNPC();
      }
    }

    const turns: any[] = combat.turns ?? [];
    return {
      success: true,
      scope,
      round: combat.round ?? 0,
      order: turns.map((c: any) => ({
        name: c.name,
        initiative: c.initiative,
        isPC: !!c.actor?.hasPlayerOwner,
      })),
    };
  }

  /**
   * Apply damage, healing, or temp HP to one or more targets, using dnd5e's
   * resistance/vulnerability/immunity math (Actor5e.applyDamage / applyTempHP).
   */
  async applyDamageAndHealing(data: {
    targets: string[];
    amount: number;
    kind?: 'damage' | 'healing' | 'temp';
    type?: string;
    multiplier?: number;
    ignoreResistance?: boolean;
  }): Promise<any> {
    shared.validateFoundryState();
    shared.requireDnd5e('apply-damage-and-healing');

    if (!Array.isArray(data.targets) || data.targets.length === 0) {
      throw new Error('targets array is required');
    }
    const amount = Number(data.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error('amount must be a non-negative number');
    }
    const kind = data.kind || 'damage';

    const results = await this.forEachTarget(data.targets, async (actor: any) => {
      const hpBefore = this.hpValueTemp(actor);
      await this.applyHpChange(actor, kind, amount, data);
      return { target: actor.name, kind, hpBefore, hpAfter: this.hpValueTemp(actor) };
    });

    shared.auditLog('applyDamageAndHealing', data, 'success');
    return { success: true, kind, amount, type: data.type ?? null, results };
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
  }): Promise<any> {
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

    const results = await this.forEachTarget(data.targets, async (actor: any) => {
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
  }): Promise<any> {
    shared.validateFoundryState();
    shared.requireDnd5e('manage-rest');

    if (!Array.isArray(data.targets) || data.targets.length === 0) {
      throw new Error('targets array is required');
    }
    const restType = data.restType === 'short' ? 'short' : 'long';

    const results = await this.forEachTarget(data.targets, async (actor: any) => {
      const cfg = {
        dialog: false,
        chat: false,
        autoHD: true,
        // Default a long rest to a new day (recovers daily uses); honor an explicit flag.
        newDay: data.newDay != null ? data.newDay : restType === 'long',
      };
      const res = restType === 'short' ? await actor.shortRest(cfg) : await actor.longRest(cfg);
      const hp = actor.system?.attributes?.hp;
      return {
        target: actor.name,
        // dnd5e v4+ reports recovery under `deltas`; v3 used `dhp`/`dhd`.
        hpRecovered: res?.deltas?.hitPoints ?? res?.dhp ?? null,
        hitDiceRecovered: res?.deltas?.hitDice ?? res?.dhd ?? null,
        hp: hp ? { value: hp.value ?? null, max: hp.max ?? null } : null,
      };
    });

    shared.auditLog('manageRest', data, 'success');
    return { success: true, restType, results };
  }

  // --- Mutation internals ----------------------------------------------------

  /** The live combat (`game.combat`), or throw — mutation needs an *active* encounter. */
  private requireActiveCombat(): any {
    const combat = (game as any).combat;
    if (!combat) throw new Error('No active combat encounter.');
    return combat;
  }

  /**
   * Resolve each target id/name to an actor (via {@link shared.resolveTargetActor})
   * and run `fn`, collecting one result per target. Unresolved targets become
   * `{ target, error: 'actor/token not found' }` and a thrown `fn` becomes
   * `{ target, error }`, so one bad target never aborts the batch.
   */
  private async forEachTarget(targets: string[], fn: (actor: any) => Promise<any>): Promise<any[]> {
    const results: any[] = [];
    for (const id of targets) {
      const actor = shared.resolveTargetActor(id);
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

  /** `{ value, temp }` snapshot of an actor's hp (nulls for gaps) — for damage reporting. */
  private hpValueTemp(actor: any): { value: any; temp: any } {
    const hp = actor.system?.attributes?.hp;
    return { value: hp?.value ?? null, temp: hp?.temp ?? 0 };
  }

  /** Dispatch a single damage / healing / temp-HP change to the dnd5e actor API. */
  private async applyHpChange(
    actor: any,
    kind: string,
    amount: number,
    data: { type?: string; multiplier?: number; ignoreResistance?: boolean }
  ): Promise<void> {
    if (kind === 'temp') {
      await actor.applyTempHP(amount);
    } else if (kind === 'healing') {
      await actor.applyDamage([{ value: amount, type: 'healing' }]);
    } else {
      const opts: any = {};
      if (data.multiplier != null) opts.multiplier = data.multiplier;
      if (data.ignoreResistance) opts.ignore = true;
      // Typed damage → dnd5e applies the actor's DR/DV/DI automatically.
      await actor.applyDamage([{ value: amount, type: data.type || '' }], opts);
    }
  }

  /**
   * dnd5e v4/v5 roll dispatch: three config objects, with a possible array
   * return. `config = { ability|skill, target?: dc }`, `dialog = { configure:
   * false }`, `message = { create: true, rollMode }`.
   */
  private async rollDnd5eV4(actor: any, data: SaveRollRequest, rollMode: string): Promise<any> {
    const config: any = {};
    if (data.rollType === 'skill') config.skill = data.skill;
    else config.ability = data.ability;
    if (data.dc != null) config.target = data.dc;
    const dialog = { configure: false };
    const message = { create: true, rollMode };
    const out =
      data.rollType === 'save'
        ? await actor.rollSavingThrow(config, dialog, message)
        : data.rollType === 'skill'
          ? await actor.rollSkill(config, dialog, message)
          : await actor.rollAbilityCheck(config, dialog, message);
    return Array.isArray(out) ? out[0] : out;
  }

  /**
   * dnd5e v3 roll dispatch: a positional ability/skill key plus one flat options
   * object (`{ fastForward, chatMessage, rollMode, targetValue? }`); single roll.
   */
  private async rollDnd5eV3(actor: any, data: SaveRollRequest, rollMode: string): Promise<any> {
    const opts: any = { fastForward: true, chatMessage: true, rollMode };
    if (data.dc != null) opts.targetValue = data.dc;
    return data.rollType === 'save'
      ? await actor.rollAbilitySave(data.ability, opts)
      : data.rollType === 'skill'
        ? await actor.rollSkill(data.skill, opts)
        : await actor.rollAbilityTest(data.ability, opts);
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
  }): Promise<any> {
    shared.validateFoundryState();
    shared.requireDnd5e('suggest-balanced-encounter');

    const cfg: any = (CONFIG as any).DND5E || {};
    let levels = data.partyLevels;
    if (!levels || levels.length === 0) {
      levels = Array.from(game.actors || [])
        .filter((a: any) => a.hasPlayerOwner && a.type === 'character')
        .map((a: any) => a.system?.details?.level ?? 1);
    }
    if (!levels || levels.length === 0) {
      throw new Error('No party levels available — pass partyLevels.');
    }

    const difficulty = data.difficulty || 'moderate';
    let xpBudget = 0;
    let model = 'unknown';

    const table2024 = cfg.ENCOUNTER_DIFFICULTY;
    if (Array.isArray(table2024)) {
      model = '2024';
      const col = { low: 0, moderate: 1, high: 2 }[difficulty];
      for (const lvl of levels) {
        const row = table2024[lvl];
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

    const crExp: number[] = cfg.CR_EXP_LEVELS || [];
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
