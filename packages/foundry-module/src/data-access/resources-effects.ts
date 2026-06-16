import { ERROR_MESSAGES } from '../constants.js';
import * as shared from './shared.js';

/**
 * Character resources + active effects/conditions domain for `FoundryDataAccess`.
 *
 * Covers five public surfaces:
 *   - {@link getAvailableConditions} — enumerate `CONFIG.statusEffects` for the active system.
 *   - {@link getCharacterResources} — spell slots, class resources, item charges, concentration,
 *     hit dice, and death saves for an actor.
 *   - {@link updateCharacterResource} — mutate one numeric resource (slot / class resource /
 *     item charge) by name or label.
 *   - {@link getActiveEffects} — enumerate every `ActiveEffect` on an actor with type, duration,
 *     changes, and concentration metadata.
 *   - {@link clearStaleConditions} — delete effects by name / status id, or by expired duration.
 *
 * All reads use defensive `?? fallback` access because Foundry hands partially-populated
 * documents in the wild. Writes are recorded via {@link shared.auditLog}.
 */
export class ResourcesEffectsDataAccess {
  // ===== READS =====

  /**
   * List every game condition defined in `CONFIG.statusEffects`, normalizing the
   * field names across Foundry versions (icon vs img, name vs label).
   */
  async getAvailableConditions(): Promise<any> {
    shared.validateFoundryState();

    try {
      const rawConditions: any[] = (CONFIG as any).statusEffects ?? [];

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
    const knownStatusIds = new Set<string>(
      ((CONFIG as any).statusEffects ?? []).map((s: any) => s.id).filter(Boolean)
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

  // ===== WRITES =====

  /**
   * Set the current value of a named resource. Resolves in priority order:
   *   1. Spell slot — "spell3" / "level 3" / "slot3" / ordinal shorthand
   *   2. Pact magic — "pact" or "pact magic"
   *   3. Class resource — matched by key or label (case-insensitive, substring)
   *   4. Item charge — matched by item name (case-insensitive, substring)
   *
   * dnd5e v3+ items store charges via `uses.spent`; legacy items use `uses.value`.
   * The `spent` path is preferred when present so the write actually takes.
   */
  async updateCharacterResource(data: {
    identifier: string;
    resourceName: string;
    newValue: number;
  }): Promise<any> {
    shared.validateFoundryState();

    const actor = shared.findActorByIdentifier(data.identifier);
    if (!actor) {
      throw new Error(`${ERROR_MESSAGES.CHARACTER_NOT_FOUND}: ${data.identifier}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const sys: any = actor.system ?? {};
    const name = String(data.resourceName).toLowerCase().trim();
    const newValue = Number(data.newValue);

    if (!Number.isFinite(newValue) || newValue < 0) {
      throw new Error('newValue must be a non-negative integer');
    }

    // --- Spell slot path ---
    const slotLevel = this.parseSpellSlotLevel(name);
    if (slotLevel !== null) {
      const slot = sys.spells?.[`spell${slotLevel}`];
      if (!slot) throw new Error(`No spell${slotLevel} slot found on ${actor.name}`);
      const max: number = slot.max ?? 0;
      if (newValue > max) {
        throw new Error(`newValue ${newValue} exceeds max ${max} for "${data.resourceName}"`);
      }
      await actor.update({ [`system.spells.spell${slotLevel}.value`]: newValue });
      shared.auditLog('updateCharacterResource', data, 'success');
      return {
        success: true,
        actorId: actor.id,
        actorName: actor.name,
        resourceName: data.resourceName,
        newValue,
        max,
      };
    }

    // --- Pact magic path ---
    if (name === 'pact' || name === 'pact magic') {
      if (!sys.spells?.pact) throw new Error(`No pact magic slots on ${actor.name}`);
      const max: number = sys.spells.pact.max ?? 0;
      if (newValue > max) {
        throw new Error(`newValue ${newValue} exceeds max ${max} for "${data.resourceName}"`);
      }
      await actor.update({ 'system.spells.pact.value': newValue });
      shared.auditLog('updateCharacterResource', data, 'success');
      return {
        success: true,
        actorId: actor.id,
        actorName: actor.name,
        resourceName: data.resourceName,
        newValue,
        max,
      };
    }

    // --- Class resource path ---
    for (const key of ['primary', 'secondary', 'tertiary']) {
      const r = sys.resources?.[key];
      if (!r) continue;
      const label = (r.label || '').toLowerCase();
      if (key === name || label === name || label?.includes(name)) {
        const max: number | null = r.max ?? null;
        if (max != null && newValue > max) {
          throw new Error(`newValue ${newValue} exceeds max ${max} for "${data.resourceName}"`);
        }
        await actor.update({ [`system.resources.${key}.value`]: newValue });
        shared.auditLog('updateCharacterResource', data, 'success');
        return {
          success: true,
          actorId: actor.id,
          actorName: actor.name,
          resourceName: data.resourceName,
          newValue,
          max,
        };
      }
    }

    // --- Item charge path ---
    const item = actor.items.find(
      (i: any) => i.name.toLowerCase() === name || i.name.toLowerCase().includes(name)
    );
    if (item?.system?.uses) {
      const uses = item.system.uses;
      const itemMax = Number(uses.max);
      if (Number.isFinite(itemMax) && newValue > itemMax) {
        throw new Error(`newValue ${newValue} exceeds max ${itemMax} for item "${item.name}"`);
      }
      // dnd5e v3+ exposes `value` as a derived getter (max - spent). Prefer writing
      // `spent` when present so the mutation is actually stored.
      if (uses.spent !== undefined && Number.isFinite(itemMax)) {
        await item.update({ 'system.uses.spent': Math.max(0, itemMax - newValue) });
      } else {
        await item.update({ 'system.uses.value': newValue });
      }
      shared.auditLog('updateCharacterResource', { ...data, type: 'item' }, 'success');
      return {
        success: true,
        actorId: actor.id,
        actorName: actor.name,
        resourceName: item.name,
        newValue,
        max: Number.isFinite(itemMax) ? itemMax : null,
        type: 'item',
      };
    }

    throw new Error(
      `Resource not found: "${data.resourceName}". Try a spell level (e.g. "spell3"), a class resource label, or an item name.`
    );
  }

  /**
   * Delete `ActiveEffect` documents from an actor.
   *
   * With `conditionNames`: removes effects whose name or status id matches any
   * entry (case-insensitive).
   * Without `conditionNames`: removes only effects whose `duration.remaining <= 0`.
   */
  async clearStaleConditions(data: {
    identifier: string;
    conditionNames?: string[];
  }): Promise<any> {
    shared.validateFoundryState();

    const actor = shared.findActorByIdentifier(data.identifier);
    if (!actor) {
      throw new Error(`${ERROR_MESSAGES.CHARACTER_NOT_FOUND}: ${data.identifier}`);
    }

    const targetNames = (data.conditionNames ?? []).map(n => String(n).toLowerCase());
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const effectList: any[] = actor.effects?.contents ?? actor.effects ?? [];

    const toRemove = effectList.filter((e: any) => this.shouldRemoveEffect(e, targetNames));

    if (toRemove.length > 0) {
      await actor.deleteEmbeddedDocuments(
        'ActiveEffect',
        toRemove.map((e: any) => e.id)
      );
    }

    shared.auditLog('clearStaleConditions', data, 'success');

    return {
      success: true,
      actorId: actor.id,
      actorName: actor.name,
      removedCount: toRemove.length,
      removed: toRemove.map((e: any) => e.name || e.label),
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
   * Current charge logic:
   *   - When `uses.value` is present (legacy style): `current = uses.value`.
   *   - Otherwise (dnd5e v3 `spent` style): `current = max(0, max - spent)`.
   *
   * Recharge source priority: `uses.per` → `uses.recovery[0].period` → `system.recharge.value`.
   */
  private readItemCharges(actor: any): any[] {
    const charges: any[] = [];

    for (const item of actor.items) {
      const uses = item.system?.uses;
      if (!uses) continue;

      const max = Number(uses.max);
      if (!Number.isFinite(max) || max <= 0) continue;

      const current =
        uses.value != null ? Number(uses.value) : Math.max(0, max - (Number(uses.spent) || 0));

      const recharge =
        uses.per ||
        (Array.isArray(uses.recovery) ? uses.recovery[0]?.period : undefined) ||
        item.system?.recharge?.value ||
        null;

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
   * Spell name preference: `flags.dnd5e.item.name` → name stripped of the
   * "Concentrating: " prefix. Remaining time: `duration.remaining` → `duration.seconds`.
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

      const spellName =
        conc.flags?.dnd5e?.item?.name ||
        (conc.name || '').replace(/concentrating:?\s*/i, '').trim() ||
        null;

      return {
        active: true,
        spell: spellName || null,
        remaining: conc.duration?.remaining ?? conc.duration?.seconds ?? null,
      };
    } catch {
      return { active: false };
    }
  }

  /**
   * Read hit dice. Prefers the consolidated `system.attributes.hd` object
   * (Foundry/dnd5e supplies `max`, `value`, and `denomination`); when absent,
   * aggregates across `class`-type items (`levels`, `hitDiceUsed`, `hitDice`).
   * Returns `null` when neither source has data.
   */
  private readHitDice(sys: any, actor: any): any {
    // Primary source: consolidated hd object.
    const hd = sys.attributes?.hd;
    if (hd && typeof hd === 'object') {
      const max = hd.max ?? null;
      const value = hd.value ?? null;
      if (max != null || value != null) {
        return { total: max, available: value, dieType: hd.denomination || null };
      }
    }

    // Fallback: sum across class items.
    let total = 0;
    let available = 0;
    let dieType: string | null = null;

    for (const item of actor.items) {
      if (item.type === 'class') {
        const c = item.system ?? {};
        total += c.levels ?? 0;
        available += (c.levels ?? 0) - (c.hitDiceUsed ?? 0);
        dieType = c.hitDice || dieType;
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
   * Parse a resource name string into a spell slot level (1–9), or return `null`
   * when the string does not describe a spell level.
   *
   * Accepted forms: "spell3", "level 3", "slot3", "3rd level", "3" (bare ordinal).
   */
  private parseSpellSlotLevel(name: string): string | null {
    const matchKeyword =
      name.match(/(?:spell|slot|level)\s*([1-9])/) || name.match(/^([1-9])(?:st|nd|rd|th)?$/);
    return matchKeyword ? (matchKeyword[1] ?? null) : null;
  }

  /**
   * Build a normalized descriptor for one `ActiveEffect` document.
   * `isCondition` is true only when one of the effect's status ids is registered
   * in `CONFIG.statusEffects` — a spell that happens to apply 'concentrating' is
   * not a game condition.
   */
  private describeEffect(e: any, knownStatusIds: Set<string>): any {
    const statuses: string[] = Array.from(e.statuses ?? []);
    const isCondition = statuses.some(s => knownStatusIds.has(s));

    const dur = e.duration ?? {};
    const changes = (e.changes ?? []).map((c: any) => ({
      key: c.key,
      mode: c.mode,
      value: c.value,
    }));

    const requiresConcentration =
      !!e.flags?.dnd5e?.concentration || /concentrat/i.test(e.name || e.label || '');

    return {
      id: e.id,
      name: e.name || e.label || 'Unknown Effect',
      icon: e.icon || e.img || null,
      disabled: e.disabled ?? false,
      isCondition,
      type: isCondition ? 'condition' : 'buff/debuff',
      statuses,
      duration: {
        rounds: dur.rounds ?? null,
        turns: dur.turns ?? null,
        seconds: dur.seconds ?? null,
        remaining: dur.remaining ?? null,
      },
      changes,
      requiresConcentration,
    };
  }

  /**
   * Whether an effect should be removed by `clearStaleConditions`.
   *
   * With explicit targets: match by name (case-insensitive) or by status id.
   * Without targets: match only effects whose `duration.remaining` is set and <= 0.
   */
  private shouldRemoveEffect(e: any, targetNames: string[]): boolean {
    if (targetNames.length > 0) {
      const ename = (e.name || e.label || '').toLowerCase();
      const statuses: string[] = Array.from(e.statuses ?? []).map((s: any) =>
        String(s).toLowerCase()
      );
      return targetNames.includes(ename) || statuses.some(s => targetNames.includes(s));
    }

    // No list supplied — only remove effects with an expired timer.
    const remaining = e.duration?.remaining;
    return remaining != null && remaining <= 0;
  }
}
