import { ERROR_MESSAGES } from '../constants.js';
import * as shared from './shared.js';

/** Character resources + active effects/conditions domain — extracted from FoundryDataAccess. */
export class ResourcesEffectsDataAccess {
  /**
   * Get all available conditions for the current game system
   */
  async getAvailableConditions(): Promise<any> {
    shared.validateFoundryState();

    try {
      const conditions = (CONFIG as any).statusEffects || [];

      return {
        success: true,
        gameSystem: game.system?.id,
        conditions: conditions.map((condition: any) => ({
          id: condition.id,
          name: condition.name || condition.label || condition.id,
          icon: condition.icon || condition.img,
          description: condition.description || '',
        })),
      };
    } catch (error) {
      throw new Error(
        `Failed to get available conditions: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async getCharacterResources(data: { identifier: string }): Promise<any> {
    shared.validateFoundryState();

    const actor = shared.findActorByIdentifier(data.identifier);
    if (!actor) {
      throw new Error(`${ERROR_MESSAGES.CHARACTER_NOT_FOUND}: ${data.identifier}`);
    }
    const sys = (actor as any).system || {};

    // --- Spell slots ---
    const spellSlots: Record<string, any> = {};
    const spells = sys.spells || {};
    for (let i = 1; i <= 9; i++) {
      const slot = spells[`spell${i}`];
      if (slot && ((slot.max ?? 0) > 0 || (slot.value ?? 0) > 0)) {
        const max = slot.max ?? 0;
        const current = slot.value ?? 0;
        spellSlots[`level${i}`] = { max, current, expended: Math.max(0, max - current) };
      }
    }
    if (spells.pact && (spells.pact.max ?? 0) > 0) {
      const max = spells.pact.max ?? 0;
      const current = spells.pact.value ?? 0;
      spellSlots['pact'] = {
        max,
        current,
        expended: Math.max(0, max - current),
        level: spells.pact.level ?? null,
      };
    }

    // --- Class resources (primary / secondary / tertiary) ---
    const classResources: any[] = [];
    const resources = sys.resources || {};
    for (const key of ['primary', 'secondary', 'tertiary']) {
      const r = resources[key];
      if (!r) continue;
      const hasLabel = !!r.label;
      const hasMax = r.max != null && r.max !== 0;
      if (!hasLabel && !hasMax) continue;
      classResources.push({
        key,
        label: r.label || key,
        max: r.max ?? null,
        current: r.value ?? null,
      });
    }

    // --- Item charges ---
    const itemCharges: any[] = [];
    for (const item of actor.items) {
      const uses = (item as any).system?.uses;
      if (!uses) continue;
      const max = Number(uses.max);
      if (!Number.isFinite(max) || max <= 0) continue;
      // dnd5e v3 tracks `spent`; older versions track `value`
      const current =
        uses.value != null ? Number(uses.value) : Math.max(0, max - (Number(uses.spent) || 0));
      const recharge =
        uses.per ||
        (Array.isArray(uses.recovery) ? uses.recovery[0]?.period : undefined) ||
        (item as any).system?.recharge?.value ||
        null;
      itemCharges.push({ itemName: item.name, charges: current, max, recharge });
    }

    // --- Concentration ---
    let concentration: any = { active: false };
    try {
      const effects = (actor.effects as any)?.contents ?? actor.effects ?? [];
      const conc = effects.find(
        (e: any) =>
          e.statuses?.has?.('concentrating') ||
          /concentrat/i.test(e.name || e.label || '') ||
          !!e.flags?.dnd5e?.itemData
      );
      if (conc) {
        const spellName =
          conc.flags?.dnd5e?.item?.name ||
          (conc.name || '').replace(/concentrating:?\s*/i, '').trim() ||
          null;
        concentration = {
          active: true,
          spell: spellName || null,
          remaining: conc.duration?.remaining ?? conc.duration?.seconds ?? null,
        };
      }
    } catch {
      // best-effort
    }

    // --- Hit dice ---
    let hitDice: any = null;
    const hd = sys.attributes?.hd;
    if (hd && typeof hd === 'object') {
      const max = hd.max ?? null;
      const value = hd.value ?? null;
      if (max != null || value != null) {
        hitDice = { total: max, available: value, dieType: hd.denomination || null };
      }
    }
    if (!hitDice) {
      let total = 0;
      let available = 0;
      let dieType: string | null = null;
      for (const item of actor.items) {
        if (item.type === 'class') {
          const c = (item as any).system || {};
          total += c.levels ?? 0;
          available += (c.levels ?? 0) - (c.hitDiceUsed ?? 0);
          dieType = c.hitDice || dieType;
        }
      }
      if (total > 0) hitDice = { total, available, dieType };
    }

    // --- Death saves (only relevant at 0 HP) ---
    let deathSaves: any = null;
    const hp = sys.attributes?.hp;
    if (hp && (hp.value ?? 1) <= 0) {
      const death = sys.attributes?.death;
      deathSaves = { successes: death?.success ?? 0, failures: death?.failure ?? 0 };
    }

    return {
      success: true,
      actorId: actor.id,
      actorName: actor.name,
      system: game.system?.id,
      spellSlots,
      classResources,
      itemCharges,
      concentration,
      hitDice,
      deathSaves,
    };
  }

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
    const sys = (actor as any).system || {};

    const name = String(data.resourceName).toLowerCase().trim();
    const newValue = Number(data.newValue);
    if (!Number.isFinite(newValue) || newValue < 0) {
      throw new Error('newValue must be a non-negative integer');
    }

    let updatePath: string | null = null;
    let max: number | null = null;

    // Spell slots: "spell3" / "level 3" / "slot3" / "3rd level"
    const slotMatch =
      name.match(/(?:spell|slot|level)\s*([1-9])/) || name.match(/^([1-9])(?:st|nd|rd|th)?$/);
    if (slotMatch) {
      const lvl = slotMatch[1];
      const slot = sys.spells?.[`spell${lvl}`];
      if (!slot) throw new Error(`No spell${lvl} slot found on ${actor.name}`);
      updatePath = `system.spells.spell${lvl}.value`;
      max = slot.max ?? 0;
    } else if (name === 'pact' || name === 'pact magic') {
      if (!sys.spells?.pact) throw new Error(`No pact magic slots on ${actor.name}`);
      updatePath = 'system.spells.pact.value';
      max = sys.spells.pact.max ?? 0;
    } else {
      // Class resources by key or label
      for (const key of ['primary', 'secondary', 'tertiary']) {
        const r = sys.resources?.[key];
        if (!r) continue;
        const label = (r.label || '').toLowerCase();
        if (key === name || label === name || (label && label.includes(name))) {
          updatePath = `system.resources.${key}.value`;
          max = r.max ?? null;
          break;
        }
      }

      // Item charges by name
      if (!updatePath) {
        const item = actor.items.find(
          (i: any) => i.name.toLowerCase() === name || i.name.toLowerCase().includes(name)
        );
        if (item && (item as any).system?.uses) {
          const uses = (item as any).system.uses;
          const itemMax = Number(uses.max);
          if (Number.isFinite(itemMax) && newValue > itemMax) {
            throw new Error(`newValue ${newValue} exceeds max ${itemMax} for item "${item.name}"`);
          }
          // dnd5e v3+ stores `spent` and exposes `value` as a derived,
          // read-only getter (max - spent). Prefer writing `spent` when present
          // so the update actually takes; fall back to `value` for legacy data.
          if (uses.spent !== undefined && Number.isFinite(itemMax)) {
            await (item as any).update({ 'system.uses.spent': Math.max(0, itemMax - newValue) });
          } else {
            await (item as any).update({ 'system.uses.value': newValue });
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
      }
    }

    if (!updatePath) {
      throw new Error(
        `Resource not found: "${data.resourceName}". Try a spell level (e.g. "spell3"), a class resource label, or an item name.`
      );
    }

    if (max != null && newValue > max) {
      throw new Error(`newValue ${newValue} exceeds max ${max} for "${data.resourceName}"`);
    }

    await (actor as any).update({ [updatePath]: newValue });
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

  async getActiveEffects(data: { identifier: string }): Promise<any> {
    shared.validateFoundryState();

    const actor = shared.findActorByIdentifier(data.identifier);
    if (!actor) {
      throw new Error(`${ERROR_MESSAGES.CHARACTER_NOT_FOUND}: ${data.identifier}`);
    }

    const statusIds = new Set<string>(
      ((CONFIG as any).statusEffects ?? []).map((s: any) => s.id).filter(Boolean)
    );

    const effs = (actor.effects as any)?.contents ?? actor.effects ?? [];
    const effects = effs.map((e: any) => {
      const statuses: string[] = Array.from(e.statuses ?? []);
      // A condition is an effect whose status id is a registered game condition
      // (CONFIG.statusEffects). Don't treat every status-bearing effect (e.g. a
      // spell that applies "concentrating") as a condition.
      const isCondition = statuses.some(s => statusIds.has(s));
      const dur = e.duration || {};
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
    });

    return {
      success: true,
      actorId: actor.id,
      actorName: actor.name,
      count: effects.length,
      effects,
    };
  }

  async clearStaleConditions(data: {
    identifier: string;
    conditionNames?: string[];
  }): Promise<any> {
    shared.validateFoundryState();

    const actor = shared.findActorByIdentifier(data.identifier);
    if (!actor) {
      throw new Error(`${ERROR_MESSAGES.CHARACTER_NOT_FOUND}: ${data.identifier}`);
    }

    const names = (data.conditionNames ?? []).map(n => String(n).toLowerCase());
    const effs = (actor.effects as any)?.contents ?? actor.effects ?? [];

    const toRemove = effs.filter((e: any) => {
      const ename = (e.name || e.label || '').toLowerCase();
      const statuses: string[] = Array.from(e.statuses ?? []).map((s: any) =>
        String(s).toLowerCase()
      );
      if (names.length > 0) {
        return names.includes(ename) || statuses.some(s => names.includes(s));
      }
      // No explicit list: remove expired conditions only
      const rem = e.duration?.remaining;
      return rem != null && rem <= 0;
    });

    if (toRemove.length > 0) {
      await (actor as any).deleteEmbeddedDocuments(
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
}
