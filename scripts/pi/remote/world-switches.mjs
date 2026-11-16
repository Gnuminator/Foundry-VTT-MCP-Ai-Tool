// The AI Tool and dnd5e world switches a world starts with (the user, 2026-10-30; docs/dev/PI-SETUP.md, "World
// switches"). Run by stage 11 (scripts/pi/remote/11-world.sh) for a world that run installs or resets, and by hand
// with WORLD_SWITCHES=1 for a world that was kept. A headless Chromium joins the world as its GM (the same way
// player-creation-settings.mjs does) and sets, through Foundry's own settings API, every entry of PROFILE that
// differs. It prints the values before and after, reloads the world and reads them back, and exits 1 on any
// mismatch. A second run changes nothing. Passwords are never printed.
//
// The table in docs/dev/PI-SETUP.md is the same list with the reasons; world-switches.test.mjs fails when the two
// differ. Keys are `<namespace>.<key>`. All are world settings: a client setting cannot be set from here, so an
// entry whose setting is not a world setting is reported and not written.
//
// Environment: TOOL_APP (the built tool, for playwright-core), FOUNDRY_URL (default http://127.0.0.1:30000),
// CHROMIUM (default /usr/bin/chromium), GM_USER, GM_PASSWORD, WORLD (the world id that must be running).

import { createRequire } from 'node:module';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const env = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`${name} is not set`);
  return value;
};

const FOUNDRY_URL = env('FOUNDRY_URL', 'http://127.0.0.1:30000').replace(/\/$/, '');
const log = msg => console.log(`[world-switches] ${msg}`);

// optional: the module may be missing from a world; the entry is then skipped with a warning instead of failing.
// The bridge (foundry-mcp-bridge) and dnd5e are not optional: without them nothing else works.
export const PROFILE = [
  { ns: 'foundry-mcp-bridge', key: 'allowWriteOperations', value: true },
  { ns: 'foundry-mcp-bridge', key: 'gmWindows', value: true },
  { ns: 'foundry-mcp-bridge', key: 'feature.handouts.enabled', value: true },
  { ns: 'foundry-mcp-bridge', key: 'feature.party.enabled', value: true },
  { ns: 'foundry-mcp-bridge', key: 'feature.tarokka.enabled', value: true },
  { ns: 'foundry-mcp-bridge', key: 'feature.live-play.enabled', value: true },
  { ns: 'foundry-mcp-bridge', key: 'feature.ownership.enabled', value: true },
  { ns: 'foundry-mcp-bridge', key: 'feature.table-viewer.enabled', value: true },
  { ns: 'foundry-mcp-bridge', key: 'feature.change-undo.enabled', value: true },
  { ns: 'foundry-mcp-bridge', key: 'feature.who-notices.enabled', value: true },
  { ns: 'foundry-mcp-bridge', key: 'feature.rules-check.enabled', value: true },
  { ns: 'dnd5e', key: 'autoApplyDowned', value: 'all' },
  { ns: 'item-piles', key: 'enableTrading', value: true, optional: true },
];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Runs in the browser. One row per entry: whether Foundry registered the setting, its scope and its value.
export function readState({ profile }) {
  const settings = game.settings;
  return {
    world: game.world.id,
    user: game.user.name,
    isGM: game.user.isGM,
    rows: profile.map(({ ns, key }) => {
      const reg = settings.settings.get(`${ns}.${key}`);
      let value = null;
      if (reg) {
        try {
          value = JSON.parse(JSON.stringify(settings.get(ns, key)));
        } catch {
          value = null;
        }
      }
      const moduleActive = ns === game.system?.id || game.modules?.get(ns)?.active === true;
      return { ns, key, registered: Boolean(reg), scope: reg?.scope ?? null, value, moduleActive };
    }),
  };
}

// Runs in the browser: sets only what differs, returns what it changed. A setting Foundry does not know, or that is
// not a world setting, is left alone (readState and the caller report it).
export async function applyState({ profile }) {
  const changed = [];
  for (const { ns, key, value } of profile) {
    const reg = game.settings.settings.get(`${ns}.${key}`);
    if (!reg || reg.scope !== 'world') continue;
    if (JSON.stringify(game.settings.get(ns, key)) === JSON.stringify(value)) continue;
    await game.settings.set(ns, key, value);
    changed.push(`${ns}.${key}`);
  }
  return changed;
}

const show = state =>
  JSON.stringify(
    Object.fromEntries(
      state.rows.map(r => [`${r.ns}.${r.key}`, r.registered ? r.value : 'not registered'])
    )
  );

// The problems that stop the settings from being set, as plain sentences.
export function blockers(state, world, profile = PROFILE) {
  const problems = [];
  if (state.world !== world) problems.push(`joined world ${state.world}, expected ${world}`);
  if (!state.isGM) problems.push(`${state.user} is not a GM`);
  for (const row of state.rows) {
    const entry = profile.find(p => p.ns === row.ns && p.key === row.key);
    if (!row.registered && (!entry?.optional || row.moduleActive)) {
      problems.push(
        row.moduleActive
          ? `${row.ns}.${row.key} is not registered although ${row.ns} is active: the key is probably wrong`
          : `${row.ns}.${row.key} is not registered (is the ${row.ns} module or system active in this world?)`
      );
    } else if (row.registered && row.scope !== 'world' && !entry?.optional) {
      problems.push(
        `${row.ns}.${row.key} is a ${row.scope} setting, not a world setting: set it by hand`
      );
    }
  }
  return problems;
}

// Optional entries the world cannot take, as plain sentences (not failures).
export function warnings(state, profile = PROFILE) {
  return state.rows
    .filter(
      r =>
        ((!r.registered && !r.moduleActive) || (r.registered && r.scope !== 'world')) &&
        profile.find(p => p.ns === r.ns && p.key === r.key)?.optional
    )
    .map(r =>
      r.registered
        ? `${r.ns}.${r.key} skipped: it is a ${r.scope} setting here, not a world setting`
        : `${r.ns}.${r.key} skipped: the ${r.ns} module is not active in this world`
    );
}

// What the settings must look like at the end.
export function mismatches(after, profile = PROFILE) {
  const problems = [];
  for (const { ns, key, value, optional } of profile) {
    const row = after.rows.find(r => r.ns === ns && r.key === key);
    if (!row?.registered) {
      if (!optional || row?.moduleActive) problems.push(`${ns}.${key} is not registered`);
    } else if (optional && row.scope !== 'world') {
      continue; // reported as a warning, never written
    } else if (!same(row.value, value)) {
      problems.push(
        `${ns}.${key} is ${JSON.stringify(row.value)}, expected ${JSON.stringify(value)}`
      );
    }
  }
  return problems;
}

// Foundry 14.368 types the user name into a text field; 14.369 picks it from a list (same as player-creation-settings.mjs).
async function typeJoinUser(page, user) {
  const name = page.locator('#join-username');
  const state = await name.evaluate((el, u) => {
    if (el.tagName !== 'SELECT') return 'input';
    const option = Array.from(el.options).find(o => o.textContent.trim() === u);
    return !option ? 'missing' : option.disabled ? 'online' : 'select';
  }, user);
  if (state === 'select') {
    await name.selectOption({ label: user });
  } else if (state === 'input') {
    await name.fill(user);
    await page.keyboard.press('Escape'); // closes the name autocomplete
  } else {
    return state;
  }
  return 'ok';
}

async function main() {
  const require = createRequire(join(env('TOOL_APP'), 'package.json'));
  const { chromium } = require('playwright-core');
  const user = env('GM_USER');
  const password = env('GM_PASSWORD');
  const world = env('WORLD');

  // A throwaway profile, so the GM's session never lands in the Assistant GM's profile.
  const profile = mkdtempSync(join(tmpdir(), 'world-switches-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: env('CHROMIUM', '/usr/bin/chromium'),
    headless: true,
    args: ['--disable-gpu', '--disable-dev-shm-usage', '--mute-audio', '--no-first-run'],
    viewport: { width: 1280, height: 800 },
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const res = await page.goto(`${FOUNDRY_URL}/join`, { waitUntil: 'domcontentloaded' });
    // /join answers 200 with no world running; a running world's page carries <template id="join-game">.
    const onJoin = res?.ok() && new URL(page.url()).pathname.endsWith('/join');
    if (!onJoin || (await page.locator('template#join-game').count()) === 0) {
      throw new Error(`no world is running at ${FOUNDRY_URL}`);
    }
    const typed = await typeJoinUser(page, user);
    if (typed !== 'ok') {
      throw new Error(
        `could not join as ${user}: that user is ${typed === 'online' ? 'already online' : 'not in the world'}`
      );
    }
    await page.locator('#join-password').fill(password);
    await page.locator('button[name="join"]').click();
    await page.waitForURL(/\/game$/, { timeout: 60_000 }).catch(() => {
      throw new Error(`could not join as ${user}: wrong password, or that user is already online`);
    });
    const ready = () =>
      page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 120_000 });
    await ready();

    const args = { profile: PROFILE };
    const before = await page.evaluate(readState, args);
    log(`world ${before.world}, joined as ${before.user} (GM: ${before.isGM})`);
    const problems = blockers(before, world);
    if (problems.length) throw new Error(problems.join('; '));
    for (const w of warnings(before)) log(`warning: ${w}`);
    log(`before: ${show(before)}`);

    const changed = await page.evaluate(applyState, args);
    log(changed.length ? `changed: ${changed.join(', ')}` : 'nothing to change (already set)');

    // Read back after a reload, so the check sees what the server stored and not this browser's copy.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready();
    const after = await page.evaluate(readState, args);
    log(`after:  ${show(after)}`);
    const wrong = mismatches(after);
    if (wrong.length) throw new Error(`read-back does not match: ${wrong.join('; ')}`);
    log('verified');
  } finally {
    await context.close().catch(() => {});
    rmSync(profile, { recursive: true, force: true });
  }
}

// Run only as a script (stage 11 runs it with node); the tests import the functions above. import.meta.url is the
// real path while argv[1] keeps a symlinked one, so compare against the real path: a false guard would exit 0 and
// change nothing, and the stage would report the switches as set.
const invokedAs = (() => {
  if (!process.argv[1]) return '';
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return pathToFileURL(process.argv[1]).href;
  }
})();
if (invokedAs === import.meta.url) {
  main().catch(err => {
    log(`error: ${err?.message ?? err}`);
    process.exit(1);
  });
}
