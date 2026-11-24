/**
 * Bridge handlers about actors, characters and tokens: lookups, ownership, items on a
 * character, resources and effects, "My character" and the player's own Claude, portraits.
 * (Building actors and items is in actor-authoring.ts.)
 */
import type { BridgeAnswer, BridgeRequest } from '@gnuminator/shared';
import type { BridgeHandlerTable } from '../bridge-handlers.js';
import { MODULE_ID } from '../constants.js';
import { CHARACTER_SHEET_QUERY, PLAYER_ROLL_QUERY, characterSheets } from '../character-sheet.js';
import { PLAYER_READ_QUERY, playerRead } from '../player-read.js';
import { UPLOAD_ACTOR_IMAGE_QUERY, uploadActorImage } from '../actor-image.js';
import { UPLOAD_HANDOUT_IMAGE_QUERY, uploadHandoutImage } from '../handout-image.js';
import { UPLOAD_PLAYER_PORTRAIT_QUERY, uploadPlayerPortrait } from '../player-portrait.js';
import { withCtx, type DataArg, type QueryContext } from './context.js';

/**
 * Registration table: wire method name (after `${MODULE_ID}.`) and its kind. The kind decides
 * the write gate (write-gate.ts): `write` and `recordless-write` are refused while "Allow Write
 * Operations" is off; `read` is never gated.
 */
export function registerActorHandlers(ctx: QueryContext, table: BridgeHandlerTable): void {
  // Characters and actors
  table.set(`${MODULE_ID}.getCharacterInfo`, 'read', withCtx(ctx, getCharacterInfo));
  table.set(`${MODULE_ID}.listActors`, 'read', withCtx(ctx, listActors));
  table.set(`${MODULE_ID}.getActorOwnership`, 'read', withCtx(ctx, getActorOwnership));
  table.set(`${MODULE_ID}.getFriendlyNPCs`, 'read', () => getFriendlyNPCs(ctx));
  table.set(`${MODULE_ID}.getPartyCharacters`, 'read', () => getPartyCharacters(ctx));
  table.set(`${MODULE_ID}.getConnectedPlayers`, 'read', () => getConnectedPlayers(ctx));
  table.set(`${MODULE_ID}.findPlayers`, 'read', withCtx(ctx, findPlayers));
  table.set(`${MODULE_ID}.findActor`, 'read', withCtx(ctx, findActor));

  // Tokens and conditions
  table.on(`${MODULE_ID}.get-token-details`, 'read', withCtx(ctx, getTokenDetails));
  table.on(`${MODULE_ID}.get-available-conditions`, 'read', () => getAvailableConditions(ctx));

  // Items, resources and effects of one character
  table.on(`${MODULE_ID}.useItem`, 'write', withCtx(ctx, useItem));
  table.set(`${MODULE_ID}.searchCharacterItems`, 'read', withCtx(ctx, searchCharacterItems));
  table.on(`${MODULE_ID}.getCharacterEntity`, 'read', withCtx(ctx, getCharacterEntity));
  table.on(`${MODULE_ID}.getCharacterResources`, 'read', withCtx(ctx, getCharacterResources));
  table.set(`${MODULE_ID}.getLevelUpOptions`, 'read', withCtx(ctx, getLevelUpOptions));
  table.on(`${MODULE_ID}.getActiveEffects`, 'read', withCtx(ctx, getActiveEffects));

  // My character (I-096): the sheets of the characters one player owns, for the dashboard's
  // /me page. Read-only; the dashboard maps the player's link key to the user id. Not an MCP
  // tool (the control method `character_sheet`). GM client only.
  table.on(`${MODULE_ID}.${CHARACTER_SHEET_QUERY}`, 'read', (data: unknown) =>
    ctx.withGmGate('Character sheet failed', async () => {
      const result = await characterSheets(data);
      return { ...result, rollRequests: ctx.dataAccess.listOpenRollRequests(result.userId) };
    })
  );

  // A player's own Claude (playerRead): their sheets, level-up options and the books they may
  // read, scoped to the one user id in the message. Read-only; the pack's permission level
  // alone controls access (a document inside a pack follows its pack). Not an MCP tool for
  // the GM connectors (the control method `player_tool`). GM client only.
  table.set(`${MODULE_ID}.${PLAYER_READ_QUERY}`, 'read', (data: unknown) =>
    ctx.withGmGate('Player read failed', () => playerRead(data, ctx.dataAccess.playerReadDeps()))
  );

  // The player pressed a roll button on the dashboard's page: this GM client rolls for their
  // character and marks the request done (the module checks the button is theirs). A write
  // (write-gate.ts); not an MCP tool (the control method `player_roll`). GM client only.
  table.on(`${MODULE_ID}.${PLAYER_ROLL_QUERY}`, 'recordless-write', (data: unknown) =>
    ctx.withGmGate('Player roll failed', () => {
      const body = (data ?? {}) as { userId?: unknown; buttonId?: unknown };
      if (typeof body.userId !== 'string' || typeof body.buttonId !== 'string') {
        return Promise.resolve({
          success: false,
          error: 'A user and a roll button are required.',
        });
      }
      return ctx.dataAccess.executePlayerRoll(body.userId, body.buttonId);
    })
  );

  // "Upload my portrait": store a picture a player sent for a character they own, in
  // assets/players/<slug>-<user id>/, only while the player-portrait switch is on (player-portrait.ts checks ownership and the bytes). A write
  // (write-gate.ts); not an MCP tool (the control method `player_portrait`). GM client only.
  table.on(`${MODULE_ID}.${UPLOAD_PLAYER_PORTRAIT_QUERY}`, 'recordless-write', (data: unknown) =>
    ctx.withGmGate('Portrait upload failed', () => uploadPlayerPortrait(data))
  );

  // plan-actor-image: store a picture the backend read from an allowed PC folder, in
  // assets/ai-art/<actor>/ (actor-image.ts checks the bytes and finds the actor). A write
  // (write-gate.ts); the actor change itself is a guarded plan. GM client only.
  table.on(`${MODULE_ID}.${UPLOAD_ACTOR_IMAGE_QUERY}`, 'recordless-write', (data: unknown) =>
    ctx.withGmGate('Actor image upload failed', () => uploadActorImage(data))
  );

  // plan-handout-press: store a handout picture the backend rendered, in assets/ai-art/handouts/
  // (handout-image.ts checks the bytes). A write (write-gate.ts); the page itself is a guarded
  // plan. GM client only.
  table.on(`${MODULE_ID}.${UPLOAD_HANDOUT_IMAGE_QUERY}`, 'recordless-write', (data: unknown) =>
    ctx.withGmGate('Handout image upload failed', () => uploadHandoutImage(data))
  );
}

/**
 * Handle character information request
 */
async function getCharacterInfo(
  ctx: QueryContext,
  data: {
    characterName?: string;
    characterId?: string;
  }
): Promise<unknown> {
  return ctx.withGmGate('Failed to get character info', async () => {
    const identifier = data.characterName || data.characterId;
    if (!identifier) {
      throw new Error('characterName or characterId is required');
    }

    return await ctx.dataAccess.getCharacterInfo(identifier);
  });
}

/**
 * Handle list actors request
 */
async function listActors(ctx: QueryContext, data: { type?: string }): Promise<unknown> {
  return ctx.withGmGate('Failed to list actors', async () => {
    const actors = await ctx.dataAccess.listActors();

    // Filter by type if specified
    if (data.type) {
      return actors.filter(actor => actor.type === data.type);
    }

    return actors;
  });
}

/**
 * Handle get actor ownership request
 */
async function getActorOwnership(
  ctx: QueryContext,
  data: DataArg<'getActorOwnership'>
): Promise<unknown> {
  return ctx.withGmGate('Failed to get actor ownership', async () => {
    return await ctx.dataAccess.getActorOwnership(data);
  });
}

/**
 * Handle get friendly NPCs request
 */
async function getFriendlyNPCs(ctx: QueryContext): Promise<unknown> {
  return ctx.withGmGate('Failed to get friendly NPCs', async () => {
    return await ctx.dataAccess.getFriendlyNPCs();
  });
}

/**
 * Handle get party characters request
 */
async function getPartyCharacters(ctx: QueryContext): Promise<unknown> {
  return ctx.withGmGate('Failed to get party characters', async () => {
    return await ctx.dataAccess.getPartyCharacters();
  });
}

/**
 * Handle get connected players request
 */
async function getConnectedPlayers(ctx: QueryContext): Promise<unknown> {
  return ctx.withGmGate('Failed to get connected players', async () => {
    return await ctx.dataAccess.getConnectedPlayers();
  });
}

/**
 * Handle find players request
 */
async function findPlayers(ctx: QueryContext, data: DataArg<'findPlayers'>): Promise<unknown> {
  return ctx.withGmGate('Failed to find players', async () => {
    if (!data.identifier) {
      throw new Error('identifier is required');
    }

    return await ctx.dataAccess.findPlayers(data);
  });
}

/**
 * Handle find actor request
 */
async function findActor(ctx: QueryContext, data: DataArg<'findActor'>): Promise<unknown> {
  return ctx.withGmGate('Failed to find actor', async () => {
    if (!data.identifier) {
      throw new Error('identifier is required');
    }

    return await ctx.dataAccess.findActor(data);
  });
}

/**
 * Handle get token details request
 */
async function getTokenDetails(
  ctx: QueryContext,
  data: BridgeRequest<'foundry-mcp-bridge.get-token-details'>
): Promise<BridgeAnswer<'foundry-mcp-bridge.get-token-details'>> {
  return ctx.withGmGate('Failed to get token details', async () => {
    if (!data.tokenId) {
      throw new Error('tokenId is required');
    }

    return await ctx.dataAccess.getTokenDetails(data);
  });
}

/**
 * Handle get available conditions request
 */
async function getAvailableConditions(
  ctx: QueryContext
): Promise<BridgeAnswer<'foundry-mcp-bridge.get-available-conditions'>> {
  return ctx.withGmGate('Failed to get available conditions', async () => {
    return await ctx.dataAccess.getAvailableConditions();
  });
}

/**
 * Handle use item request (cast spell, use ability, consume item, etc.)
 */
async function useItem(
  ctx: QueryContext,
  data: BridgeRequest<'foundry-mcp-bridge.useItem'>
): Promise<BridgeAnswer<'foundry-mcp-bridge.useItem'>> {
  return ctx.withGmGate('Failed to use item', async () => {
    if (!data.actorIdentifier) {
      throw new Error('actorIdentifier is required');
    }
    if (!data.itemIdentifier) {
      throw new Error('itemIdentifier is required');
    }

    return await ctx.dataAccess.useItem({
      actorIdentifier: data.actorIdentifier,
      itemIdentifier: data.itemIdentifier,
      targets: data.targets,
      options: data.options,
    });
  });
}

/**
 * Handle search character items request
 */
async function searchCharacterItems(
  ctx: QueryContext,
  data: {
    characterIdentifier: string;
    query?: string;
    type?: string;
    category?: string;
    limit?: number;
  }
): Promise<unknown> {
  return ctx.withGmGate('Failed to search character items', async () => {
    if (!data.characterIdentifier) {
      throw new Error('characterIdentifier is required');
    }

    return await ctx.dataAccess.searchCharacterItems({
      characterIdentifier: data.characterIdentifier,
      query: data.query,
      type: data.type,
      category: data.category,
      limit: data.limit,
    });
  });
}

/** One item (with its dnd5e 6 activities) or effect of a character, in full. */
async function getCharacterEntity(
  ctx: QueryContext,
  data: BridgeRequest<'foundry-mcp-bridge.getCharacterEntity'>
): Promise<BridgeAnswer<'foundry-mcp-bridge.getCharacterEntity'>> {
  return ctx.withGmGate('Failed to get character entity', async () => {
    if (!data?.characterIdentifier) throw new Error('characterIdentifier is required');
    if (!data?.entityIdentifier) throw new Error('entityIdentifier is required');
    return await ctx.dataAccess.getCharacterEntity({
      characterIdentifier: data.characterIdentifier,
      entityIdentifier: data.entityIdentifier,
    });
  });
}

async function getCharacterResources(
  ctx: QueryContext,
  data: BridgeRequest<'foundry-mcp-bridge.getCharacterResources'>
): Promise<BridgeAnswer<'foundry-mcp-bridge.getCharacterResources'>> {
  return ctx.withGmGate('Failed to get character resources', async () => {
    if (!data?.identifier) {
      throw new Error('identifier is required');
    }
    return await ctx.dataAccess.getCharacterResources(data);
  });
}

async function getLevelUpOptions(
  ctx: QueryContext,
  data: {
    identifier: string;
    className?: string;
  }
): Promise<unknown> {
  return ctx.withGmGate('Failed to get level-up options', async () => {
    if (!data?.identifier) {
      throw new Error('identifier is required');
    }
    return await ctx.dataAccess.getLevelUpOptions(data);
  });
}

async function getActiveEffects(
  ctx: QueryContext,
  data: BridgeRequest<'foundry-mcp-bridge.getActiveEffects'>
): Promise<BridgeAnswer<'foundry-mcp-bridge.getActiveEffects'>> {
  return ctx.withGmGate('Failed to get active effects', async () => {
    if (!data?.identifier) {
      throw new Error('identifier is required');
    }
    return await ctx.dataAccess.getActiveEffects(data);
  });
}
