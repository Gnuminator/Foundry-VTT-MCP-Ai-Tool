import { ERROR_MESSAGES } from '../constants.js';
import * as shared from './shared.js';
import { effectChanges, effectDuration, effectImg, type EffectChange } from '../systems/core.js';
import { statusEffectList } from '../systems/dnd5e/status-effects.js';

/**
 * Character resources + active effects/conditions domain for `FoundryDataAccess`.
 *
 * Covers three read-only surfaces (the writes moved to plan-actor-change, F5 / D-082):
 *   - {@link getAvailableConditions}: enumerate `CONFIG.statusEffects` for the active system.
 *   - {@link getCharacterResources}: spell slots, class resources, item charges, concentration,
 *     hit dice, and death saves for an actor.
 *   - {@link getActiveEffects}: enumerate every `ActiveEffect` on an actor with type, duration,
 *     changes, and concentration metadata.
 *
 * All reads use defensive `?? fallback` access because Foundry hands partially-populated
 * documents in the wild.
 */
export class ResourcesEffectsDataAccess {
  // ===== READS =====

  /**
   * List every game condition defined in `CONFIG.statusEffects`, normalizing the
   * field names across Foundry versions (icon vs img, name vs label) and the
   * storage shape (array in core/dnd5e 5.x, an object keyed by id in dnd5e 6.0
   * — verified `dnd5e.mjs:96370` `_configureStatusEffects`; read only through
   * {@link statusEffectList}).
   */
  async getAvailableConditions(): Promise<any> {
    shared.validateFoundryState();

    try {
      const rawConditions: any[] = statusEffectList();

      return {
        success: true,
        gameSystem: game.system?.id,
        conditions: rawConditions.map((c: any) => ({
          id: c.id,
          name: c.name || c.label || c.id,
          icon: c.icon || c.img,
          description: c.description || '',
        })),
      };
    } catch (error) {
      throw new Error(
        `Failed to get available conditions: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Read all tracked numeric resources for an actor: spell slots, class resources,
   * item charges, concentration status, hit dice, and death saves (only when downed).
   */
  async getCharacterResources(data: { identifier: string }): Promise<any> {
    shared.validateFoundryState();

    const actor = shared.findActorByIdentifier(data.identifier);
    if (!actor) {
      throw new Error(`${ERROR_MESSAGES.CHARACTER_NOT_FOUND}: ${data.identifier}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const sys: any = actor.system ?? {};

    return {
      success: true,
      actorId: actor.id,
      actorName: actor.name,
      system: game.system?.id,
      spellSlots: this.readSpellSlots(sys),
      classResources: this.readClassResources(sys),
      itemCharges: this.readItemCharges(actor),
      concentration: this.readConcentration(actor),
      hitDice: this.readHitDice(sys, actor),
      deathSaves: this.readDeathSaves(sys),
    };
  }

  /**
   * Enumerate every `ActiveEffect` on an actor. Each entry carries type classification
   * (condition vs buff/debuff based on `CONFIG.statusEffects`), duration fields,
   * AE changes, and whether it requires concentration.
   */
  async getActiveEffects(data: { identifier: string }): Promise<any> {
    shared.validateFoundryState();

    const actor = shared.findActorByIdentifier(data.identifier);
    if (!actor) {
      throw new Error(`${ERROR_MESSAGES.CHARACTER_NOT_FOUND}: ${data.identifier}`);
    }

    // Build a registry of known condition status ids for the type-classification step.
    // `statusEffectList()` normalizes the array (core/dnd5e 5.x) vs id-keyed-object
    // (dnd5e 6.0) storage shape.
    const knownStatusIds = new Set<string>(
      statusEffectList()
        .map((s: any) => s.id)
        .filter(Boolean)
    );

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const effectList: any[] = actor.effects?.contents ?? actor.effects ?? [];

    const effects = effectList.map((e: any) => this.describeEffect(e, knownStatusIds));

    return {
      success: true,
      actorId: actor.id,
      actorName: actor.name,
      count: effects.length,
      effects,
    };
  }

  // ===== internals =====

  /**
   * Extract spell slot data from `system.spells` (levels 1–9 plus pact magic).
   * A slot is only included when it has a non-zero max OR a non-zero current value.
   * Pact magic is only included when `pact.max > 0`.
   */
  private readSpellSlots(sys: any): Record<string, any> {
    const slots: Record<string, any> = {};
    const spells = sys.spells ?? {};

    for (let level = 1; level <= 9; level++) {
      const slot = spells[`spell${level}`];
      if (!slot) continue;
      const max = slot.max ?? 0;
      const current = slot.value ?? 0;
      if (max > 0 || current > 0) {
        slots[`level${level}`] = { max, current, expended: Math.max(0, max - current) };
      }
    }

    const pact = spells.pact;
    if (pact && (pact.max ?? 0) > 0) {
      const max = pact.max ?? 0;
      const current = pact.value ?? 0;
      slots['pact'] = {
        max,
        current,
        expended: Math.max(0, max - current),
        level: pact.level ?? null,
      };
    }

    return slots;
  }

  /**
   * Extract class resource entries (primary/secondary/tertiary).
   * An entry is included only when it has a non-empty label OR a non-zero max.
   * The label falls back to the resource key when blank.
   */
  private readClassResources(sys: any): any[] {
    const result: any[] = [];
    const resources = sys.resources ?? {};

    for (const key of ['primary', 'secondary', 'tertiary']) {
      const r = resources[key];
      if (!r) continue;
      const hasLabel = !!r.label;
      const hasMax = r.max != null && r.max !== 0;
      if (!hasLabel && !hasMax) continue;
      result.push({
        key,
        label: r.label || key,
        max: r.max ?? null,
        current: r.value ?? null,
      });
    }

    return result;
  }

  /**
   * Collect item charge information from every item with a usable `uses.max > 0`.
   *
   * dnd5e 6 stores `uses.spent` (`uses.value` is derived), so `current = max(0, max - spent)`,
   * falling back to `uses.value` when `spent` is missing.
   *
   * Recharge is the first `uses.recovery` period ("lr", "sr", "dawn", ...); a recharge ability
   * (period "recharge", formula the lowest roll) reads as "recharge 5-6". dnd5e 6 has no
   * `uses.per` or `system.recharge` (both migrated into `uses.recovery`).
   */
  private readItemCharges(actor: any): any[] {
    const charges: any[] = [];

    for (const item of actor.items) {
      const uses = item.system?.uses;
      if (!uses) continue;

      const max = Number(uses.max);
      if (!Number.isFinite(max) || max <= 0) continue;

      const current =
        uses.spent != null
          ? Math.max(0, max - (Number(uses.spent) || 0))
          : Math.max(0, Number(uses.value) || 0);

      const recovery = Array.isArray(uses.recovery) ? uses.recovery[0] : undefined;
      let recharge: string | null = recovery?.period || null;
      if (recharge === 'recharge') {
        const low = parseInt(String(recovery.formula ?? '6'), 10);
        recharge = Number.isFinite(low) && low < 6 ? `recharge ${low}-6` : 'recharge 6';
      }

      charges.push({ itemName: item.name, charges: current, max, recharge });
    }

    return charges;
  }

  /**
   * Detect an active concentration effect on `actor.effects`. Three signals,
   * checked in order:
   *   1. A status id of `'concentrating'` in `e.statuses`.
   *   2. Effect name matching `/concentrat/i`.
   *   3. Presence of `flags.dnd5e.itemData` (DAE-style concentration marker).
   *
   * Spell name: dnd5e's `Actor5e.createConcentrationEffectData` (verified
   * `dnd5e.mjs:8259-8290`, unchanged in shape since well before 6.0) never
   * writes `flags.dnd5e.item.name` — the pre-existing bug this replaces — it
   * writes `flags.dnd5e.item.{type,id,uuid}` and `origin` (both the item's
   * UUID). Resolve the linked item by UUID via `fromUuidSync` (present on both
   * versions) and read its live `.name`; fall back to stripping the
   * "Concentrating: " prefix dnd5e always puts on the effect's own `name`
   * (`dnd5e.mjs:8268`) when the item can't be resolved (e.g. it was deleted).
   * Remaining time: `duration.remaining` → `duration.seconds`.
   */
  private readConcentration(actor: any): any {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const effectList: any[] = actor.effects?.contents ?? actor.effects ?? [];

      const conc = effectList.find(
        (e: any) =>
          e.statuses?.has?.('concentrating') ||
          /concentrat/i.test(e.name || e.label || '') ||
          !!e.flags?.dnd5e?.itemData
      );

      if (!conc) return { active: false };

      const itemUuid: unknown = conc.flags?.dnd5e?.item?.uuid ?? conc.origin;
      let spellName: string | null = null;
      if (typeof itemUuid === 'string' && itemUuid && typeof fromUuidSync === 'function') {
        try {
          const linkedItem = fromUuidSync(itemUuid) as { name?: unknown } | null;
          if (typeof linkedItem?.name === 'string' && linkedItem.name) spellName = linkedItem.name;
        } catch {
          // Deleted/unresolvable item — fall through to the name-strip fallback.
        }
      }
      spellName ??= (conc.name || '').replace(/concentrating:?\s*/i, '').trim() || null;

      return {
        active: true,
        spell: spellName,
        remaining: conc.duration?.remaining ?? conc.duration?.seconds ?? null,
      };
    } catch {
      return { active: false };
    }
  }

  /**
   * Read hit dice. Prefers the derived `system.attributes.hd` (`max`, `value`). The die type
   * comes from the class items' `system.hd.denomination` ("d8"; a multiclass gives "d10/d8",
   * largest first); a PC's `attributes.hd` has no denomination, an NPC's is a number (8).
   * Without `attributes.hd` totals are summed from the class items (`levels`, `hd.spent`).
   * Returns `null` when neither source has data.
   */
  private readHitDice(sys: any, actor: any): any {
    let total = 0;
    let available = 0;
    const faces = new Set<number>();
    for (const item of actor.items) {
      if (item.type !== 'class') continue;
      const c = item.system ?? {};
      const levels = Number(c.levels) || 0;
      total += levels;
      available += Math.max(0, levels - (Number(c.hd?.spent) || 0));
      const face = parseInt(String(c.hd?.denomination ?? '').replace(/^d/i, ''), 10);
      if (Number.isFinite(face) && face > 0) faces.add(face);
    }
    let dieType: string | null = faces.size
      ? [...faces]
          .sort((a, b) => b - a)
          .map(f => `d${f}`)
          .join('/')
      : null;

    // Primary source: the derived hd object.
    const hd = sys.attributes?.hd;
    if (hd && typeof hd === 'object') {
      const max = hd.max ?? null;
      const value = hd.value ?? null;
      if (max != null || value != null) {
        if (!dieType && typeof hd.denomination === 'number' && hd.denomination > 0) {
          dieType = `d${hd.denomination}`;
        } else if (!dieType && typeof hd.denomination === 'string' && hd.denomination) {
          dieType = hd.denomination;
        }
        return { total: max, available: value, dieType };
      }
    }

    return total > 0 ? { total, available, dieType } : null;
  }

  /**
   * Return death save counts only when `hp.value <= 0`; otherwise `null`.
   * Both `success` and `failure` default to 0 when the `death` attribute is absent.
   */
  private readDeathSaves(sys: any): any {
    const hp = sys.attributes?.hp;
    if (!hp || (hp.value ?? 1) > 0) return null;

    const death = sys.attributes?.death;
    return { successes: death?.success ?? 0, failures: death?.failure ?? 0 };
  }

  /**
   * Build a normalized descriptor for one `ActiveEffect` document.
   * `isCondition` is true only when one of the effect's status ids is registered
   * in `CONFIG.statusEffects` — a spell that happens to apply 'concentrating' is
   * not a game condition.
   *
   * `changes`/`duration`/`icon` are read through the version adapter
   * (`systems/core.ts`) so v13 (`effect.changes` + numeric `mode`,
   * `duration.rounds/turns/seconds`, `effect.icon`) and v14
   * (`effect.system.changes` + string `type`, `duration.value/units/expiry`,
   * `effect.img` only) both resolve correctly. The tool's existing field names
   * are kept: `changes[].mode` is now filled from the normalized `type` string
   * (numeric v13 modes map to the same vocabulary — see
   * `core.ts` `LEGACY_CHANGE_MODES`) and `type` is added alongside it for
   * callers that want the v14 vocabulary directly; `duration` keeps
   * `rounds`/`turns`/`seconds`/`remaining`, with the first three sourced from
   * the normalized `{value, units}` and `remaining` still read straight off
   * the live `effect.duration` getter (present, and correct, on both
   * versions).
   */
  private describeEffect(e: any, knownStatusIds: Set<string>): any {
    const statuses: string[] = Array.from(e.statuses ?? []);
    const isCondition = statuses.some(s => knownStatusIds.has(s));

    const normDuration = effectDuration(e as ActiveEffect);
    const rawRemaining = (e.duration as Record<string, unknown> | undefined)?.remaining;
    const changes = effectChanges(e as ActiveEffect).map((c: EffectChange) => ({
      key: c.key,
      mode: c.type,
      type: c.type,
      value: c.value,
    }));

    const requiresConcentration =
      !!e.flags?.dnd5e?.concentration || /concentrat/i.test(e.name || e.label || '');

    return {
      id: e.id,
      name: e.name || e.label || 'Unknown Effect',
      icon: effectImg(e as ActiveEffect),
      disabled: e.disabled ?? false,
      isCondition,
      type: isCondition ? 'condition' : 'buff/debuff',
      statuses,
      duration: {
        rounds: normDuration.units === 'rounds' ? normDuration.value : null,
        turns: normDuration.units === 'turns' ? normDuration.value : null,
        seconds: normDuration.units === 'seconds' ? normDuration.value : null,
        remaining: typeof rawRemaining === 'number' ? rawRemaining : null,
      },
      changes,
      requiresConcentration,
    };
  }
}
