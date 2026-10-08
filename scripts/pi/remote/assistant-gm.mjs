// The Assistant GM: a headless Chromium logged into Foundry as a dedicated user, so the
// foundry-mcp-bridge module (which runs in a GM's browser) keeps its link to the bridge with no
// human GM online. Installed by stage 5 (scripts/pi/remote/5-tool.sh) and run by the
// foundry-ai-tool-gm-browser service as the foundry user.
//
//   node assistant-gm.mjs run        join and stay; exits on trouble so systemd restarts it
//   node assistant-gm.mjs provision  one time, in a fresh world: enable the module, create the
//                                    Assistant GM user and make it the bridge user
//   node assistant-gm.mjs script <file> [--dry-run] [--enable-module <id>]...
//                                    run one GM script (a local file) in the running world as the
//                                    Assistant GM; gm-script.sh is the way to call it on the Pi
//
// Environment: TOOL_APP (the built tool, for playwright-core), FOUNDRY_URL, CHROMIUM,
// GM_BROWSER_PROFILE, ASSISTANT_GM_USER, ASSISTANT_GM_PASSWORD; provision also reads
// PROVISION_GM_USER, PROVISION_GM_PASSWORD (empty for a fresh world's Gamemaster) and
// PROVISION_GM_NEW_PASSWORD (set on that user afterwards). Passwords are never printed.

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { lstatSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const env = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`${name} is not set`);
  return value;
};

// Loaded on first use, so the tests can import this file without the built tool.
let chromium;
function browserType() {
  if (!chromium) ({ chromium } = createRequire(join(env('TOOL_APP'), 'package.json'))('playwright-core'));
  return chromium;
}

const FOUNDRY_URL = env('FOUNDRY_URL', 'http://127.0.0.1:30000').replace(/\/$/, '');
const MODULE_ID = 'foundry-mcp-bridge';
const ASSISTANT_ROLE = 3; // CONST.USER_ROLES.ASSISTANT: a GM, but the human GM stays the primary GM
const CHECK_EVERY_MS = 60_000;
const WAIT_FOR_WORLD_MS = 30_000;

const log = msg => console.log(`[assistant-gm] ${msg}`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function launch(profile) {
  const context = await browserType().launchPersistentContext(profile, {
    executablePath: env('CHROMIUM', '/usr/bin/chromium'),
    headless: true,
    args: ['--disable-gpu', '--disable-dev-shm-usage', '--mute-audio', '--no-first-run'],
    viewport: { width: 1280, height: 800 },
  });
  // Even with no canvas, a paused world shows the "Game Paused" banner, whose CSS animation never
  // ends: the browser redraws it 60 times a second in software, which kept the gpu process busy
  // (measured on the PC: 15 % of a core down to 0.2 %; about 90 % on the Pi). Let every CSS
  // animation run once and stop (animationend still fires). An init script, so it also applies
  // after each reload and navigation; a constructable style sheet, so it needs no <head> yet.
  await context.addInitScript(() => {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync('*, *::before, *::after { animation-iteration-count: 1 !important; }');
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    } catch {
      // an engine without adoptedStyleSheets: the CPU stays high, nothing breaks
    }
  });
  return context;
}

// True when a world is running; false while Foundry shows setup, has no active world or is down.
// /join answers 200 even with no world ("There is currently no active game session"), so the
// status is not enough: a running world's join page carries <template id="join-game">
// (Foundry draws the form from it in the browser); the error page does not.
async function worldIsActive(page) {
  try {
    const res = await page.goto(`${FOUNDRY_URL}/join`, { waitUntil: 'domcontentloaded' });
    if (!res?.ok()) return false;
    const path = new URL(page.url()).pathname;
    if (path.endsWith('/game')) return true;
    return path.endsWith('/join') && (await page.locator('template#join-game').count()) > 0;
  } catch {
    return false;
  }
}

async function joinWorld(page, user, password) {
  if (new URL(page.url()).pathname.endsWith('/game')) return;
  await page.locator('#join-username').fill(user);
  await page.keyboard.press('Escape');
  await page.locator('#join-password').fill(password);
  await page.locator('button[name="join"]').click();
  await page.waitForURL(/\/game$/, { timeout: 60_000 });
}

async function waitForGame(page) {
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 120_000 });
}

// No map canvas in this browser: it saves the Pi's CPU, and the bridge reads documents, not the
// canvas (it falls back where it would pan or measure). A client setting, so only this browser.
async function noCanvas(page) {
  const changed = await page.evaluate(async () => {
    if (game.settings.get('core', 'noCanvas')) return false;
    await game.settings.set('core', 'noCanvas', true);
    return true;
  });
  if (changed) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForGame(page);
  }
}

async function enter(page, user, password) {
  while (!(await worldIsActive(page))) {
    log(`no world is running at ${FOUNDRY_URL}; trying again in ${WAIT_FOR_WORLD_MS / 1000} s`);
    await sleep(WAIT_FOR_WORLD_MS);
  }
  await joinWorld(page, user, password);
  await waitForGame(page);
  await noCanvas(page);
}

async function run() {
  const user = env('ASSISTANT_GM_USER', 'Assistant GM');
  const context = await launch(env('GM_BROWSER_PROFILE'));
  const page = context.pages()[0] ?? (await context.newPage());
  page.on('crash', () => {
    log('the page crashed');
    process.exit(1);
  });
  await enter(page, user, env('ASSISTANT_GM_PASSWORD'));
  const info = await page.evaluate(
    id => ({
      world: game.world.id,
      user: game.user.name,
      isGM: game.user.isGM,
      module: game.modules.get(id)?.active ?? false,
    }),
    MODULE_ID
  );
  log(
    `joined world ${info.world} as ${info.user} (GM: ${info.isGM}, module active: ${info.module})`
  );
  if (!info.module) log(`the ${MODULE_ID} module is not active in this world; enable it as a GM`);
  // Stay. Foundry sends a client back to /join when the world stops or the user is kicked;
  // exit then and let systemd start a fresh browser.
  for (;;) {
    await sleep(CHECK_EVERY_MS);
    const ok = await page
      .evaluate(() => globalThis.game?.ready === true && location.pathname.endsWith('/game'))
      .catch(() => false);
    if (!ok) {
      log('left the game (world stopped, kicked or the page broke); restarting');
      await context.close().catch(() => {});
      process.exit(1);
    }
  }
}

async function provision() {
  const gmUser = env('PROVISION_GM_USER', 'Gamemaster');
  const gmPassword = env('PROVISION_GM_PASSWORD', '');
  const gmNewPassword = env('PROVISION_GM_NEW_PASSWORD', '');
  const assistant = env('ASSISTANT_GM_USER', 'Assistant GM');
  const assistantPassword = env('ASSISTANT_GM_PASSWORD');
  // A throwaway profile, so the Gamemaster's session never lands in the Assistant GM's profile.
  const profile = mkdtempSync(join(tmpdir(), 'assistant-gm-provision-'));
  const context = await launch(profile);
  const page = context.pages()[0] ?? (await context.newPage());
  try {
    // A fresh world's Gamemaster has no password; after a first run it has the new one.
    if (!(await worldIsActive(page))) throw new Error(`no world is running at ${FOUNDRY_URL}`);
    try {
      await joinWorld(page, gmUser, gmNewPassword || gmPassword);
    } catch {
      await worldIsActive(page);
      await joinWorld(page, gmUser, gmPassword);
    }
    await waitForGame(page);

    const enabled = await page.evaluate(async id => {
      const config = game.settings.get('core', 'moduleConfiguration') ?? {};
      if (config[id]) return false;
      await game.settings.set('core', 'moduleConfiguration', { ...config, [id]: true });
      return true;
    }, MODULE_ID);
    if (enabled) {
      log(`enabled ${MODULE_ID}; reloading`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForGame(page);
    }

    const result = await page.evaluate(
      async ({ id, name, password, role, gmPassword }) => {
        if (!game.modules.get(id)?.active) throw new Error(`${id} is not active after enabling it`);
        let user = game.users.getName(name);
        if (user) await user.update({ role, password });
        else user = await User.implementation.create({ name, role, password });
        await game.settings.set(id, 'bridgeUserId', user.id);
        if (gmPassword) await game.user.update({ password: gmPassword });
        return {
          bridgeUser: game.settings.get(id, 'bridgeUserId') === user.id,
          users: game.users.map(u => `${u.name} (role ${u.role})`),
        };
      },
      {
        id: MODULE_ID,
        name: assistant,
        password: assistantPassword,
        role: ASSISTANT_ROLE,
        gmPassword: gmNewPassword,
      }
    );
    log(`module active; bridge user is ${assistant}: ${result.bridgeUser}`);
    log(`users: ${result.users.join(', ')}`);
    if (!result.bridgeUser) throw new Error('the bridge user setting did not stick');
  } finally {
    await context.close().catch(() => {});
    rmSync(profile, { recursive: true, force: true });
  }
}


// --- GM scripts --------------------------------------------------------------------------------
// One GM script per call, from a local file given on this machine's command line: there is no
// network endpoint, no listening port, and nothing the bridge or the dashboard can trigger. The
// file is the body of an async function that gets `args` ({ dryRun, log }) and returns something
// JSON can hold. Every run logs the file, its sha256, the mode and the result (gm-script.sh runs
// it as a systemd unit, so all of it lands in the journal).

const SCRIPT_MAX_BYTES = 1_000_000;
const RESULT_LOG_MAX = 4000;
const MODULE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Parses `script <file> [--dry-run] [--enable-module <id>]...` (the words after `script`). */
export function parseScriptArgs(words) {
  const options = { file: null, dryRun: false, enableModules: [] };
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word === '--dry-run') options.dryRun = true;
    else if (word === '--enable-module') {
      const id = words[++i];
      if (!id || !MODULE_ID_PATTERN.test(id)) throw new Error('--enable-module needs a module id');
      options.enableModules.push(id);
    } else if (word.startsWith('-')) throw new Error(`unknown option ${word}`);
    else if (options.file) throw new Error('give one script file');
    else options.file = word;
  }
  if (!options.file) throw new Error('give the script file');
  if (!isAbsolute(options.file)) throw new Error(`the script file must be an absolute path: ${options.file}`);
  return options;
}

/** Reads the script: a regular file (not a link or folder) of at most SCRIPT_MAX_BYTES. */
export function readScript(file) {
  const stat = lstatSync(file);
  if (!stat.isFile()) throw new Error(`${file} is not a regular file`);
  if (stat.size > SCRIPT_MAX_BYTES) throw new Error(`${file} is larger than ${SCRIPT_MAX_BYTES} bytes`);
  const source = readFileSync(file, 'utf8');
  return { source, sha256: createHash('sha256').update(source).digest('hex') };
}

/**
 * Runs in the page before a dry run. Every write the page would send is recorded in
 * globalThis.__gmScriptBlocked and never reaches the server: document writes (the database
 * backend and the raw modifyDocument socket), file operations (manageFiles) and uploads (any
 * fetch that is not GET or HEAD). Reads still work, so a script can report what it would change.
 */
export function installDryRunGuard() {
  const blocked = [];
  globalThis.__gmScriptBlocked = blocked;
  const backend = CONFIG.DatabaseBackend;
  const describe = (action, documentClass, operation) => {
    const items = operation?.data ?? operation?.updates ?? operation?.ids ?? [];
    const parent = operation?.parentUuid ?? operation?.parent?.uuid;
    return `${action} ${documentClass?.documentName ?? 'document'} x${items.length}${parent ? ` in ${parent}` : ''}`;
  };
  backend._createDocuments = async (documentClass, operation) => {
    blocked.push(describe('create', documentClass, operation));
    return [];
  };
  backend._updateDocuments = async (documentClass, operation) => {
    blocked.push(describe('update', documentClass, operation));
    return [];
  };
  backend._deleteDocuments = async (documentClass, operation) => {
    blocked.push(describe('delete', documentClass, operation));
    return [];
  };
  backend.modifyDocumentBatch = async operations => {
    blocked.push(`batch of ${operations?.length ?? 0} operations`);
    return (operations ?? []).map(() => []);
  };
  const emit = game.socket.emit.bind(game.socket);
  // Foundry also reads documents over modifyDocument (action "get"): those go through.
  const isRead = (event, request) =>
    (event === 'modifyDocument' && request?.action === 'get') ||
    (event === 'modifyDocumentBatch' && Array.isArray(request) && request.length > 0 && request.every(r => r?.action === 'get'));
  game.socket.emit = (event, ...rest) => {
    if (isRead(event, rest[0])) return emit(event, ...rest);
    if (event === 'modifyDocument' || event === 'modifyDocumentBatch' || event === 'manageFiles') {
      blocked.push(`socket ${event}${rest[0]?.action ? ` ${rest[0].action}` : ''}`);
      const ack = rest.findLast(arg => typeof arg === 'function');
      if (ack) ack({ error: 'dry run' });
      return game.socket;
    }
    return emit(event, ...rest);
  };
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init = {}) => {
    const method = String(init.method ?? input?.method ?? 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD') return realFetch(input, init);
    blocked.push(`${method} ${typeof input === 'string' ? input : (input?.url ?? input)}`);
    return Promise.resolve(new Response('{"status":"dry run"}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
  };
  return true;
}

/** Runs in the page: the script source as the body of an async function with `args`. */
export async function runScriptSource({ source, dryRun }) {
  const lines = [];
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const body = new AsyncFunction('args', source);
  const value = await body({ dryRun, log: msg => lines.push(String(msg)) });
  return { value: value === undefined ? null : JSON.parse(JSON.stringify(value)), lines, blocked: globalThis.__gmScriptBlocked ?? [] };
}

const clip = text => (text.length > RESULT_LOG_MAX ? `${text.slice(0, RESULT_LOG_MAX)} ... (${text.length} characters)` : text);

async function script(words) {
  const options = parseScriptArgs(words);
  const { source, sha256 } = readScript(options.file);
  const mode = options.dryRun ? 'dry run' : 'for real';
  log(`script ${options.file} sha256 ${sha256} (${mode})`);
  const user = env('ASSISTANT_GM_USER', 'Assistant GM');
  // A throwaway profile: the service's profile stays as it is (and keeps its no-canvas setting).
  const profile = mkdtempSync(join(tmpdir(), 'assistant-gm-script-'));
  const context = await launch(profile);
  const page = context.pages()[0] ?? (await context.newPage());
  try {
    if (!(await worldIsActive(page))) throw new Error(`no world is running at ${FOUNDRY_URL}`);
    await joinWorld(page, user, env('ASSISTANT_GM_PASSWORD'));
    await waitForGame(page);
    const info = await page.evaluate(() => ({ world: game.world.id, user: game.user.name, isGM: game.user.isGM }));
    log(`joined world ${info.world} as ${info.user} (GM: ${info.isGM})`);
    if (!info.isGM) throw new Error(`${info.user} is not a GM in ${info.world}`);

    const toEnable = await page.evaluate(
      ids => ids.filter(id => !game.settings.get('core', 'moduleConfiguration')?.[id]),
      options.enableModules
    );
    const missing = await page.evaluate(ids => ids.filter(id => !game.modules.has(id)), toEnable);
    if (missing.length) throw new Error(`not installed on this server: ${missing.join(', ')}`);
    if (toEnable.length && options.dryRun) log(`dry run: would enable ${toEnable.join(', ')} (the script runs without them)`);
    else if (toEnable.length) {
      await page.evaluate(async ids => {
        const config = game.settings.get('core', 'moduleConfiguration') ?? {};
        await game.settings.set('core', 'moduleConfiguration', { ...config, ...Object.fromEntries(ids.map(id => [id, true])) });
      }, toEnable);
      log(`enabled ${toEnable.join(', ')}; reloading`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForGame(page);
    }

    if (options.dryRun) await page.evaluate(installDryRunGuard);
    const result = await page.evaluate(runScriptSource, { source, dryRun: options.dryRun });
    for (const line of result.lines) log(`script: ${line}`);
    if (options.dryRun) log(`dry run: ${result.blocked.length} writes held back${result.blocked.length ? `: ${result.blocked.join('; ')}` : ''}`);
    log(`result ok sha256 ${sha256}: ${clip(JSON.stringify(result.value))}`);
  } catch (err) {
    log(`result error sha256 ${sha256}: ${err?.message ?? err}`);
    throw err;
  } finally {
    await context.close().catch(() => {});
    rmSync(profile, { recursive: true, force: true });
  }
}

const MODES = { run, provision, script };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const main = MODES[process.argv[2]];
  if (!main) {
    console.error('usage: node assistant-gm.mjs run|provision|script <file> [--dry-run] [--enable-module <id>]');
    process.exit(2);
  }
  main(process.argv.slice(3)).catch(err => {
    log(`error: ${err?.message ?? err}`);
    process.exit(1);
  });
}
