// Capture the shapes of Foundry 14 / dnd5e documents from a running test server (A by default) as
// JSON next to the foundry-mock, so a contract test can fail when the fake drifts from the real
// thing. A shape is every data path with the types seen there and how many of the sampled
// documents had it ("string|null:4": seen as a string or null in 4 documents). No values are written (no names, no book text), only paths and types.
//
//   node scripts/test-env/capture-shapes.mjs [--server A|B|C] [--out <dir>] [--user Claude]
//
// Needs the test server up with the world "ai-tool-test" (take the lock first, see lock.ps1).
// Joins as the passwordless GM `Claude` in a headless Edge, reads `game.*` and leaves.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..', '..');
const DEFAULT_OUT = join(
  ROOT,
  'packages',
  'foundry-module',
  'src',
  'test-support',
  'foundry-mock',
  'captured'
);

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const server = arg('server', 'A');
const out = resolve(arg('out', DEFAULT_OUT));
const user = arg('user', 'Claude');
const servers = JSON.parse(readFileSync(join(here, 'servers.json'), 'utf8'));
const cfg = servers[server];
if (!cfg) throw new Error(`Unknown server "${server}" (A, B or C).`);
if ([31414, 31415, 31416].includes(cfg.FoundryPort)) throw new Error('Refusing a live port.');
const foundryUrl = `http://localhost:${cfg.FoundryPort}`;

/** Runs in the page: sample documents and describe each kind's data paths. */
function collectInPage() {
  const MAX_DEPTH = 9;
  const EMBEDDED = new Set(['items', 'effects', 'tokens', 'notes', 'combatants', 'pages']);
  const typeOf = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

  /** Add the paths of one value to `paths` (path -> {types:Set, count}); `seen` counts a doc once. */
  function walk(value, path, paths, seen, depth) {
    const t = typeOf(value);
    const entry = (paths[path] ??= { types: new Set(), count: 0 });
    entry.types.add(t);
    if (!seen.has(path)) {
      seen.add(path);
      entry.count += 1;
    }
    if (depth >= MAX_DEPTH) return;
    if (t === 'array') {
      for (const item of value) walk(item, `${path}[]`, paths, seen, depth + 1);
    } else if (t === 'object') {
      // Module flags are other modules' data: keep the key, not what is inside.
      if (path === 'flags') return;
      for (const [k, v] of Object.entries(value)) {
        // A Foundry id as a key (an activity, an ownership entry) is one path, not one per id.
        const key = /^[A-Za-z0-9]{16}$/.test(k) && /\d/.test(k) ? '<id>' : k;
        walk(v, path ? `${path}.${key}` : key, paths, seen, depth + 1);
      }
    }
  }

  const kinds = new Map(); // kind -> {samples, paths}
  function sample(kind, data) {
    const k = kinds.get(kind) ?? { samples: 0, paths: {} };
    kinds.set(kind, k);
    k.samples += 1;
    const seen = new Set();
    for (const [key, v] of Object.entries(data)) {
      // Embedded documents are sampled as their own kinds (Actor.Item.weapon, Scene.Token, ...).
      if (EMBEDDED.has(key) && Array.isArray(v)) {
        const entry = (k.paths[key] ??= { types: new Set(), count: 0 });
        entry.types.add('array');
        entry.count += 1;
        continue;
      }
      walk(v, key, k.paths, seen, 1);
    }
  }

  const take = (collection, kindOf) => {
    for (const doc of collection) sample(kindOf(doc), doc.toObject());
  };

  take(game.actors.contents, d => `Actor.${d.type}`);
  take(game.items.contents, d => `Item.${d.type}`);
  for (const actor of game.actors.contents) {
    take(actor.items.contents, d => `Actor.Item.${d.type}`);
    take(actor.effects.contents, () => 'Actor.ActiveEffect');
  }
  take(game.scenes.contents, () => 'Scene');
  for (const scene of game.scenes.contents) {
    take(scene.tokens.contents, () => 'Scene.Token');
    take(scene.notes?.contents ?? [], () => 'Scene.Note');
  }
  take(game.combats.contents, () => 'Combat');
  for (const combat of game.combats.contents) {
    take(combat.combatants.contents, () => 'Combat.Combatant');
  }
  take(game.journal.contents, () => 'JournalEntry');
  for (const entry of game.journal.contents) {
    take(entry.pages.contents, d => `JournalEntry.Page.${d.type}`);
  }
  take(game.users.contents, () => 'User');
  take(game.messages.contents.slice(-40), () => 'ChatMessage');
  take(game.folders.contents, () => 'Folder');
  take(game.playlists.contents, () => 'Playlist');

  const result = {};
  for (const [kind, k] of kinds) {
    result[kind] = {
      samples: k.samples,
      paths: Object.fromEntries(
        Object.entries(k.paths).map(([p, e]) => [p, `${[...e.types].sort().join('|')}:${e.count}`])
      ),
    };
  }
  return {
    foundry: game.version,
    system: game.system.id,
    systemVersion: game.system.version,
    kinds: result,
  };
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`${foundryUrl}/join`);
  const name = page.locator('#join-username');
  await name.waitFor();
  if (await name.evaluate(el => el.tagName === 'SELECT')) {
    await name.selectOption({ label: user });
  } else {
    await name.fill(user);
    await page.keyboard.press('Escape');
  }
  await page.locator('button[name="join"]').click();
  await page.waitForURL(/\/game$/, { timeout: 90000 });
  await page.waitForFunction(() => globalThis.game?.ready === true, undefined, { timeout: 90000 });
  const captured = await page.evaluate(collectInPage);

  mkdirSync(out, { recursive: true });
  const sortKeys = o =>
    Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  let written = 0;
  for (const [kind, shape] of Object.entries(captured.kinds)) {
    const file = join(out, `${kind}.json`);
    const body = {
      kind,
      foundry: captured.foundry,
      system: `${captured.system} ${captured.systemVersion}`,
      samples: shape.samples,
      paths: sortKeys(shape.paths),
    };
    writeFileSync(file, JSON.stringify(body, null, 2) + '\n');
    written += 1;
  }
  console.log(
    `capture-shapes: ${written} shapes from ${foundryUrl} (Foundry ${captured.foundry}, ${captured.system} ${captured.systemVersion}) into ${out}`
  );
} finally {
  await browser.close();
}
