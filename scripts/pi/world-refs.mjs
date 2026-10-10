#!/usr/bin/env node
// Scans a Foundry world (and the compendium packs of chosen modules) for asset paths, so that
// scripts/pi/push-world.ps1 knows what to copy to the Pi and nothing is left behind (docs/dev/PI-SETUP.md,
// "Licensed content"). Runs on the PC, read-only: every LevelDB folder is copied to a temp folder first
// (without its LOCK file) and the copy is opened, so a running Foundry is never disturbed.
//
//   node scripts/pi/world-refs.mjs --world curse-of-strahd --modules aitool-content,dnd-players-handbook [--json]
//     --data <Foundry Data dir>   default C:/FoundryTest/data/Data
//     --level-module <path>       classic-level to use, default the one in C:/FoundryTest/app/node_modules
//     --allow-secret-keys a,b*    ddb-importer.* setting keys that were reviewed and are not secrets (a trailing * is
//                                 a prefix). A key with cookie, token, secret, password and so on in its name is
//                                 always a problem, whatever this list says.
//     --gm-user <name>            the world's GM user (default Gamemaster); stage 11 joins it with an empty password
//     --gm-password-ok            the GM's password is reported (gmUser.hasPassword) but is not a problem: a Plan B
//                                 push-back (docs/dev/PLAN-B.md), where the world keeps the Pi's own password and
//                                 stage 11 joins with the password in the Pi's world env file
//     --allow-missing a,b*        reviewed "known missing" asset paths: an exact path, or a prefix ending in *. A path
//                                 that is really missing on disk and matches is not a problem; it is only counted
//                                 (allowedMissingCount). A wrong-case path, or a path outside the bundle that exists on
//                                 disk, stays a problem. No .., no leading slash, no empty entry, and a * needs a root and
//                                 a folder before it (modules/<id>/*, ddb-images/adventures/<book>/*).
//
// Exit code 0: nothing to fix. 2: problems (the report is printed anyway). Setting VALUES are never
// printed, only the names of keys that look like secrets.
import { pbkdf2Sync } from 'node:crypto';
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
  // Foundry's own public files for the default scene (nue/defaultscene/*.webp, public/nue in the app).
  'nue',
]);
// Matched against the setting name after the module id (the part after the first dot), so module
// names like vtta-tokenizer or token-action-hud never count.
const SECRET_WORDS = [
  'cobalt',
  'patreon',
  'cookie',
  'bearer',
  'apikey',
  'api-key',
  'api_key',
  'privatekey',
  'private-key',
  'private_key',
  'credential',
  'secret',
  'password',
];
// A name that is or ends in token or key (discordToken, refresh-token, session_token, privateKey)
// counts too. Names that end so but hold no secret go on the short safe list below, never on a
// pattern, so a new credential setting can never slip through.
const SECRET_ENDING = /(?:token|key)$/;
const SAFE_SETTING_KEYS = new Set(['core.defaultToken']);

/** Whether a setting key's own name (after the module id) looks like it holds a secret. */
export function looksSecret(key) {
  if (SAFE_SETTING_KEYS.has(key)) return false;
  const lower = key.toLowerCase();
  const name = lower.slice(lower.indexOf('.') + 1);
  return SECRET_WORDS.some(w => name.includes(w)) || SECRET_ENDING.test(name);
}

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

/**
 * Walk any JSON value and collect every asset path into `into` (a Set). With `skipDdbFlags`, the
 * `flags.ddb` subtree of a document (at any depth: items[].flags.ddb, scenes.notes and so on) is left
 * out: the D&D Beyond importer keeps its own metadata there (alternateIds[].img = "assets/cos1302.jpg"),
 * and Foundry never loads those strings.
 */
export function collectPaths(value, into = new Set(), { skipDdbFlags = false } = {}) {
  walk(value, into, skipDdbFlags, false);
  return into;
}

function walk(value, into, skipDdb, isFlags) {
  if (typeof value === 'string') for (const p of pathsInString(value)) into.add(p);
  else if (Array.isArray(value)) for (const v of value) walk(v, into, skipDdb, false);
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) {
      if (skipDdb && isFlags && k === 'ddb') continue;
      walk(v, into, skipDdb, k === 'flags');
    }
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
 * Check the --allow-missing entries: an exact path, or a prefix whose only `*` is the last character.
 * Returns the clean list, throws on an empty entry, a leading slash, a `..` part, a `*` anywhere but
 * the end, or a pattern that is too broad: before the `*` it must name a root and a folder
 * ('ddb-images/adventures/X/*' and 'modules/JB2A_DnD5e/*' are fine; '*', 'modules/*' and 'ddb-images/*' are not).
 */
export function validateAllowMissing(entries) {
  return entries.map(raw => {
    const e = raw.trim();
    if (!e) throw new Error('--allow-missing: empty entry');
    if (e.startsWith('/') || e.startsWith('\\'))
      throw new Error(`--allow-missing: ${e} must not start with a slash`);
    if (e.split(/[\\/]/).includes('..'))
      throw new Error(`--allow-missing: ${e} must not contain ..`);
    const star = e.indexOf('*');
    if (star !== -1) {
      if (star !== e.length - 1 || e.indexOf('*', star + 1) !== -1)
        throw new Error(`--allow-missing: ${e}: a * is only allowed as the last character`);
      if (e.slice(0, star).split('/').length < 3)
        throw new Error(
          `--allow-missing: ${e} is too broad (name a root and a folder before the *, like modules/<id>/*)`
        );
    }
    return e;
  });
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
    if (!key) continue;
    // A secret-looking name always counts: the allow list can never excuse a cookie, token or key.
    const hasSecretWord = looksSecret(key);
    if (!hasSecretWord && (!lower.startsWith('ddb-importer.') || isAllowed(key, allow))) continue;
    const v = typeof d.value === 'string' ? d.value.trim() : JSON.stringify(d.value ?? '');
    if (empty.has(v) || /^(?:true|false|-?\d+(?:\.\d+)?)$/.test(v)) continue;
    keys.add(key);
  }
  return [...keys].sort();
}

/** The module ids a world switches on (its core.moduleConfiguration setting). docs: setting documents. */
export function activeModules(docs) {
  const doc = docs.find(d => d?.key === 'core.moduleConfiguration');
  if (!doc) return [];
  let cfg = doc.value;
  if (typeof cfg === 'string') {
    try {
      cfg = JSON.parse(cfg);
    } catch {
      return [];
    }
  }
  if (!cfg || typeof cfg !== 'object') return [];
  return Object.entries(cfg)
    .filter(([, on]) => on === true)
    .map(([id]) => id)
    .sort();
}

/** Active modules that are neither shipped nor the bridge (stage 5 installs the bridge). */
export function unshippedActive(active, modules) {
  return active.filter(id => id !== 'foundry-mcp-bridge' && !modules.includes(id));
}

/**
 * True when `password` is Foundry's hash of the empty string for this salt. Foundry 14 stores a hash
 * and `passwordSalt` even for a user with no password; its own code is
 * crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex").
 */
function isEmptyPasswordHash(password, salt) {
  if (typeof salt !== 'string' || salt === '') return false;
  return pbkdf2Sync('', salt, 1000, 64, 'sha512').toString('hex') === password;
}

/**
 * The world's GM user, as the problems it would cause for stage 11 (which joins with an empty password).
 * users: user documents ({ name, role, password, passwordSalt }). Returns { found, hasPassword, problems }
 * and never any password or salt value. The stored hash of the empty string is not a password.
 * passwordOk (a Plan B push-back): a password is still reported in hasPassword, but is not a problem.
 */
export function gmUserCheck(users, name, { passwordOk = false } = {}) {
  const gm = users.find(u => u?.name === name && u?.role === 4);
  const problems = [];
  if (!gm) problems.push(`no user named ${name} with the Gamemaster role (role 4)`);
  const hasPassword =
    !!gm &&
    typeof gm.password === 'string' &&
    gm.password !== '' &&
    !isEmptyPasswordHash(gm.password, gm.passwordSalt);
  if (hasPassword && !passwordOk)
    problems.push(`${name} has a password (stage 11 joins with an empty one: clear it first)`);
  return { found: !!gm, hasPassword, problems };
}

/**
 * Check one path against the disk with its exact name: NTFS ignores case, the Pi does not. root is the
 * Data folder, rel a path inside it, cache a Map that remembers each folder listing.
 * Returns { state: 'ok' } | { state: 'missing' } | { state: 'case', actual }. A `*` in the last part
 * matches any characters of that name.
 */
export function checkExactPath(root, rel, cache = new Map()) {
  const list = dir => {
    if (!cache.has(dir)) {
      let entries = null;
      try {
        entries = readdirSync(dir);
      } catch {
        // not a folder, or not there
      }
      cache.set(dir, entries);
    }
    return cache.get(dir);
  };
  const parts = rel.split('/');
  const actual = [];
  let cur = root;
  let caseDiffers = false;
  for (let i = 0; i < parts.length; i++) {
    const entries = list(cur);
    if (!entries) return { state: 'missing' };
    const part = parts[i];
    if (i === parts.length - 1 && part.includes('*')) {
      const re = new RegExp(
        '^' + part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'
      );
      return entries.some(e => re.test(e))
        ? { state: caseDiffers ? 'case' : 'ok', actual: [...actual, part].join('/') }
        : { state: 'missing' };
    }
    let name = entries.includes(part) ? part : undefined;
    if (name === undefined) {
      name = entries.find(e => e.toLowerCase() === part.toLowerCase());
      if (name === undefined) return { state: 'missing' };
      caseDiffers = true;
    }
    actual.push(name);
    cur = path.join(cur, name);
  }
  return caseDiffers ? { state: 'case', actual: actual.join('/') } : { state: 'ok' };
}

/**
 * Summarise a set of paths against the allowed ids. `check(path)` returns the state of the file on disk
 * ({ state: 'ok' | 'missing' | 'case', actual }); the older `exists(path)` boolean still works.
 * `allowMissing` (the reviewed "known missing" list, see isAllowed): a matching path that is really
 * missing on disk is no problem of any kind (no folder to copy either); it is listed in `allowedMissing`.
 * A wrong-case match stays a problem (a rename fixes it). A path in no known root ('other') is looked up
 * on disk too: if the file is there, push-world would not copy it, so it is always a problem
 * (`otherPresent`), whatever the list says.
 */
export function summarize(paths, { world, modules, exists, check, allowMissing = [] }) {
  const counts = {};
  const folders = new Set();
  const problems = {
    foreignModules: new Set(),
    foreignWorlds: new Set(),
    missing: [],
    caseMismatch: [],
    other: [],
    otherPresent: [],
  };
  const allowedMissing = [];
  for (const p of [...paths].sort()) {
    const c = classifyPath(p);
    counts[c.root] = (counts[c.root] ?? 0) + 1;
    if (c.root === 'core') continue;
    const r = check ? check(p) : { state: exists(p) ? 'ok' : 'missing' };
    const allowed = r.state === 'missing' && isAllowed(p, allowMissing);
    if (allowed) {
      allowedMissing.push(p);
      continue;
    }
    if (c.root === 'other') {
      (r.state === 'missing' ? problems.other : problems.otherPresent).push(p);
      continue;
    }
    if (c.folder) folders.add(c.folder);
    if (c.root === 'modules' && c.id !== 'foundry-mcp-bridge' && !modules.includes(c.id))
      problems.foreignModules.add(c.id);
    if (c.root === 'worlds' && c.id !== world) problems.foreignWorlds.add(c.id);
    if (r.state === 'missing') problems.missing.push(p);
    else if (r.state === 'case') problems.caseMismatch.push(`case differs: ${p} vs ${r.actual}`);
  }
  return { counts, folders: [...folders].sort(), problems, allowedMissing };
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

export function parseArgs(argv) {
  const o = {
    data: 'C:/FoundryTest/data/Data',
    world: '',
    modules: [],
    json: false,
    levelModule: '',
    allow: [],
    allowMissing: [],
    gmUser: 'Gamemaster',
    gmPasswordOk: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--data') o.data = argv[++i];
    else if (a === '--world') o.world = argv[++i];
    else if (a === '--modules') o.modules = (argv[++i] ?? '').split(',').filter(Boolean);
    else if (a === '--level-module') o.levelModule = argv[++i];
    else if (a === '--allow-secret-keys') o.allow = (argv[++i] ?? '').split(',').filter(Boolean);
    else if (a === '--allow-missing')
      o.allowMissing = validateAllowMissing((argv[++i] ?? '').split(',').filter(Boolean));
    else if (a === '--gm-user') o.gmUser = argv[++i];
    else if (a === '--gm-password-ok') o.gmPasswordOk = true;
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
  const users = [];
  try {
    for (const db of dbs) {
      const isSettings =
        path.normalize(db) === path.normalize(path.join(worldDir, 'data', 'settings'));
      const isUsers = path.normalize(db) === path.normalize(path.join(worldDir, 'data', 'users'));
      await readDb(ClassicLevel, db, tmpRoot, (_k, doc) => {
        collectPaths(doc, paths, { skipDdbFlags: true });
        if (isSettings && doc && typeof doc === 'object') settings.push(doc);
        // only name, role, password and salt are kept for gmUserCheck; no value leaves this block, only a boolean
        if (isUsers && doc && typeof doc === 'object')
          users.push({
            name: doc.name,
            role: doc.role,
            password: doc.password,
            passwordSalt: doc.passwordSalt,
          });
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
    if (existsSync(f))
      collectPaths(JSON.parse(readFileSync(f, 'utf8')), paths, { skipDdbFlags: true });
  }

  const dirCache = new Map();
  const check = p => checkExactPath(o.data, p, dirCache);
  const s = summarize(paths, {
    world: o.world,
    modules: o.modules,
    check,
    allowMissing: o.allowMissing,
  });
  const secrets = secretSettingKeys(settings, o.allow);
  const active = activeModules(settings);
  const gm = gmUserCheck(users, o.gmUser, { passwordOk: o.gmPasswordOk });
  const result = {
    world: o.world,
    modules: o.modules,
    dbsScanned: dbs.length,
    pathCount: paths.size,
    allowedMissingCount: s.allowedMissing.length,
    allowedMissing: s.allowedMissing.slice(0, 50),
    counts: s.counts,
    assetFolders: s.folders,
    problems: {
      foreignModules: [...s.problems.foreignModules].sort(),
      foreignWorlds: [...s.problems.foreignWorlds].sort(),
      missingCount: s.problems.missing.length,
      missing: s.problems.missing.slice(0, 50),
      caseMismatchCount: s.problems.caseMismatch.length,
      caseMismatch: s.problems.caseMismatch.slice(0, 50),
      otherRoots: s.problems.other.slice(0, 50),
      otherRootsCount: s.problems.other.length,
      otherPresent: s.problems.otherPresent.slice(0, 50),
      otherPresentCount: s.problems.otherPresent.length,
      secretSettingKeys: secrets,
      activeNotShipped: unshippedActive(active, o.modules),
      gmUser: gm.problems,
    },
    gmUser: {
      name: o.gmUser,
      found: gm.found,
      hasPassword: gm.hasPassword,
      passwordOk: o.gmPasswordOk,
    },
  };
  const p = result.problems;
  result.ok = !(
    p.foreignModules.length ||
    p.foreignWorlds.length ||
    p.missingCount ||
    p.caseMismatchCount ||
    p.otherRootsCount ||
    p.otherPresentCount ||
    p.secretSettingKeys.length ||
    p.activeNotShipped.length ||
    p.gmUser.length
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
    if (p.caseMismatchCount)
      console.log(
        `PROBLEM ${p.caseMismatchCount} paths whose letter case differs from the file (first ${p.caseMismatch.length}):\n` +
          p.caseMismatch.map(x => '  ' + x).join('\n')
      );
    if (s.allowedMissing.length)
      console.log(
        `${s.allowedMissing.length} known missing paths allowed by --allow-missing (not problems)`
      );
    for (const id of p.activeNotShipped)
      console.log(
        id === 'ddb-importer'
          ? 'PROBLEM ddb-importer is active in the world: switch it off there after the import (it stays on the PC; its settings can hold the D&D Beyond cookie)'
          : `PROBLEM active in the world but not shipped: ${id} (ship it with -Modules or switch it off in the world)`
      );
    for (const m of p.gmUser) console.log(`PROBLEM ${m}`);
    if (gm.hasPassword && o.gmPasswordOk)
      console.log(`${o.gmUser} has a password (kept: --gm-password-ok)`);
    if (p.otherRootsCount)
      console.log(
        `PROBLEM ${p.otherRootsCount} paths in unknown roots (first ${p.otherRoots.length}):\n` +
          p.otherRoots.map(x => '  ' + x).join('\n')
      );
    if (p.otherPresentCount)
      console.log(
        `PROBLEM ${p.otherPresentCount} paths present on disk but outside the bundle (push-world copies only the modules, the world, ddb-images and tokenizer; first ${p.otherPresent.length}):\n` +
          p.otherPresent.map(x => '  ' + x).join('\n')
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
