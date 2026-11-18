/**
 * The scene fixture (backlog I-028, pass 2): a small scene with two named tokens and a party group,
 * so the canvas probes (scenarios/canvas-tools-headless) have something to work on in a world that
 * has no campaign scene, such as a fresh kit world. Everything is flagged as kit, so `kit build`'s
 * wipe removes it; it makes nothing outside the kit flag and changes no existing document.
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
      return { created: false, sceneId: have.id, tokenIds: [], groupId: party.groupId, actorIds };
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
  const tokenIds = [];
  for (const [i, actorId] of actorIds.entries()) {
    const { tokenId } = await gm.call('placeToken', {
      sceneId: scene.sceneId,
      actorId,
      x: 3 + i * 3,
      y: 3,
    });
    tokenIds.push(tokenId);
  }
  log(`${tokenIds.length} tokens placed`);
  return {
    created: true,
    sceneId: scene.sceneId,
    tokenIds,
    groupId: party.groupId,
    actorIds,
  };
}
