/**
 * Foundry-mock harness — Phase 9 prerequisite.
 *
 * A lightweight, in-memory stand-in for the Foundry VTT browser runtime so the
 * ~9.5k-LOC `data-access.ts` (untestable browser plumbing until now) can finally
 * be characterized and, from there, reimplemented to parity "from the idea".
 *
 * Usage:
 * ```ts
 * import { createTestWorld } from './test-support/foundry-mock/index.js';
 * import { FoundryDataAccess } from './data-access.js';
 *
 * const world = createTestWorld();
 * world.addActor({ name: 'Silvera', type: 'character', system: {...} });
 * const restore = world.install();
 * try {
 *   const info = await new FoundryDataAccess().getCharacterInfo('Silvera');
 *   expect(info.name).toBe('Silvera');
 * } finally {
 *   restore();
 * }
 * ```
 *
 * Test-only: this folder is excluded from the shipped `tsc` build.
 */

export { MockCollection, type Identified } from './collection.js';
export {
  makeActor,
  makeItem,
  makeEffect,
  makeScene,
  makeToken,
  makeNote,
  makeUser,
  makePack,
  randomId,
  resetIdCounter,
  type MakeActorOptions,
  type MakeItemOptions,
  type MakeEffectOptions,
  type MakeSceneOptions,
  type MakeTokenOptions,
  type MakeUserOptions,
  type MakePackOptions,
} from './documents.js';
export {
  TestWorld,
  createTestWorld,
  installFoundryGlobals,
  type TestWorldOptions,
} from './world.js';
