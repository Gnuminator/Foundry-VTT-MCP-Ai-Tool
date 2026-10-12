/**
 * The settings rows of the `foundry-controls` sweep: the "Foundry AI Tool" section of Configure
 * Settings, its nine feature switches, its three menus (the GM guide link, the Enhanced Creature
 * Index window, the join page look dialog), and the same screen as a player sees it (no section at
 * all: the module's settings are world settings, which players do not get).
 */
import { launchBrowser } from './gm.mjs';
import {
  Skip,
  answerNo,
  closeWindows,
  expandSidebar,
  notifications,
  readDialog,
  waitNotification,
} from './foundry-sweep.mjs';

const MODULE = 'foundry-mcp-bridge';
const CONFIG = '#settings-config';
const GUIDE_HOST = 'gnuminator.github.io';
// Foundry answers a saved world change on /setup with 401 and the saved data (join-page.ts says so),
// which the browser logs as a failed resource. Only the two Veil rows expect it.
const SETUP_401 = /Failed to load resource.*status of 401/;
// A failed rebuild is announced by an error notification, which Foundry also logs as a console error;
// the row throws on that notification itself, so the console line only repeats it. A healthy rebuild
// logs no error (a pack that cannot be indexed is a warning, not an error).
const REBUILD_FAILED = /^Failed to build enhanced creature index/;

/** The visible settings, by label, as the module registers them. */
export const SETTING_LABELS = [
  'Enable MCP Bridge',
  'Websocket Server Host',
  'Allow Write Operations',
  'Allow Non-GM Users to Run the Bridge',
  'Bridge User',
  'Max Actors Per Request',
  'Chat Log Buffer Size',
  'Show Connection Messages',
  'Auto-Reconnect on Disconnect',
  'Connection Check Frequency',
];

/** The nine feature switches: setting key, label, default. */
export const FEATURE_SWITCHES = [
  ['feature.tarokka.enabled', 'AI Tool: Tarokka (writes)', false],
  ['feature.handouts.enabled', 'AI Tool: Handouts (writes)', false],
  ['feature.obsidian-mirror.enabled', 'AI Tool: Obsidian mirror (writes)', false],
  ['feature.party.enabled', 'AI Tool: Party (writes)', false],
  ['feature.live-play.enabled', 'AI Tool: Live play (writes)', true],
  ['feature.live-play.autoApply', 'AI Tool: Live play, apply without confirming', false],
  ['feature.session-notes.enabled', 'AI Tool: Session notes (writes)', false],
  ['feature.ownership.enabled', 'AI Tool: Ownership (writes)', true],
  ['feature.change-undo.enabled', 'AI Tool: Undo for everything', true],
];

/** The three menu buttons: key, button label, the window or dialog title they open (null: a link). */
export const MENUS = [
  ['helpMenu', 'Open the GM guide', null],
  ['enhancedIndexMenu', 'Configure Enhanced Index', 'Enhanced Creature Index Settings'],
  ['joinPageMenu', 'Choose join page look', 'Join page look'],
];

/**
 * Open Game Settings from the sidebar, the way a person does.
 * @param {import('playwright-core').Page} page
 */
export async function openSettings(page) {
  await expandSidebar(page);
  await page.evaluate(() => ui.sidebar.changeTab('settings', 'primary'));
  await page.locator('#settings button', { hasText: 'Game Settings' }).click();
  await page.locator(CONFIG).waitFor({ state: 'visible', timeout: 10000 });
}

/**
 * Switch to the module's tab of the open Game Settings window.
 * @param {import('playwright-core').Page} page
 */
export async function openModuleTab(page) {
  await page.locator(`${CONFIG} nav [data-tab="${MODULE}"]`).click();
  await page.locator(`${CONFIG} section.active button[data-action="openSubmenu"]`).first().waitFor({
    state: 'visible',
    timeout: 10000,
  });
}

/**
 * Close Game Settings and anything opened from it.
 * @param {import('playwright-core').Page} page
 */
async function closeAll(page) {
  await closeWindows(page);
}

/**
 * What a player's Game Settings window holds of the module: tabs and labels.
 * @param {import('playwright-core').Page} player
 */
async function playerSettings(player) {
  await openSettings(player);
  const info = await player.evaluate(
    ([id, labels]) => {
      const root = document.querySelector('#settings-config');
      const tabs = [...(root?.querySelectorAll('nav [data-tab]') ?? [])].map(
        t => /** @type {HTMLElement} */ (t).dataset.tab ?? ''
      );
      const text = root?.textContent ?? '';
      return {
        tabs,
        moduleTab: tabs.includes(id),
        labelsSeen: labels.filter(l => text.includes(l)),
        menus: [...(root?.querySelectorAll('button[data-action="openSubmenu"]') ?? [])]
          .map(b => /** @type {HTMLElement} */ (b).dataset.key ?? '')
          .filter(key => key.startsWith(`${id}.`)),
      };
    },
    /** @type {[string, string[]]} */ ([
      MODULE,
      [
        ...SETTING_LABELS,
        ...FEATURE_SWITCHES.map(f => String(f[1])),
        ...MENUS.map(m => String(m[1])),
      ],
    ])
  );
  // Foundry core's settings search filter fires a moment after the window is built and fails on a
  // window that is already gone; the row that calls this expects that one error.
  await player.waitForTimeout(500);
  await closeAll(player);
  await player.waitForTimeout(500);
  return info;
}

/**
 * @param {import('./foundry-sweep.mjs').Sweep} sweep
 * @param {{t: any, gm: import('playwright-core').Page, player: import('playwright-core').Page}} ctx
 */
export async function settingsRows(sweep, { t, gm, player }) {
  const read = (/** @type {string} */ key) =>
    gm.evaluate(([id, k]) => game.settings.get(id, k), [MODULE, key]);

  // --- The section, as a player sees Game Settings and as the GM does -----------------------------
  // The player's window is read inside its own row: Foundry core's SettingsConfig search filter logs
  // "reading 'querySelector'" on the player page when that window closes quickly after opening.
  /** @type {Awaited<ReturnType<typeof playerSettings>>} */
  let seen = { tabs: [], moduleTab: false, labelsSeen: [], menus: [] };
  await sweep.row(
    'foundry.settings.section',
    'player',
    async () => {
      seen = await playerSettings(player);
      if (seen.moduleTab || seen.menus.length || seen.labelsSeen.length) {
        throw new Error(
          `a player sees ${seen.moduleTab ? 'the module tab, ' : ''}${seen.labelsSeen.slice(0, 3).join(', ')}`
        );
      }
      return `a player's Game Settings has the tabs ${seen.tabs.join(', ')} and nothing of the module`;
    },
    { expectErrors: [/reading 'querySelector'/] }
  );
  await openSettings(gm);
  await openModuleTab(gm);

  await sweep.row('foundry.settings.section', 'gm', async () => {
    const missing = await gm.evaluate(
      ([labels, menus]) => {
        const text = document.querySelector('#settings-config section.active')?.textContent ?? '';
        const buttons = [
          ...document.querySelectorAll(
            '#settings-config section.active button[data-action="openSubmenu"]'
          ),
        ].map(b => b.textContent?.trim() ?? '');
        return [
          ...labels.filter(l => !text.includes(l)).map(l => `setting "${l}"`),
          ...menus.filter(m => !buttons.includes(m)).map(m => `menu button "${m}"`),
        ];
      },
      /** @type {[string[], string[]]} */ ([SETTING_LABELS, MENUS.map(m => String(m[1]))])
    );
    if (missing.length) throw new Error(`missing from the module section: ${missing.join(', ')}`);
    await sweep.shot('gm', 'settings-section.png');
    return `${SETTING_LABELS.length} settings and ${MENUS.length} menu buttons`;
  });
  await sweep.row('foundry.settings.feature-switches', 'gm', async () => {
    const found = await gm.evaluate(
      ([id, switches]) =>
        switches.map(([key, label]) => {
          const box = /** @type {HTMLInputElement | null} */ (
            document.querySelector(`#settings-config input[name="${id}.${key}"]`)
          );
          const group = box?.closest('.form-group');
          return {
            key,
            there: !!box,
            label: group?.querySelector('label')?.textContent?.trim() ?? '',
            expected: label,
            checked: box?.checked ?? null,
            current: game.settings.get(id, key),
          };
        }),
      /** @type {[string, Array<[string, string]>]} */ ([
        MODULE,
        FEATURE_SWITCHES.map(f => [String(f[0]), String(f[1])]),
      ])
    );
    const wrong = found.filter(f => !f.there || f.label !== f.expected || f.checked !== f.current);
    if (wrong.length) {
      throw new Error(
        `switches that are off: ${wrong.map(f => `${f.key} (${f.label || 'missing'})`).join(', ')}`
      );
    }
    // Defaults are checked against the module's own registered defaults, not against this world.
    const defaults = await gm.evaluate(
      ([id, keys]) => keys.map(k => [k, game.settings.settings.get(`${id}.${k}`)?.default]),
      /** @type {[string, string[]]} */ ([MODULE, FEATURE_SWITCHES.map(f => String(f[0]))])
    );
    const off = defaults.filter(([k, d]) => d !== FEATURE_SWITCHES.find(f => f[0] === k)?.[2]);
    if (off.length)
      throw new Error(`defaults differ: ${off.map(([k, d]) => `${k}=${d}`).join(', ')}`);
    return `${found.length} switches shown, ticked as the world has them, with the documented defaults`;
  });
  await sweep.row('foundry.settings.feature-switches', 'player', async () => {
    if (seen.labelsSeen.some(l => l.startsWith('AI Tool:')))
      throw new Error('a player sees an AI Tool switch');
    return 'no switch on a player screen';
  });

  // --- Save Changes with a module setting changed and put back ------------------------------------
  await sweep.row('module.settings.save', 'gm', async () => {
    const key = 'enableNotifications';
    const before = await read(key);
    const box = gm.locator(`${CONFIG} input[name="${MODULE}.${key}"]`);
    const save = async (/** @type {boolean} */ value) => {
      if (value) await box.check();
      else await box.uncheck();
      await gm.locator(`${CONFIG} button[type="submit"]`).click();
      const until = Date.now() + 10000;
      while ((await read(key)) !== value) {
        if (Date.now() > until) throw new Error(`${key} did not become ${value}`);
        await gm.waitForTimeout(200);
      }
    };
    try {
      await save(!before);
    } finally {
      // Save Changes closes the window: open it again to put the value back.
      if ((await read(key)) !== before) {
        await gm.evaluate(async ([id, k, v]) => game.settings.set(id, k, v), [MODULE, key, before]);
      }
    }
    return `"Show Connection Messages" went ${before} to ${!before} with Save Changes, and was put back`;
  });
  await closeAll(gm);

  // --- The three menus -----------------------------------------------------------------------------
  const openMenu = async (/** @type {string} */ key) => {
    await openSettings(gm);
    await openModuleTab(gm);
    await gm.locator(`${CONFIG} button[data-key="${MODULE}.${key}"]`).click();
  };

  await sweep.row('module.settings.help', 'gm', async () => {
    await openSettings(gm);
    await openModuleTab(gm);
    // The menu opens the guide with `window.open`. The page's `open` is replaced for the click, so
    // the call is recorded and no tab ever opens: the link is read, not followed.
    await gm.evaluate(() => {
      const w = /** @type {any} */ (window);
      w.__fmbOpened = [];
      w.__fmbOpenOriginal = w.open;
      w.open = (/** @type {any[]} */ ...args) => {
        w.__fmbOpened.push(args.map(a => (a == null ? null : String(a))));
        return null;
      };
    });
    /** @type {Array<Array<string | null>>} */
    let calls = [];
    try {
      await gm.locator(`${CONFIG} button[data-key="${MODULE}.helpMenu"]`).click();
      await gm.waitForFunction(() => /** @type {any} */ (window).__fmbOpened?.length > 0, null, {
        timeout: 8000,
      });
    } finally {
      calls = await gm.evaluate(() => {
        const w = /** @type {any} */ (window);
        const recorded = w.__fmbOpened ?? [];
        if (w.__fmbOpenOriginal) w.open = w.__fmbOpenOriginal;
        delete w.__fmbOpenOriginal;
        delete w.__fmbOpened;
        return recorded;
      });
    }
    if (calls.length !== 1)
      throw new Error(`the GM guide button called window.open ${calls.length} times`);
    const [url = '', target = '', features = ''] = calls[0].map(a => a ?? '');
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`the GM guide opens "${url}", which is not a link`);
    }
    if (parsed.protocol !== 'https:' || parsed.hostname !== GUIDE_HOST) {
      throw new Error(`the GM guide opens ${url}`);
    }
    if (target !== '_blank' || !/noopener/.test(features)) {
      throw new Error(
        `the GM guide opens in "${target}" with "${features}", not a new tab with noopener`
      );
    }
    // The public docs page is asked once with a HEAD request from this PC (the page is not opened);
    // offline, or a page that is not published yet, is a note and never a failure of the control.
    let reach = 'not checked (no network)';
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(8000),
        redirect: 'follow',
      });
      reach =
        res.status === 404 || res.status === 410
          ? `the page answers ${res.status}: not published yet?`
          : `answers ${res.status}`;
    } catch {
      // no network
    }
    await closeAll(gm);
    return `calls window.open(${url}, ${target}, ${features}), recorded without opening a tab (${reach})`;
  });

  await sweep.row('module.settings.enhanced-index-open', 'gm', async () => {
    await openMenu('enhancedIndexMenu');
    const title = gm
      .locator('.application', { hasText: 'Enhanced Creature Index Settings' })
      .last();
    await title.waitFor({ state: 'visible', timeout: 10000 });
    const controls = await title.evaluate(el => ({
      checks: [...el.querySelectorAll('input[type="checkbox"]')].map(
        i => /** @type {HTMLInputElement} */ (i).name
      ),
      rebuild: !!el.querySelector('button[data-action="rebuild"]'),
      save: !!el.querySelector('button[type="submit"]'),
    }));
    if (!controls.rebuild || !controls.save || controls.checks.length < 2) {
      throw new Error(`the window holds ${JSON.stringify(controls)}`);
    }
    await sweep.shot('gm', 'enhanced-index-window.png');
    return `window with ${controls.checks.length} checkboxes, Rebuild and Save Settings`;
  });

  await sweep.row('module.settings.enhanced-index-save', 'gm', async () => {
    const key = 'autoRebuildIndex';
    const before = await read(key);
    const win = gm.locator('.application', { hasText: 'Enhanced Creature Index Settings' }).last();
    if (!(await win.count())) await openMenu('enhancedIndexMenu');
    const box = win.locator(`input[name="${key}"]`);
    try {
      if (before) await box.uncheck();
      else await box.check();
      await win.locator('button[type="submit"]').click();
      await waitNotification(gm, /Enhanced Creature Index settings saved/);
      if ((await read(key)) === before) throw new Error(`${key} did not change`);
    } finally {
      if ((await read(key)) !== before) {
        await gm.evaluate(async ([id, k, v]) => game.settings.set(id, k, v), [MODULE, key, before]);
      }
    }
    return `"Auto-Rebuild Index on Pack Changes" went ${before} to ${!before} with Save Settings, and was put back`;
  });

  await sweep.row(
    'module.settings.enhanced-index-rebuild',
    'gm',
    async () => {
      const win = gm
        .locator('.application', { hasText: 'Enhanced Creature Index Settings' })
        .last();
      if (!(await win.count())) await openMenu('enhancedIndexMenu');
      const started = Date.now();
      await win.locator('button[data-action="rebuild"]').click();
      await waitNotification(gm, /Rebuilding enhanced creature index/);
      await waitNotification(
        gm,
        /Enhanced creature index complete|Failed to build enhanced creature index/,
        240000
      );
      const done = (await notifications(gm)).find(n => /complete|Failed to build/.test(n)) ?? '';
      if (/Failed to build/.test(done)) throw new Error(done);
      return { note: done.slice(0, 120), timings: { rebuildMs: Date.now() - started } };
    },
    { expectErrors: [REBUILD_FAILED] }
  );
  await closeAll(gm);

  await sweep.row('foundry.join-page.dialog', 'gm', async () => {
    const before = await gm.evaluate(() => game.world.description ?? '');
    await openMenu('joinPageMenu');
    const dialog = await readDialog(gm);
    if (dialog.title !== 'Join page look')
      throw new Error(`the dialog is titled "${dialog.title}"`);
    const field = await gm.locator('#ai-tool-join-tagline').inputValue();
    if (!field) throw new Error('the tagline field is empty');
    await sweep.shot('gm', 'join-page-dialog.png');
    const labels = dialog.labels.join(' / ');
    if (!/Apply The Veil/.test(labels)) throw new Error(`the dialog offers ${labels}`);
    await answerNo(gm);
    const after = await gm.evaluate(() => game.world.description ?? '');
    if (after !== before) throw new Error('Cancel changed the world description');
    await closeAll(gm);
    return `"${dialog.title}" with a tagline field and ${labels}; Cancel changed nothing`;
  });

  // The Veil on and off writes the world's description and background through Foundry's setup
  // screen, outside the plan, confirm and undo of the AI writes: it is the GM's own menu, and the
  // dialog asks first. The sweep applies it on the kit world and puts it back with the other button.
  await joinPageRows(sweep, { t, gm });

  await closeAll(gm);
}

/**
 * Apply The Veil and go back to Foundry's look. The join page is read from the server.
 * @param {import('./foundry-sweep.mjs').Sweep} sweep
 * @param {{t: any, gm: import('playwright-core').Page}} ctx
 */
async function joinPageRows(sweep, { t, gm }) {
  const base = new URL(gm.url()).origin;
  // The join page draws the world description with its own script. Read it in a browser of its own,
  // the way a player's browser sees it: opening /join in the GM's browser would sign the GM out.
  const hasVeil = async () => {
    const other = await launchBrowser();
    try {
      await other.page.goto(`${base}/join`, { waitUntil: 'load' });
      await other.page.waitForTimeout(1500);
      return (await other.page.content()).includes('data-ai-tool-join="veil"');
    } finally {
      await other.close();
    }
  };
  // The description and the background the world has now, with the system's own picture counted as no
  // background (the module does the same: Foundry fills an empty background with it on load).
  const look = () =>
    gm.evaluate(() => {
      const world = game.world;
      const system = /** @type {any} */ (game.system)?.background;
      return {
        description: world.description ?? '',
        background: world.background && world.background !== system ? world.background : null,
      };
    });
  const before = await look();
  const descriptionBefore = before.description;
  if (/data-ai-tool-join="veil"/.test(descriptionBefore)) {
    for (const name of ['module.join-page.veil', 'module.join-page.default']) {
      await sweep.row(name, 'gm', async () => {
        throw new Skip('the world already wears The Veil; the sweep will not change it');
      });
    }
    return;
  }
  const open = async () => {
    await openSettings(gm);
    await openModuleTab(gm);
    await gm.locator(`${CONFIG} button[data-key="${MODULE}.joinPageMenu"]`).click();
    await readDialog(gm);
  };
  const click = async (/** @type {string} */ label) => {
    await gm
      .locator('.application.dialog')
      .last()
      .locator('button', { hasText: label })
      .first()
      .click();
  };
  /** What differs from the start, or '' when the world looks as it did. @param {Awaited<ReturnType<typeof look>>} now */
  const differences = now =>
    [
      now.description !== before.description ? 'the description' : '',
      now.background !== before.background ? 'the background' : '',
    ]
      .filter(Boolean)
      .join(' and ');
  // Whatever state a row left, the world must end as it started: Back is pressed whenever the world
  // differs from the start, and when it still differs the start values are written back directly.
  t.cleanup(async () => {
    if (!differences(await look())) return;
    /** @type {string[]} */
    const problems = [];
    try {
      await open();
      await click("Back to Foundry's look");
      await waitNotification(gm, /back to Foundry's own look|not saved/);
    } catch (err) {
      problems.push(`Back to Foundry's look: ${err instanceof Error ? err.message : err}`);
    }
    await closeAll(gm).catch(() => {});
    let left = differences(await look());
    if (left) {
      try {
        await gm.evaluate(
          async ([id, description, background]) => {
            const res = await fetch(foundry.utils.getRoute('setup'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'editWorld', id, description, background }),
            });
            // Not res.ok: a saved world change can come back as 401 (join-page.ts).
            const saved = await res.json();
            if (!saved || saved.error) throw new Error(`Foundry answered ${JSON.stringify(saved)}`);
            game.world.updateSource(saved);
          },
          /** @type {[string, string, string | null]} */ ([
            await worldId(),
            before.description,
            before.background,
          ])
        );
      } catch (err) {
        problems.push(`direct restore: ${err instanceof Error ? err.message : err}`);
      }
      left = differences(await look());
    }
    if (left) problems.push(`the world's ${left} still differ from the start`);
    if (problems.length) throw new Error(problems.join(' | '));
  });
  const worldId = () => gm.evaluate(() => game.world.id);

  await sweep.row(
    'module.join-page.veil',
    'gm',
    async () => {
      await open();
      await click('Apply The Veil');
      await waitNotification(gm, /The Veil is on the join page|not saved/);
      const notes = (await notifications(gm)).join(' | ');
      if (/not saved/.test(notes)) throw new Error(notes);
      const until = Date.now() + 10000;
      while (!(await hasVeil())) {
        if (Date.now() > until) throw new Error('the join page does not show The Veil');
        await gm.waitForTimeout(300);
      }
      await closeAll(gm);
      return 'the join page now carries the Veil line';
    },
    { expectErrors: [SETUP_401] }
  );
  await sweep.row(
    'module.join-page.default',
    'gm',
    async () => {
      await open();
      await click("Back to Foundry's look");
      await waitNotification(gm, /back to Foundry's own look|not saved/);
      const notes = (await notifications(gm)).join(' | ');
      if (/not saved/.test(notes)) throw new Error(notes);
      const until = Date.now() + 10000;
      while (await hasVeil()) {
        if (Date.now() > until) throw new Error('the join page still shows The Veil');
        await gm.waitForTimeout(300);
      }
      const now = await look();
      await closeAll(gm);
      if (/data-ai-tool-join="veil"/.test(now.description))
        throw new Error('the Veil block is still in the description');
      // The world must read exactly as it did before The Veil (the cleanup writes the start values back).
      const differs = differences(now);
      if (differs) throw new Error(`after Back the world's ${differs} differ from the start`);
      return "the join page is back to Foundry's look; the description and the background read as before";
    },
    { expectErrors: [SETUP_401] }
  );
}
