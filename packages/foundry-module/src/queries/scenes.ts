/**
 * Bridge handlers about scenes: the active scene, switching scene, tokens on the map, music
 * and the scene plans (mood, dressing, token rings, restore, rooms, party placement).
 */
import type { BridgeHandlerTable } from '../bridge-handlers.js';
import { MODULE_ID } from '../constants.js';
import { getPartyState, PARTY_STATE_QUERY } from '../party-scan.js';
import { PARTY_PLACE_QUERY, planPartyPlacement } from '../party-place.js';
import { getRenownState, RENOWN_STATE_QUERY } from '../renown-scan.js';
import { planSceneChange, SCENE_PLAN_QUERY } from '../scene-plan.js';
import {
  getSceneMoods,
  planSceneMood,
  SCENE_MOOD_PLAN_QUERY,
  SCENE_MOODS_QUERY,
} from '../scene-mood.js';
import { planTokenRings, TOKEN_RINGS_PLAN_QUERY } from '../token-rings.js';
import { getSceneState, SCENE_STATE_QUERY } from '../scene-state.js';
import { planRoomSetup, ROOM_SETUP_QUERY } from '../room-setup.js';
import { withCtx, type DataArg, type QueryContext } from './context.js';

/**
 * Registration table: wire method name (after `${MODULE_ID}.`) and its kind. The kind decides
 * the write gate (write-gate.ts): `write` and `recordless-write` are refused while "Allow Write
 * Operations" is off; `read` is never gated.
 */
export function registerSceneHandlers(ctx: QueryContext, table: BridgeHandlerTable): void {
  table.set(`${MODULE_ID}.getActiveScene`, 'read', () => getActiveScene(ctx));
  table.set(`${MODULE_ID}.list-scenes`, 'read', withCtx(ctx, listScenes));
  table.set(`${MODULE_ID}.switch-scene`, 'write', withCtx(ctx, switchScene));

  // Movement and positioning
  table.set(`${MODULE_ID}.getTokenPositions`, 'read', withCtx(ctx, getTokenPositions));
  table.set(`${MODULE_ID}.measureDistance`, 'read', withCtx(ctx, measureDistance));
  table.set(`${MODULE_ID}.getTargets`, 'read', () => getTargets(ctx));

  // Music: the playlist plays at once, with no change-journal record
  table.set(`${MODULE_ID}.playPlaylist`, 'recordless-write', withCtx(ctx, playPlaylist));

  // Party panel (I-079, read-only): dnd5e group actors, members, pace, rest
  // request cards. GM client only.
  table.set(`${MODULE_ID}.${PARTY_STATE_QUERY}`, 'read', () =>
    ctx.withGmGate('Failed to read the party', () => Promise.resolve(getPartyState()))
  );

  // Factions and renown (dnd5e 6.1, read-only): faction actors and every actor's renown items.
  // GM client only.
  table.set(`${MODULE_ID}.${RENOWN_STATE_QUERY}`, 'read', () =>
    ctx.withGmGate('Failed to read renown', () => Promise.resolve(getRenownState()))
  );

  // Place the party (I-097): where the members' tokens would go on the viewed scene. Read only;
  // plan-party-change's `place` turns it into a guarded plan of token creates. GM client only.
  table.set(`${MODULE_ID}.${PARTY_PLACE_QUERY}`, 'read', (data: unknown) =>
    ctx.withGmGate('Failed to place the party', () => planPartyPlacement(data))
  );

  // Scene dressing plans (I-112, read-only): templates, darkness and light, map notes and loot
  // as guarded ops. GM client only.
  table.set(`${MODULE_ID}.${SCENE_PLAN_QUERY}`, 'read', (data: unknown) =>
    ctx.withGmGate('Failed to plan the scene change', () => planSceneChange(data))
  );

  // Scene mood presets and music (I-034, I-129, read-only): moods and playlists as guarded
  // ops, and the list of presets and playlists. GM client only.
  table.on(`${MODULE_ID}.${SCENE_MOOD_PLAN_QUERY}`, 'read', (data: unknown) =>
    ctx.withGmGate('Failed to plan the mood', () => Promise.resolve(planSceneMood(data)))
  );
  table.on(`${MODULE_ID}.${SCENE_MOODS_QUERY}`, 'read', () =>
    ctx.withGmGate('Failed to read the moods', () => Promise.resolve(getSceneMoods()))
  );

  // Dynamic token rings by default (I-093, read-only): one guarded op per actor. GM client only.
  table.on(`${MODULE_ID}.${TOKEN_RINGS_PLAN_QUERY}`, 'read', (data: unknown) =>
    ctx.withGmGate('Failed to plan the token rings', () => Promise.resolve(planTokenRings(data)))
  );

  // Scene restore (I-128, read-only): one scene's walls, lights, tiles and tokens as source
  // data, compared with a backup copy by the backend. GM client only.
  table.on(`${MODULE_ID}.${SCENE_STATE_QUERY}`, 'read', (data: unknown) =>
    ctx.withGmGate('Failed to read the scene', () => Promise.resolve(getSceneState(data)))
  );

  // Room setup (I-133, read-only): turns one request into Region and Token create ops. GM only.
  table.on(`${MODULE_ID}.${ROOM_SETUP_QUERY}`, 'read', (data: unknown) =>
    ctx.withGmGate('Failed to plan the room setup', () => planRoomSetup(data))
  );
}

/**
 * Handle get active scene request
 */
async function getActiveScene(ctx: QueryContext): Promise<unknown> {
  return ctx.withGmGate('Failed to get active scene', async () => {
    return await ctx.dataAccess.getActiveScene();
  });
}

/**
 * Handle list scenes request
 */
async function listScenes(ctx: QueryContext, data: DataArg<'listScenes'>): Promise<unknown> {
  return ctx.withGmGate('Failed to list scenes', async () => {
    return await ctx.dataAccess.listScenes(data);
  });
}

/**
 * Handle switch scene request
 */
async function switchScene(ctx: QueryContext, data: DataArg<'switchScene'>): Promise<unknown> {
  return ctx.withGmGate('Failed to switch scene', async () => {
    if (!data.scene_identifier) {
      throw new Error('scene_identifier is required');
    }

    return await ctx.dataAccess.switchScene(data);
  });
}

async function getTokenPositions(ctx: QueryContext, data: { sceneId?: string }): Promise<unknown> {
  return ctx.withGmGate('Failed to get token positions', async () => {
    return await ctx.dataAccess.getTokenPositions(data || {});
  });
}

async function measureDistance(
  ctx: QueryContext,
  data: {
    fromTokenName: string;
    toTokenName: string;
  }
): Promise<unknown> {
  return ctx.withGmGate('Failed to measure distance', async () => {
    if (!data?.fromTokenName) throw new Error('fromTokenName is required');
    if (!data?.toTokenName) throw new Error('toTokenName is required');
    return await ctx.dataAccess.measureDistance(data);
  });
}

async function getTargets(ctx: QueryContext): Promise<unknown> {
  return ctx.withGmGate('Failed to get targets', async () => {
    return await ctx.dataAccess.getTargets();
  });
}

async function playPlaylist(ctx: QueryContext, data: DataArg<'playPlaylist'>): Promise<unknown> {
  return ctx.withGmGate('Failed to play playlist', async () => {
    return await ctx.dataAccess.playPlaylist(data || {});
  });
}
