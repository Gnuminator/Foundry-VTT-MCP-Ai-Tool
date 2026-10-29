// The picture list for scripts/demo/foundry-basics.mjs: each screenshot (SHOTS) and each
// MP4 loop (LOOPS) is one entry that gets the page to a state and, for a screenshot, saves it.
// Selectors come from .claude/skills/foundry-core-ui/reference/. Everything runs in the invented
// demo world (scene "Test Arena", actor "Test Hero", wolves), never the real campaign.

/** Open a sidebar tab (the panel expands). */
export async function openTab(page, id) {
  await page.locator(`#sidebar-tabs button[data-tab="${id}"]`).click();
  await page.mouse.move(960, 600); // no tooltip over the picture
  await page.waitForTimeout(700);
}

/** Open a document sheet or app from the browser by evaluating `expr`, which returns an app. */
export async function openApp(page, expr) {
  await page.evaluate(async code => {
    const app = await (0, eval)(code);
    await app.render({ force: true });
  }, expr);
  await page.waitForTimeout(1200);
}

/** Screenshot the newest open application window with some air around it. */
export async function shotApp(page, file, pad = 24) {
  const box = await page.evaluate(() => {
    const apps = [...document.querySelectorAll('.application.window-app, .application')].filter(
      el =>
        el.closest('#ui-right, #ui-left, #ui-top, #ui-middle') === null ||
        el.classList.contains('window-app')
    );
    const el = apps.at(-1);
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  await page.screenshot({
    path: file,
    clip: {
      x,
      y,
      width: Math.min(1920 - x, box.width + pad * 2),
      height: Math.min(1080 - y, box.height + pad * 2),
    },
  });
}

/** Where a token sits on screen, in page pixels. */
export function tokenScreen(page, name) {
  return page.evaluate(n => {
    const t = globalThis.canvas.tokens.placeables.find(p => p.name === n);
    const p = globalThis.canvas.stage.worldTransform.apply(t.center);
    return { x: p.x, y: p.y };
  }, name);
}

export const SHOTS = {
  'tour-overview': {
    async run({ page, out }) {
      await openTab(page, 'chat');
      // Numbered badges next to the six areas the tour page names.
      await page.evaluate(() => {
        const at = (n, el, dx = 0, dy = 0) => {
          const r = el.getBoundingClientRect();
          const b = document.createElement('div');
          b.textContent = String(n);
          b.style.cssText =
            'position:fixed;z-index:99999;width:38px;height:38px;border-radius:50%;' +
            'background:#c0392b;color:#fff;font:700 22px/38px sans-serif;text-align:center;' +
            'box-shadow:0 0 0 3px #fff,0 2px 8px #000;' +
            `left:${r.left + dx}px;top:${r.top + dy}px`;
          document.body.append(b);
        };
        at(1, document.querySelector('#scene-controls'), 60, 140);
        at(2, document.querySelector('#scene-navigation'), 40, 40);
        at(3, document.querySelector('#board'), 760, 480);
        at(4, document.querySelector('#sidebar-tabs'), -52, 220);
        at(5, document.querySelector('#players'), 220, 0);
        at(6, document.querySelector('#hotbar'), 260, -50);
      });
      await page.screenshot({ path: out('tour-overview.png') });
    },
  },
  'users-configure-players': {
    async run({ page, out }) {
      await openTab(page, 'settings');
      await page.getByRole('button', { name: /User Management/i }).click();
      await page.waitForTimeout(1200);
      await shotApp(page, out('users-configure-players.png'));
    },
  },
  'users-permissions': {
    async run({ page, out }) {
      await openTab(page, 'settings');
      await page.getByRole('button', { name: /Game Settings/i }).click();
      await page.waitForTimeout(800);
      await page.getByRole('button', { name: /User Permissions/i }).click();
      await page.waitForTimeout(1200);
      await shotApp(page, out('users-permissions.png'));
    },
  },
  'join-page': {
    beforeJoin: true,
    async run({ page, env, out }) {
      await page.goto(`${env.foundryUrl}/join`);
      await page.locator('#join-username').waitFor();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: out('join-page.png') });
    },
  },
  'worlds-settings-menu': {
    async run({ page, out }) {
      await openTab(page, 'settings');
      await page.screenshot({ path: out('worlds-settings-menu.png') });
    },
  },
  'scenes-directory': {
    async run({ page, out }) {
      await openTab(page, 'scenes');
      await page.screenshot({ path: out('scenes-directory.png') });
    },
  },
  'scenes-context-menu': {
    async run({ page, out }) {
      await openTab(page, 'scenes');
      await page
        .locator('#scenes .directory-item', { hasText: 'Test Arena' })
        .first()
        .click({ button: 'right' });
      await page.waitForTimeout(600);
      await page.screenshot({ path: out('scenes-context-menu.png') });
    },
  },
  'scenes-config': {
    async run({ page, out }) {
      await openApp(page, 'game.scenes.getName("Test Arena").sheet');
      await shotApp(page, out('scenes-config.png'));
    },
  },
  'actors-directory': {
    async run({ page, out }) {
      await openTab(page, 'actors');
      await page.screenshot({ path: out('actors-directory.png') });
    },
  },
  'actors-sheet': {
    async run({ page, out }) {
      await openApp(page, 'game.actors.getName("Test Hero").sheet');
      await shotApp(page, out('actors-sheet.png'));
    },
  },
  'actors-ownership': {
    async run({ page, out }) {
      await openApp(
        page,
        'new foundry.applications.apps.DocumentOwnershipConfig({ document: game.actors.getName("Test Hero") })'
      );
      await shotApp(page, out('actors-ownership.png'));
    },
  },
  'tokens-hud': {
    async run({ page, out }) {
      const at = await tokenScreen(page, 'Wolf 1').catch(() => null);
      const pos = at ?? (await tokenScreen(page, 'Test Hero'));
      await page.mouse.click(pos.x, pos.y);
      await page.mouse.click(pos.x, pos.y, { button: 'right' });
      await page.waitForTimeout(900);
      await page.screenshot({
        path: out('tokens-hud.png'),
        clip: {
          x: Math.max(0, pos.x - 260),
          y: Math.max(0, pos.y - 220),
          width: 520,
          height: 440,
        },
      });
    },
  },
  'tokens-config': {
    async run({ page, out }) {
      await openApp(
        page,
        'canvas.tokens.placeables.find(t => t.actor?.type === "npc").document.sheet'
      );
      await shotApp(page, out('tokens-config.png'));
    },
  },
  'journals-sheet': {
    async run({ page, out }) {
      await openApp(page, 'game.journal.getName("Next session").sheet');
      await shotApp(page, out('journals-sheet.png'));
    },
  },
  'journals-show-players': {
    async run({ page, out }) {
      await openApp(page, 'game.journal.getName("Letters").sheet');
      // "Show Players" lives in the sheet's three-dot menu.
      await page.locator('.journal-entry .window-header [data-action=toggleControls]').click();
      await page.waitForTimeout(600);
      await page.screenshot({
        path: out('journals-show-players.png'),
        clip: { x: 440, y: 110, width: 1100, height: 880 },
      });
    },
  },
  'chat-roll-modes': {
    async run({ page, out }) {
      await openTab(page, 'chat');
      await page.evaluate(async () => {
        const rolls = ['1d20+5', '2d6+3', '1d8'];
        for (const r of rolls) await new globalThis.Roll(r).toMessage({ speaker: { alias: 'GM' } });
      });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: out('chat-roll-modes.png') });
    },
  },
  'combat-tracker': {
    async run({ page, out }) {
      await page.evaluate(async () => {
        const scene = globalThis.canvas.scene;
        const combat = await globalThis.Combat.create({ scene: scene.id, active: true });
        await combat.createEmbeddedDocuments(
          'Combatant',
          scene.tokens.map(t => ({ tokenId: t.id, actorId: t.actorId, sceneId: scene.id }))
        );
        await combat.rollAll();
        await combat.startCombat();
      });
      await openTab(page, 'combat');
      await page.screenshot({ path: out('combat-tracker.png') });
      await page.evaluate(async () => {
        await Promise.all(globalThis.game.combats.map(c => c.delete()));
      });
    },
  },
  'walls-tools': {
    async run({ page, out }) {
      await page.locator('#scene-controls button.control[data-control="walls"]').click();
      await page.waitForTimeout(700);
      await page.screenshot({ path: out('walls-tools.png') });
    },
  },
  'lighting-config': {
    async run({ page, out }) {
      await page.evaluate(async () => {
        const [light] = await globalThis.canvas.scene.createEmbeddedDocuments('AmbientLight', [
          { x: 900, y: 700, config: { bright: 20, dim: 40 } },
        ]);
        globalThis.__demoLight = light.id;
      });
      await openApp(page, 'canvas.scene.lights.get(__demoLight).sheet');
      await shotApp(page, out('lighting-config.png'));
      await page.evaluate(async () => {
        await globalThis.canvas.scene.deleteEmbeddedDocuments('AmbientLight', [
          globalThis.__demoLight,
        ]);
      });
    },
  },
  'measure-template': {
    async run({ page, out }) {
      // v14 draws spell areas as Regions in Measured Template Mode.
      await page.locator('#scene-controls button.control[data-control="regions"]').click();
      await page.waitForTimeout(500);
      const tool = name => page.locator(`#scene-controls button.tool[data-tool="${name}"]`);
      if ((await tool('templateMode').getAttribute('aria-pressed')) !== 'true')
        await tool('templateMode').click();
      await tool('circle').click();
      await page.mouse.move(1150, 800);
      await page.mouse.down();
      await page.mouse.move(1300, 800, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(1200);
      await page.mouse.move(1500, 950);
      await page.screenshot({ path: out('measure-template.png') });
      await page.evaluate(async () => {
        await globalThis.canvas.scene.deleteEmbeddedDocuments(
          'Region',
          globalThis.canvas.scene.regions.map(r => r.id)
        );
      });
    },
  },
  'compendium-tab': {
    async run({ page, out }) {
      await openTab(page, 'compendium');
      await page.screenshot({ path: out('compendium-tab.png') });
    },
  },
  'compendium-pack': {
    async run({ page, out }) {
      await openApp(page, 'game.packs.get("dnd5e.monsters")');
      await shotApp(page, out('compendium-pack.png'));
    },
  },
  'modules-manage': {
    async run({ page, out }) {
      await openTab(page, 'settings');
      await page.getByRole('button', { name: /Module Management/i }).click();
      await page.waitForTimeout(1200);
      // The test server has licensed and importer modules installed; the public picture shows
      // only a few generic rows.
      await page.evaluate(() => {
        const keep = ['Foundry AI Tool', 'Dice So Nice!', 'Dice Tray', 'Carousel Combat Tracker'];
        for (const li of document.querySelectorAll('.application:last-of-type li.package')) {
          const name = li.querySelector('.package-title, label')?.textContent.trim() ?? '';
          if (!keep.some(k => name.startsWith(k))) li.style.display = 'none';
        }
      });
      await shotApp(page, out('modules-manage.png'));
    },
  },
  'playlists-tab': {
    async run({ page, out }) {
      await page.evaluate(async () => {
        const pl = await globalThis.Playlist.create({ name: 'Inn Music' });
        await pl.createEmbeddedDocuments('PlaylistSound', [
          { name: 'Tavern Tune', path: 'sounds/combat/epic-turn-1.ogg', volume: 0.5 },
        ]);
        globalThis.__demoPlaylist = pl.id;
      });
      await openTab(page, 'playlists');
      await page.screenshot({ path: out('playlists-tab.png') });
      await page.evaluate(async () => {
        await globalThis.game.playlists.get(globalThis.__demoPlaylist).delete();
      });
    },
  },
};

export const LOOPS = {
  'tour-sidebar-tabs': {
    async setup({ page }) {
      await page.evaluate(() => globalThis.ui.sidebar.collapse?.());
      await page.mouse.move(900, 500);
    },
    async run({ page }) {
      for (const id of ['chat', 'combat', 'scenes', 'actors', 'items', 'journal', 'compendium']) {
        const tab = page.locator(`#sidebar-tabs button[data-tab="${id}"]`);
        if (await tab.count()) {
          await tab.hover();
          await tab.click();
          await page.waitForTimeout(700);
        }
      }
    },
  },
  'tokens-drag': {
    async setup({ page }) {
      await openTab(page, 'actors');
    },
    async run({ page }) {
      // The folder row also contains the text "Wolf" in its children, so match the name exactly.
      const entry = page.locator('#actors').getByText('Wolf', { exact: true }).first();
      const box = await entry.boundingBox();
      await page.mouse.move(box.x + 10, box.y + 8, { steps: 15 });
      await page.mouse.down();
      await page.mouse.move(box.x - 40, box.y + 8, { steps: 10 });
      await page.mouse.move(700, 700, { steps: 40 });
      await page.mouse.up();
      await page.waitForTimeout(1500);
    },
    async cleanup({ page }) {
      await page.evaluate(async () => {
        const extra = globalThis.canvas.scene.tokens.filter(t => t.name === 'Wolf' && !t.actorLink);
        const keep = new Set(['Wolf 1', 'Wolf 2', 'Wolf 3']);
        const drop = extra.filter(t => !keep.has(t.name)).map(t => t.id);
        if (drop.length) await globalThis.canvas.scene.deleteEmbeddedDocuments('Token', drop);
      });
    },
  },
  'chat-roll': {
    async setup({ page }) {
      await openTab(page, 'chat');
    },
    async run({ page }) {
      const input = page.locator('#chat-message, textarea[name="message"]').first();
      await input.click();
      await input.pressSequentially('/r 1d20+5', { delay: 120 });
      await page.waitForTimeout(500);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1800);
    },
  },
  'combat-start': {
    async setup({ page }) {
      await page.evaluate(async () => {
        const scene = globalThis.canvas.scene;
        const combat = await globalThis.Combat.create({ scene: scene.id, active: true });
        await combat.createEmbeddedDocuments(
          'Combatant',
          scene.tokens.map(t => ({ tokenId: t.id, actorId: t.actorId, sceneId: scene.id }))
        );
      });
      await openTab(page, 'combat');
    },
    async run({ page }) {
      await page
        .getByRole('button', { name: /Roll All/i })
        .first()
        .click();
      await page.waitForTimeout(2200);
      await page
        .getByRole('button', { name: /Start Combat/i })
        .first()
        .click();
      await page.waitForTimeout(1800);
      await page
        .getByRole('button', { name: /Next Turn/i })
        .first()
        .click();
      await page.waitForTimeout(1500);
    },
    async cleanup({ page }) {
      await page.evaluate(async () => {
        await Promise.all(globalThis.game.combats.map(c => c.delete()));
      });
    },
  },
  'measure-ruler': {
    async setup({ page }) {
      await page.evaluate(() => globalThis.ui.sidebar.collapse?.());
      await page.locator('#scene-controls button.control[data-control="tokens"]').click();
      await page.locator('#scene-controls button.tool[data-tool="ruler"]').click();
      await page.waitForTimeout(600);
    },
    async run({ page }) {
      await page.mouse.move(600, 600);
      await page.mouse.down();
      await page.mouse.move(1100, 520, { steps: 50 });
      await page.waitForTimeout(1800);
      await page.mouse.up();
      await page.waitForTimeout(600);
    },
  },
};
