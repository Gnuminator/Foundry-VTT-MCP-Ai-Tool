// Foundry VTT 14 helpers for Playwright: join a world as a user, wait until the
// canvas is ready, close stray windows. Selectors: .claude/skills/foundry-core-ui/
// reference/join-auth-users.md.

/** The running world's id (from /api/status), or '' at the setup screen. */
export async function activeWorld(foundryUrl) {
  const res = await fetch(`${foundryUrl}/api/status`);
  if (!res.ok) throw new Error(`Foundry ${foundryUrl}: /api/status answered ${res.status}`);
  const status = await res.json();
  return typeof status.world === 'string' ? status.world : '';
}

/**
 * Join the running world as a user and wait until the game and canvas are ready.
 * Refuses when Foundry runs another world than `world`.
 * @param {import('playwright-core').Page} page
 * @param {{foundryUrl: string, world: string, user: string, password?: string, timeoutMs?: number}} o
 */
export async function joinFoundry(
  page,
  { foundryUrl, world, user, password = '', timeoutMs = 90000 }
) {
  const running = await activeWorld(foundryUrl);
  if (running !== world) {
    throw new Error(
      `Foundry runs world "${running || '(setup screen)'}", not "${world}"; not joining.`
    );
  }
  await page.goto(`${foundryUrl}/join`);
  const name = page.locator('#join-username');
  await name.waitFor();
  await name.fill(user);
  await page.keyboard.press('Escape'); // close the name autocomplete
  await page.locator('#join-password').fill(password);
  await page.locator('button[name="join"]').click();
  await page.waitForURL(/\/game$/, { timeout: timeoutMs });
  await waitForCanvasReady(page, timeoutMs);
}

/**
 * Wait until game.ready and canvas.ready. On Foundry 14 a hidden or tiny window leaves
 * the canvas not ready (imports stall, placeable deletes fail on "clipboard").
 * @param {import('playwright-core').Page} page
 */
export async function waitForCanvasReady(page, timeoutMs = 90000) {
  await page.waitForFunction(
    () => globalThis.game?.ready === true && globalThis.canvas?.ready === true,
    undefined,
    { timeout: timeoutMs, polling: 250 }
  );
}

/** Close every open Foundry application window (sheets, dialogs, journals, tours). */
export async function closeAllWindows(page) {
  await page.evaluate(async () => {
    const apps = [...(globalThis.foundry?.applications?.instances?.values() ?? [])];
    for (const app of apps) {
      if (app.options?.window?.frame !== false && app.rendered && typeof app.close === 'function') {
        await app.close({ animate: false }).catch(() => {});
      }
    }
    globalThis.ui?.tours?.activeTour?.exit?.();
  });
}

/** A token's top-left position in pixels, read from the saved data (not the animation). */
export function tokenPosition(page, tokenName) {
  return page.evaluate(name => {
    const doc = globalThis.canvas.scene.tokens.find(t => t.name === name);
    return doc ? { x: doc._source.x, y: doc._source.y } : null;
  }, tokenName);
}

/** Wait until a token's saved position differs from `from`. */
export async function waitForTokenMove(page, tokenName, from, timeoutMs = 15000) {
  await page.waitForFunction(
    ({ name, from }) => {
      const doc = globalThis.canvas.scene.tokens.find(t => t.name === name);
      return doc && (doc._source.x !== from.x || doc._source.y !== from.y);
    },
    { name: tokenName, from },
    { timeout: timeoutMs, polling: 200 }
  );
}

/** Wait until a token's saved position is `at`. */
export async function waitForTokenAt(page, tokenName, at, timeoutMs = 15000) {
  await page.waitForFunction(
    ({ name, at }) => {
      const doc = globalThis.canvas.scene.tokens.find(t => t.name === name);
      return doc && doc._source.x === at.x && doc._source.y === at.y;
    },
    { name: tokenName, at },
    { timeout: timeoutMs, polling: 200 }
  );
}

/** Unpause the game (Foundry starts a world paused). GM only. */
export async function unpause(page) {
  await page.evaluate(() => {
    if (globalThis.game.paused) globalThis.game.togglePause(false, { broadcast: true });
  });
}

/** Pan the canvas to a token so a viewer sees it move. */
export async function panToToken(page, tokenName, scale = 1) {
  await page.evaluate(
    async ({ name, scale }) => {
      const t = globalThis.canvas.tokens.placeables.find(p => p.document.name === name);
      if (t)
        await globalThis.canvas.animatePan({ x: t.center.x, y: t.center.y, scale, duration: 600 });
    },
    { name: tokenName, scale }
  );
}
