/**
 * The scene fixture (backlog I-028, pass 2): a small scene with two named tokens and a party group,
 * so the canvas probes (scenarios/canvas-tools-headless) have something to work on in a world that
 * has no campaign scene, such as a fresh kit world. Everything is flagged as kit, so `kit build`'s
 * wipe removes it; it adds only kit-flagged documents and edits no existing one,
 * except that the fixture scene becomes the active scene (a wipe does not restore the old one).
 *
 * It needs a canvas (createCombatScene waits for the first draw), so it runs from the Kit GM's
 * browser on this PC. It is idempotent: a kit scene with the fixture name means "already there".
 */
import { listOf } from './helpers.mjs';

export const FIXTURE_SCENE = 'Kit Fixture Scene';
export const FIXTURE_ACTORS = ['Kit Fixture Hero', 'Kit Fixture Goblin'];
export const FIXTURE_PARTY = 'Kit Fixture Party';

/**
 * @param {{gm: {call: (action: string, args?: any) => Promise<any>}, dashboard?: any, log?: (line: string) => void}} c
 * @returns {Promise<{created: boolean, sceneId?: string, tokenIds: string[], groupId: string, actorIds: string[]}>}
 */
export async function buildSceneFixture({ gm, dashboard, log = () => {} }) {
  const folder = (await gm.call('ensureFolder', { type: 'Actor', name: 'Kit' })).folderId;
  const { actorIds } = await gm.call('createFixtureActors', {
    names: FIXTURE_ACTORS,
    folderId: folder,
  });
  const party = await gm.call('ensurePartyGroup', {
    name: FIXTURE_PARTY,
    memberIds: [actorIds[0]],
    folderId: folder,
  });
  log(`party group ${FIXTURE_PARTY}: ${party.created ? 'made' : 'already there'}`);
  if (dashboard) {
    const listed = await dashboard.tool('list-scenes', {});
    const have = listOf(listed, 'scenes').find((/** @type {any} */ s) => s.name === FIXTURE_SCENE);
    if (have) {
      log(`scene ${FIXTURE_SCENE}: already there`);
      const tokenIds = await ensureTokens({ gm, dashboard, sceneId: have.id, actorIds, log });
      return { created: false, sceneId: have.id, tokenIds, groupId: party.groupId, actorIds };
    }
  }
  const sceneFolder = (await gm.call('ensureFolder', { type: 'Scene', name: 'Kit' })).folderId;
  const scene = await gm.call('createCombatScene', {
    name: FIXTURE_SCENE,
    folderId: sceneFolder,
    width: 12,
    height: 8,
    grid: 100,
    walls: false,
    doors: 0,
    lights: 0,
  });
  log(`scene ${scene.name}`);
  const tokenIds = await placeMissing({ gm, sceneId: scene.sceneId, actorIds, have: [], log });
  return {
    created: true,
    sceneId: scene.sceneId,
    tokenIds,
    groupId: party.groupId,
    actorIds,
  };
}

/**
 * Place a token for each fixture actor that has none on the scene, at the grid cell its position in
 * the list gives it. Returns every token id (the existing ones first when a scene is topped up).
 * @param {{gm: {call: (action: string, args?: any) => Promise<any>}, sceneId: string, actorIds: string[], have: {tokenId: string, actorId?: string}[], log: (line: string) => void}} c
 * @returns {Promise<string[]>}
 */
async function placeMissing({ gm, sceneId, actorIds, have, log }) {
  const tokenIds = have.map(t => t.tokenId);
  let placed = 0;
  for (const [i, actorId] of actorIds.entries()) {
    if (have.some(t => t.actorId === actorId)) continue;
    const { tokenId } = await gm.call('placeToken', { sceneId, actorId, x: 3 + i * 3, y: 3 });
    tokenIds.push(tokenId);
    placed++;
  }
  if (placed > 0) log(`${placed} tokens placed`);
  return tokenIds;
}

/**
 * A fixture scene left without tokens by an interrupted run counts as there but is not whole: look at
 * its tokens and add the ones that are missing.
 * @param {{gm: {call: (action: string, args?: any) => Promise<any>}, dashboard: any, sceneId: string, actorIds: string[], log: (line: string) => void}} c
 */
async function ensureTokens({ gm, dashboard, sceneId, actorIds, log }) {
  const positions = await dashboard.tool('get-token-positions', { sceneId });
  const have = listOf(positions, 'tokens');
  return placeMissing({ gm, sceneId, actorIds, have, log });
}
