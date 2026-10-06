#!/usr/bin/env node
// Scans a Foundry world (and the compendium packs of chosen modules) for asset paths, so that
// scripts/pi/push-world.ps1 knows what to copy to the Pi and nothing is left behind (docs/dev/PI-SETUP.md,
// "Licensed content"). Runs on the PC, read-only: every LevelDB folder is copied to a temp folder first
// (without its LOCK file) and the copy is opened, so a running Foundry is never disturbed.
//
//   node scripts/pi/world-refs.mjs --world curse-of-strahd --modules aitool-content,dnd-players-handbook [--json]
//     --data <Foundry Data dir>   default C:/FoundryTest/data/Data
//     --level-module <path>       classic-level to use, default the one in C:/FoundryTest/app/node_modules
//     --allow-secret-keys a,b*    setting keys that were reviewed and are not secrets (a trailing * is a prefix)
//
// Exit code 0: nothing to fix. 2: problems (the report is printed anyway). Setting VALUES are never
// printed, only the names of keys that look like secrets.
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const ASSET_EXT = /\.(?:webp|png|jpe?g|gif|svg|avif|mp3|ogg|wav|m4a|flac|webm|mp4|m4v)$/i;
const CORE_ROOTS = new Set([
  'icons',
  'ui',
  'sounds',
  'cursors',
  'fonts',
  'canvas',
  'templates',
  'scripts',
]);
const SECRET_WORDS = [
  'cobalt',
  'patreon',
  'cookie',
  'token',
  'apikey',
  'api-key',
  'secret',
  'password',
];

/** A candidate string to a clean relative path, or null when it is not a local asset path. */
export function normalizeAssetPath(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 600) return null;
  let s = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('//')) return null; // http:, https:, data:, file: ...
  s = s.replace(/[?#].*$/, '');
  try {
    s = decodeURIComponent(s);
  } catch {
    // keep the text as it is when it is not valid percent-encoding
  }
  s = s.replace(/\\/g, '/').replace(/^(?:\.?\/)+/, '');
  if (!ASSET_EXT.test(s) || !s.includes('/')) return null;
  if (/[<>\n\r"]/.test(s) || s.split('/').includes('..')) return null;
  return s;
}

const HTML_ATTR =
  /\b(?:src|href|poster|data-src|data-image|data-edit)\s*=\s*(?:"([^"]*)"|'([^']*)')|url\(\s*["']?([^"')]+)["']?\s*\)/gi;

/** Every asset path inside one string: the string itself, or the attributes of embedded HTML. */
export function pathsInString(str) {
  const whole = normalizeAssetPath(str);
  if (whole) return [whole];
  if (typeof str !== 'string' || !/[<(]/.test(str)) return [];
  const found = [];
  for (const m of str.matchAll(HTML_ATTR)) {
    const p = normalizeAssetPath(m[1] ?? m[2] ?? m[3] ?? '');
    if (p) found.push(p);
  }
  return found;
}

/** Walk any JSON value and collect every asset path into `into` (a Set). */
export function collectPaths(value, into = new Set()) {
  if (typeof value === 'string') for (const p of pathsInString(value)) into.add(p);
  else if (Array.isArray(value)) for (const v of value) collectPaths(v, into);
  else if (value && typeof value === 'object')
    for (const v of Object.values(value)) collectPaths(v, into);
  return into;
}

/** Where a path lives: { root, id?, folder? }. folder is what push-world copies for ddb-images / tokenizer. */
export function classifyPath(p) {
  const parts = p.split('/');
  const first = parts[0];
  const dirs = parts.slice(1, -1);
  if (CORE_ROOTS.has(first)) return { root: 'core' };
  if (first === 'modules' || first === 'worlds' || first === 'systems')
    return { root: `${first}`, id: parts[1] ?? '' };
  if (first === 'ddb-images')
    return { root: 'ddb-images', folder: ['ddb-images', ...dirs.slice(0, 2)].join('/') };
  if (first === 'tokenizer')
    return { root: 'tokenizer', folder: ['tokenizer', ...dirs.slice(0, 1)].join('/') };
  return { root: 'other' };
}

/** True when `key` matches an allow entry: an exact key, or a prefix ending in `*` (ddb-importer.entity-*). */
export function isAllowed(key, allow) {
  return allow.some(a => (a.endsWith('*') ? key.startsWith(a.slice(0, -1)) : key === a));
}

/**
 * Setting keys that look like secrets and hold a value. docs: [{ key, value }]. Returns key names only.
 * Switches (true, false) and plain numbers are not secrets, so flags like core.dynamicTokenRing pass.
 */
export function secretSettingKeys(docs, allow = []) {
  const empty = new Set(['', '""', 'null', '{}', '[]', 'undefined']);
  const keys = new Set();
  for (const d of docs) {
    const key = typeof d?.key === 'string' ? d.key : '';
    const lower = key.toLowerCase();
    if (!key || isAllowed(key, allow)) continue;
    if (!lower.startsWith('ddb-importer.') && !SECRET_WORDS.some(w => lower.includes(w))) continue;
    const v = typeof d.value === 'string' ? d.value.trim() : JSON.stringify(d.value ?? '');
    if (empty.has(v) || /^(?:true|false|-?\d+(?:\.\d+)?)$/.test(v)) continue;
    keys.add(key);
  }
  return [...keys].sort();
}

/** Summarise a set of paths against the allowed ids. `exists(path)` says whether the file is on disk. */
export function summarize(paths, { world, modules, exists }) {
  const counts = {};
  const folders = new Set();
  const problems = { foreignModules: new Set(), foreignWorlds: new Set(), missing: [], other: [] };
  for (const p of [...paths].sort()) {
    const c = classifyPath(p);
    counts[c.root] = (counts[c.root] ?? 0) + 1;
    if (c.folder) folders.add(c.folder);
    if (c.root === 'other') problems.other.push(p);
    if (c.root === 'modules' && c.id !== 'foundry-mcp-bridge' && !modules.includes(c.id))
      problems.foreignModules.add(c.id);
    if (c.root === 'worlds' && c.id !== world) problems.foreignWorlds.add(c.id);
    if (c.root !== 'core' && c.root !== 'other' && !exists(p)) problems.missing.push(p);
  }
  return { counts, folders: [...folders].sort(), problems };
}

// ---- LevelDB reading (CLI only) ----------------------------------------------------------------

const isLevelDb = dir => existsSync(path.join(dir, 'CURRENT'));

function levelDbFolders(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && isLevelDb(path.join(dir, e.name)))
    .map(e => path.join(dir, e.name));
}

/** Copy a LevelDB folder to a temp dir (no LOCK), open the copy, call fn for each parsed document. */
async function readDb(ClassicLevel, src, tmpRoot, fn) {
  const copy = path.join(tmpRoot, String(Math.random()).slice(2));
  cpSync(src, copy, { recursive: true, filter: s => path.basename(s) !== 'LOCK' });
  const db = new ClassicLevel(copy, { createIfMissing: false, valueEncoding: 'utf8' });
  await db.open();
  try {
    for await (const [key, raw] of db.iterator()) {
      let doc;
      try {
        doc = JSON.parse(raw);
      } catch {
        doc = raw;
      }
      fn(key, doc);
    }
  } finally {
    await db.close();
  }
}

function parseArgs(argv) {
  const o = {
    data: 'C:/FoundryTest/data/Data',
    world: '',
    modules: [],
    json: false,
    levelModule: '',
    allow: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--data') o.data = argv[++i];
    else if (a === '--world') o.world = argv[++i];
    else if (a === '--modules') o.modules = (argv[++i] ?? '').split(',').filter(Boolean);
    else if (a === '--level-module') o.levelModule = argv[++i];
    else if (a === '--allow-secret-keys') o.allow = (argv[++i] ?? '').split(',').filter(Boolean);
    else throw new Error(`unknown argument ${a}`);
  }
  if (!/^[a-z0-9-]+$/.test(o.world))
    throw new Error('--world <id> is required (lowercase letters, digits, dashes)');
  for (const m of o.modules)
    if (!/^[A-Za-z0-9._-]+$/.test(m)) throw new Error(`bad module id ${m}`);
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const levelPath = o.levelModule || 'C:/FoundryTest/app/node_modules/classic-level';
  const { ClassicLevel } = createRequire(import.meta.url)(levelPath);
  const worldDir = path.join(o.data, 'worlds', o.world);
  if (!existsSync(path.join(worldDir, 'world.json')))
    throw new Error(`no world.json in ${worldDir}`);

  const dbs = [
    ...levelDbFolders(path.join(worldDir, 'data')),
    ...levelDbFolders(path.join(worldDir, 'packs')),
    ...o.modules.flatMap(m => levelDbFolders(path.join(o.data, 'modules', m, 'packs'))),
  ];
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'world-refs-'));
  const paths = new Set();
  const settings = [];
  try {
    for (const db of dbs) {
      const isSettings =
        path.normalize(db) === path.normalize(path.join(worldDir, 'data', 'settings'));
      await readDb(ClassicLevel, db, tmpRoot, (_k, doc) => {
        collectPaths(doc, paths);
        if (isSettings && doc && typeof doc === 'object') settings.push(doc);
      });
    }
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
  // world.json and module.json can name a background, banner or a pack's image too
  for (const f of [
    path.join(worldDir, 'world.json'),
    ...o.modules.map(m => path.join(o.data, 'modules', m, 'module.json')),
  ]) {
    if (existsSync(f)) collectPaths(JSON.parse(readFileSync(f, 'utf8')), paths);
  }

  const exists = p => {
    if (!p.includes('*')) return existsSync(path.join(o.data, p));
    const dir = path.join(o.data, path.dirname(p));
    const re = new RegExp(
      '^' +
        path
          .basename(p)
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*') +
        '$'
    );
    return existsSync(dir) && readdirSync(dir).some(f => re.test(f));
  };
  const s = summarize(paths, { world: o.world, modules: o.modules, exists });
  const secrets = secretSettingKeys(settings, o.allow);
  const result = {
    world: o.world,
    modules: o.modules,
    dbsScanned: dbs.length,
    pathCount: paths.size,
    counts: s.counts,
    assetFolders: s.folders,
    problems: {
      foreignModules: [...s.problems.foreignModules].sort(),
      foreignWorlds: [...s.problems.foreignWorlds].sort(),
      missingCount: s.problems.missing.length,
      missing: s.problems.missing.slice(0, 50),
      otherRoots: s.problems.other.slice(0, 50),
      otherRootsCount: s.problems.other.length,
      secretSettingKeys: secrets,
    },
  };
  const p = result.problems;
  result.ok = !(
    p.foreignModules.length ||
    p.foreignWorlds.length ||
    p.missingCount ||
    p.otherRootsCount ||
    p.secretSettingKeys.length
  );

  if (o.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      `world ${o.world}: ${dbs.length} databases scanned, ${paths.size} distinct asset paths`
    );
    console.log(
      'paths per root: ' +
        (Object.entries(s.counts)
          .map(([k, v]) => `${k} ${v}`)
          .join(', ') || 'none')
    );
    console.log('asset folders to copy:\n' + (s.folders.map(f => '  ' + f).join('\n') || '  none'));
    if (p.foreignModules.length)
      console.log('PROBLEM modules not in --modules: ' + p.foreignModules.join(', '));
    if (p.foreignWorlds.length)
      console.log('PROBLEM other worlds referenced: ' + p.foreignWorlds.join(', '));
    if (p.missingCount)
      console.log(
        `PROBLEM ${p.missingCount} missing files (first ${p.missing.length}):\n` +
          p.missing.map(x => '  ' + x).join('\n')
      );
    if (p.otherRootsCount)
      console.log(
        `PROBLEM ${p.otherRootsCount} paths in unknown roots (first ${p.otherRoots.length}):\n` +
          p.otherRoots.map(x => '  ' + x).join('\n')
      );
    if (p.secretSettingKeys.length)
      console.log(
        'PROBLEM world settings that look like secrets (names only): ' +
          p.secretSettingKeys.join(', ')
      );
    console.log(result.ok ? 'RESULT: no problems' : 'RESULT: problems found');
  }
  process.exit(result.ok ? 0 : 2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(err => {
    console.error(`world-refs: ${err.message}`);
    process.exit(1);
  });
}
