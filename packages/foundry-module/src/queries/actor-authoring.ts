/**
 * Bridge handlers that build actors and items: actors from a compendium, items on an actor
 * sheet, world items and the D&D 5e feature, attack and spell builders.
 */
import type { BridgeHandlerTable } from '../bridge-handlers.js';
import { MODULE_ID } from '../constants.js';
import { withCtx, type DataArg, type QueryContext } from './context.js';

/**
 * Registration table: wire method name (after `${MODULE_ID}.`) and its kind. The kind decides
 * the write gate (write-gate.ts): `write` and `recordless-write` are refused while "Allow Write
 * Operations" is off; `read` is never gated.
 */
export function registerActorAuthoringHandlers(ctx: QueryContext, table: BridgeHandlerTable): void {
  // Actors and items
  table.set(
    `${MODULE_ID}.createActorFromCompendium`,
    'write',
    withCtx(ctx, createActorFromCompendium)
  );
  table.set(`${MODULE_ID}.addActorItems`, 'write', withCtx(ctx, addActorItems));

  // World-level item CRUD
  table.set(`${MODULE_ID}.createWorldItems`, 'write', withCtx(ctx, createWorldItems));
  table.set(`${MODULE_ID}.listWorldItems`, 'read', withCtx(ctx, listWorldItems));
  table.set(`${MODULE_ID}.updateWorldItems`, 'write', withCtx(ctx, updateWorldItems));

  // D&D 5e builders
  table.set(`${MODULE_ID}.addSaveFeatureToActor`, 'write', withCtx(ctx, addSaveFeatureToActor));
  table.set(`${MODULE_ID}.createNpcActor`, 'write', withCtx(ctx, createNpcActor));
  table.set(`${MODULE_ID}.addAttackToActor`, 'write', withCtx(ctx, addAttackToActor));
  table.set(`${MODULE_ID}.addAuraToActor`, 'write', withCtx(ctx, addAuraToActor));
  table.set(
    `${MODULE_ID}.addPassiveFeatureToActor`,
    'write',
    withCtx(ctx, addPassiveFeatureToActor)
  );
  table.set(
    `${MODULE_ID}.addAttackWithSaveToActor`,
    'write',
    withCtx(ctx, addAttackWithSaveToActor)
  );
  table.set(`${MODULE_ID}.setActorSpellcasting`, 'write', withCtx(ctx, setActorSpellcasting));
  table.set(`${MODULE_ID}.addSpellsToActor`, 'write', withCtx(ctx, addSpellsToActor));
  table.set(
    `${MODULE_ID}.addFeaturesFromCompendium`,
    'write',
    withCtx(ctx, addFeaturesFromCompendium)
  );
}

/**
 * Handle actor creation from specific compendium entry
 */
async function createActorFromCompendium(
  ctx: QueryContext,
  data: {
    packId: string;
    itemId: string;
    customNames?: string[] | undefined;
    quantity?: number | undefined;
    addToScene?: boolean | undefined;
    placement?:
      | {
          type: 'random' | 'grid' | 'center' | 'coordinates';
          coordinates?: { x: number; y: number }[];
        }
      | undefined;
  }
): Promise<unknown> {
  return ctx.withGmGate('Failed to create actor from compendium', async () => {
    // Clean interface - direct pack/item reference only
    const requestData: DataArg<'createActorFromCompendiumEntry'> = {
      packId: data.packId,
      itemId: data.itemId,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- keep `||`: a non-array falsy value (for example '') must still fall back to [] (behaviour-neutral sweep)
      customNames: data.customNames || [],
      quantity: data.quantity || 1,
      addToScene: data.addToScene || false,
    };

    if (data.placement) {
      requestData.placement = data.placement;
    }

    return await ctx.dataAccess.createActorFromCompendiumEntry(requestData);
  });
}

async function addActorItems(
  ctx: QueryContext,
  data: {
    actorIdentifier: string;
    items: Array<{
      name: string;
      type: string;
      img?: string;
      system?: Record<string, unknown>;
    }>;
  }
): Promise<unknown> {
  return ctx.withGmGate('Failed to add actor items', async () => {
    if (!data?.actorIdentifier) {
      throw new Error('actorIdentifier is required');
    }
    if (!Array.isArray(data?.items) || data.items.length === 0) {
      throw new Error('items array is required and must contain at least one entry');
    }

    return await ctx.dataAccess.addActorItems({
      actorIdentifier: data.actorIdentifier,
      items: data.items,
    });
  });
}

async function updateWorldItems(
  ctx: QueryContext,
  data: {
    updates: Array<{
      id: string;
      name?: string;
      img?: string;
      system?: Record<string, unknown>;
      folder?: string;
    }>;
  }
): Promise<unknown> {
  return ctx.withGmGate('Failed to update world items', async () => {
    if (!Array.isArray(data?.updates) || data.updates.length === 0) {
      throw new Error('updates array is required and must contain at least one entry');
    }

    return await ctx.dataAccess.updateWorldItems({ updates: data.updates });
  });
}

async function listWorldItems(
  ctx: QueryContext,
  data: {
    type?: string;
    folder?: string;
    nameFilter?: string;
  }
): Promise<unknown> {
  return ctx.withGmGate('Failed to list world items', async () => {
    return await ctx.dataAccess.listWorldItems({
      ...(data.type !== undefined ? { type: data.type } : {}),
      ...(data.folder !== undefined ? { folder: data.folder } : {}),
      ...(data.nameFilter !== undefined ? { nameFilter: data.nameFilter } : {}),
    });
  });
}

async function createWorldItems(
  ctx: QueryContext,
  data: {
    items: Array<{
      name: string;
      type: string;
      img?: string;
      system?: Record<string, unknown>;
    }>;
    folder?: string;
  }
): Promise<unknown> {
  return ctx.withGmGate('Failed to create world items', async () => {
    if (!Array.isArray(data?.items) || data.items.length === 0) {
      throw new Error('items array is required and must contain at least one entry');
    }

    return await ctx.dataAccess.createWorldItems({
      items: data.items,
      ...(data.folder !== undefined ? { folder: data.folder } : {}),
    });
  });
}

// ===== D&D 5E HANDLERS =====

/**
 * Handle add save feature to actor request (D&D 5e only)
 */
async function addSaveFeatureToActor(
  ctx: QueryContext,
  data: DataArg<'addSaveFeatureToActor'>
): Promise<unknown> {
  return ctx.withGmGate('Failed to add save feature to actor', async () => {
    if (!data.actorIdentifier) {
      throw new Error('actorIdentifier is required');
    }
    if (!data.featureName) {
      throw new Error('featureName is required');
    }

    return await ctx.dataAccess.addSaveFeatureToActor(data);
  });
}

/**
 * Handle create NPC actor request (D&D 5e only)
 */
async function createNpcActor(
  ctx: QueryContext,
  data: DataArg<'createNpcActor'>
): Promise<unknown> {
  return ctx.withGmGate('Failed to create NPC actor', async () => {
    if (!data.name) {
      throw new Error('name is required');
    }
    if (data.cr === undefined || data.cr === null) {
      throw new Error('cr is required');
    }
    if (!data.creatureType) {
      throw new Error('creatureType is required');
    }
    if (!data.size) {
      throw new Error('size is required');
    }
    if (!data.abilities || typeof data.abilities !== 'object') {
      throw new Error('abilities is required and must be an object');
    }
    if (data.hpAverage === undefined || data.hpAverage === null) {
      throw new Error('hpAverage is required');
    }
    if (!data.hpFormula) {
      throw new Error('hpFormula is required');
    }
    if (!data.acMode) {
      throw new Error('acMode is required');
    }

    return await ctx.dataAccess.createNpcActor(data);
  });
}

/**
 * Handle add attack feature to actor request (D&D 5e only)
 */
async function addAttackToActor(
  ctx: QueryContext,
  data: DataArg<'addAttackToActor'>
): Promise<unknown> {
  return ctx.withGmGate('Failed to add attack to actor', async () => {
    if (!data.actorIdentifier) {
      throw new Error('actorIdentifier is required');
    }
    if (!data.featureName) {
      throw new Error('featureName is required');
    }
    if (!data.attackType) {
      throw new Error('attackType is required');
    }
    if (!Array.isArray(data.damageParts) || data.damageParts.length === 0) {
      throw new Error('damageParts is required and must contain at least one element');
    }

    return await ctx.dataAccess.addAttackToActor(data);
  });
}

/**
 * Handle add aura feature to actor request (D&D 5e only)
 */
async function addAuraToActor(
  ctx: QueryContext,
  data: DataArg<'addAuraToActor'>
): Promise<unknown> {
  return ctx.withGmGate('Failed to add aura to actor', async () => {
    if (!data.actorIdentifier) {
      throw new Error('actorIdentifier is required');
    }
    if (!data.featureName) {
      throw new Error('featureName is required');
    }
    if (!Array.isArray(data.damageParts) || data.damageParts.length === 0) {
      throw new Error('damageParts is required and must contain at least one element');
    }
    if (!data.areaType) {
      throw new Error('areaType is required');
    }
    if (data.areaSize === undefined || data.areaSize === null) {
      throw new Error('areaSize is required');
    }

    return await ctx.dataAccess.addAuraToActor(data);
  });
}

/**
 * Handle add passive feature to actor request (D&D 5e only)
 */
async function addPassiveFeatureToActor(
  ctx: QueryContext,
  data: DataArg<'addPassiveFeatureToActor'>
): Promise<unknown> {
  return ctx.withGmGate('Failed to add passive feature to actor', async () => {
    if (!data.actorIdentifier) {
      throw new Error('actorIdentifier is required');
    }
    if (!data.featureName) {
      throw new Error('featureName is required');
    }

    return await ctx.dataAccess.addPassiveFeatureToActor(data);
  });
}

/**
 * Handle add attack+save feature to actor request (D&D 5e only)
 */
async function addAttackWithSaveToActor(
  ctx: QueryContext,
  data: DataArg<'addAttackWithSaveToActor'>
): Promise<unknown> {
  return ctx.withGmGate('Failed to add attack+save to actor', async () => {
    if (!data.actorIdentifier) throw new Error('actorIdentifier is required');
    if (!data.featureName) throw new Error('featureName is required');
    if (!data.attackType) throw new Error('attackType is required');
    if (!Array.isArray(data.damageParts) || data.damageParts.length === 0) {
      throw new Error('damageParts is required and must contain at least one element');
    }
    if (!data.saveAbility) throw new Error('saveAbility is required');
    if (!data.saveDC) throw new Error('saveDC is required');
    if (!Array.isArray(data.saveDamageParts) || data.saveDamageParts.length === 0) {
      throw new Error('saveDamageParts is required and must contain at least one element');
    }

    return await ctx.dataAccess.addAttackWithSaveToActor(data);
  });
}

async function setActorSpellcasting(
  ctx: QueryContext,
  data: DataArg<'setActorSpellcasting'>
): Promise<unknown> {
  return ctx.withGmGate('Failed to set actor spellcasting', async () => {
    if (!data.actorIdentifier) {
      throw new Error('actorIdentifier is required');
    }
    if (!data.spellcastingClass) {
      throw new Error('spellcastingClass is required');
    }
    if (
      typeof data.spellcastingLevel !== 'number' ||
      data.spellcastingLevel < 1 ||
      data.spellcastingLevel > 20
    ) {
      throw new Error('spellcastingLevel must be a number between 1 and 20');
    }
    if (!data.effectiveAbility) {
      throw new Error('effectiveAbility is required');
    }

    return await ctx.dataAccess.setActorSpellcasting(data);
  });
}

async function addSpellsToActor(
  ctx: QueryContext,
  data: DataArg<'addSpellsToActor'>
): Promise<unknown> {
  return ctx.withGmGate('Failed to add spells to actor', async () => {
    if (!data.actorIdentifier) {
      throw new Error('actorIdentifier is required');
    }
    if (!Array.isArray(data.spellNames) || data.spellNames.length === 0) {
      throw new Error('spellNames is required and must contain at least one element');
    }
    if (data.spellNames.length > 50) {
      throw new Error('spellNames cannot contain more than 50 elements');
    }

    return await ctx.dataAccess.addSpellsToActor(data);
  });
}

async function addFeaturesFromCompendium(
  ctx: QueryContext,
  data: DataArg<'addFeaturesFromCompendium'>
): Promise<unknown> {
  return ctx.withGmGate('Failed to add features from compendium', async () => {
    if (!data.actorIdentifier) {
      throw new Error('actorIdentifier is required');
    }
    if (!Array.isArray(data.featureNames) || data.featureNames.length === 0) {
      throw new Error('featureNames is required and must contain at least one element');
    }
    if (data.featureNames.length > 50) {
      throw new Error('featureNames cannot contain more than 50 elements');
    }

    return await ctx.dataAccess.addFeaturesFromCompendium(data);
  });
}
