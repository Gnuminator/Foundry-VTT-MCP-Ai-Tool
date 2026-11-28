// @ts-check
/**
 * Makes sure the train's world has Test Arena as its active, viewed scene before the live steps
 * run. Another lane's testing can leave no scene active on `ai-tool-test`; the sweep then fails
 * 8 steps for a reason that has nothing to do with main (red train 2026-11-26).
 */
export const TEST_SCENE = 'Test Arena';

/**
 * @param {{ evaluate: (fn: (name: string) => Promise<any>, arg: string) => Promise<any> }} page
 *   a GM page that has joined the game
 * @param {string} [name]
 * @returns {Promise<string>} one line saying what was done
 * @throws {Error} one clear line when the scene is missing or would not activate
 */
export async function ensureTestScene(page, name = TEST_SCENE) {
  const state = await page.evaluate(async sceneName => {
    const scene = globalThis.game.scenes.getName(sceneName);
    if (!scene) return { found: false };
    const wasActive = scene.active === true;
    if (!wasActive) await scene.activate();
    if (globalThis.game.canvas?.scene?.id !== scene.id) await scene.view();
    return { found: true, wasActive, active: scene.active === true };
  }, name);
  if (!state?.found) throw new Error(`the scene "${name}" does not exist in the world`);
  if (!state.active) throw new Error(`the scene "${name}" would not become the active scene`);
  return state.wasActive ? `${name} is already active` : `activated ${name}`;
}
