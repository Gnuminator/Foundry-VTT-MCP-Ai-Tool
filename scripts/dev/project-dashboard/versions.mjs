// Versions of Foundry core, the dnd5e system and each module: installed on the PC test server,
// installed on the Orange Pi (read-only, one ssh call), and the newest one online.
//
//   getVersions({ paths, now, deps, force }) -> { pc, pi, newest, foundry, rows: [VersionRow] }
//   readPcVersions({ root }), readPiVersions({ run }), fetchNewest({ items, fetchImpl }),
//   buildVersionRows({ pc, pi, newest }), parseManifest(obj, hint), splitJsonStream(text),
//   parseFoundryReleases(html), compareVersions(a, b)
//
// `run(file, args)` returns the stdout text (a promise); the default runs ssh without a shell.
// The Pi read and the online check run at most every 6 hours, the result is cached in the data folder.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const REFRESH_MS = 6 * 3600 * 1000;
// A Pi read that failed (Pi off, network down) is tried again sooner.
export const RETRY_MS = 30 * 60 * 1000;
export const PI_COMMAND =
  'cat /opt/foundry/package.json /var/lib/foundry/Data/systems/dnd5e/system.json /var/lib/foundry/Data/modules/*/module.json';

const SSH_TIMEOUT_MS = 15_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY = 1024 * 1024;
const MAX_IN_FLIGHT = 6;
const MAX_STRING = 200;
const CACHE_FILE = 'versions-cache.json';
const RELEASES_URL = 'https://foundryvtt.com/releases/';
const DND5E_LATEST_URL = 'https://api.github.com/repos/foundryvtt/dnd5e/releases/latest';
const KIND_RANK = { core: 0, system: 1, module: 2 };

function str(v, max) {
  if (typeof v !== 'string') return '';
  return v.length > max ? v.slice(0, max) : v;
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isHttpUrl(v) {
  return typeof v === 'string' && /^https?:\/\//.test(v);
}

// ---------------------------------------------------------------- versions

// Numeric per dot segment; anything from the first - or + is ignored.
export function compareVersions(a, b) {
  const parts = v =>
    (typeof v === 'string' ? v : '')
      .split(/[-+]/)[0]
      .split('.')
      .map(p => {
        const n = parseInt(p, 10);
        return Number.isNaN(n) ? 0 : n;
      });
  const pa = parts(a);
  const pb = parts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// One manifest (package.json of Foundry, system.json or module.json) reduced to the few fields we use.
export function parseManifest(obj, hint) {
  if (!isObject(obj)) return null;
  const rel = obj.release;
  if (isObject(rel) && Number.isFinite(rel.generation) && Number.isFinite(rel.build)) {
    return {
      id: 'foundry',
      kind: 'core',
      title: 'Foundry VTT',
      version: `${rel.generation}.${rel.build}`,
      manifest: null,
      minCore: null,
    };
  }
  const id = str(obj.id, 80);
  if (!id || id === '__proto__' || !/^[A-Za-z0-9._-]+$/.test(id)) return null;
  const version = str(obj.version, 40);
  if (!version || !/^[0-9A-Za-z.+_-]+$/.test(version)) return null;
  let kind;
  if (hint === 'system' || hint === 'module') kind = hint;
  else kind = id === 'dnd5e' ? 'system' : 'module';
  const min = isObject(obj.compatibility) ? obj.compatibility.minimum : undefined;
  const minText =
    typeof min === 'string'
      ? min
      : typeof min === 'number' && Number.isFinite(min)
        ? String(min)
        : '';
  return {
    id,
    kind,
    title: str(obj.title, 80) || id,
    version,
    manifest: isHttpUrl(obj.manifest) ? str(obj.manifest, 300) : null,
    minCore: str(minText, 20) || null,
  };
}

// Concatenated JSON objects (the output of one `cat` of many files) -> the parsed objects.
export function splitJsonStream(text) {
  const out = [];
  if (typeof text !== 'string') return out;
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (depth === 0) {
      if (ch === '{') {
        depth = 1;
        start = i;
        inString = false;
        escaped = false;
      }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          out.push(JSON.parse(text.slice(start, i + 1)));
        } catch {
          // not valid JSON, skip this slice
        }
      }
    }
  }
  return out;
}

function sortItems(items) {
  return items.sort(
    (a, b) =>
      (KIND_RANK[a.kind] ?? 3) - (KIND_RANK[b.kind] ?? 3) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

// ---------------------------------------------------------------- PC test server

function readJsonFile(file) {
  try {
    if (fs.statSync(file).size > MAX_BODY) return null;
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

function isDir(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function readPackages(dir, file, hint) {
  const items = [];
  let names = [];
  try {
    names = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return items;
  }
  for (const entry of names) {
    if (!entry.isDirectory()) continue;
    const item = parseManifest(readJsonFile(path.join(dir, entry.name, file)), hint);
    if (item) items.push(item);
  }
  return items;
}

export function readPcVersions({ root, now = new Date() } = {}) {
  const asOf = now.toISOString();
  const dataDir = typeof root === 'string' ? path.join(root, 'data', 'Data') : '';
  if (!dataDir || !isDir(root) || !isDir(path.join(root, 'data'))) {
    return { asOf, error: 'test server folder not found', items: [] };
  }
  const items = [];
  const core =
    parseManifest(readJsonFile(path.join(root, 'app', 'package.json'))) ||
    parseManifest(readJsonFile(path.join(root, 'app', 'resources', 'app', 'package.json')));
  if (core && core.kind === 'core') items.push(core);
  items.push(...readPackages(path.join(dataDir, 'systems'), 'system.json', 'system'));
  items.push(...readPackages(path.join(dataDir, 'modules'), 'module.json', 'module'));
  return { asOf, error: null, items: sortItems(items) };
}

// ---------------------------------------------------------------- Orange Pi

function defaultRun(file, args) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout: SSH_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        // cat exits non-zero when one file is missing, but the rest of stdout is still useful.
        if (err && !String(stdout || '').trim()) {
          err.stderr = stderr;
          reject(err);
        } else {
          resolve(stdout);
        }
      }
    );
  });
}

function shortError(err) {
  if (err && err.killed) return 'ssh to foundry-pi timed out after 15 s';
  if (err && err.code === 'ENOENT') return 'ssh not found on PATH';
  const raw = (err && (err.stderr || err.message)) || 'ssh failed';
  const line =
    String(raw)
      .split(/\r?\n/)
      .find(l => l.trim()) || 'ssh failed';
  const text = line.trim();
  return text.length > 150 ? `${text.slice(0, 147)}...` : text;
}

export async function readPiVersions({ run = defaultRun, now = new Date() } = {}) {
  let stdout;
  try {
    stdout = await run('ssh', [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=5',
      'foundry-pi',
      PI_COMMAND,
    ]);
  } catch (err) {
    return { asOf: null, error: shortError(err), items: [] };
  }
  const items = sortItems(
    splitJsonStream(typeof stdout === 'string' ? stdout : '')
      .map(obj => parseManifest(obj))
      .filter(Boolean)
  );
  if (items.length === 0)
    return { asOf: null, error: 'no versions read from foundry-pi', items: [] };
  return { asOf: now.toISOString(), error: null, items };
}

// ---------------------------------------------------------------- newest online

// The releases page, newest first or not: pick the highest version by number.
export function parseFoundryReleases(html) {
  const out = { newestStable: null, newestAny: null, newestAnyChannel: null };
  if (typeof html !== 'string') return out;
  for (const chunk of html.split('<li class="article release').slice(1)) {
    const v = /href="\/releases\/(\d+\.\d+)"/.exec(chunk);
    if (!v) continue;
    const version = v[1];
    const c = /release-tag\s+(stable|testing|development|prototype)\b/i.exec(chunk);
    const channel = c ? c[1].toLowerCase() : null;
    if (out.newestAny === null || compareVersions(version, out.newestAny) > 0) {
      out.newestAny = version;
      out.newestAnyChannel = channel;
    }
    if (
      channel === 'stable' &&
      (out.newestStable === null || compareVersions(version, out.newestStable) > 0)
    ) {
      out.newestStable = version;
    }
  }
  return out;
}

async function fetchText(fetchImpl, url, headers) {
  if (!isHttpUrl(url)) throw new Error('only http and https urls are fetched');
  const res = await fetchImpl(url, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : 'error'}`);
  const length = Number(res.headers && res.headers.get && res.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_BODY) throw new Error('response too large');
  const text = await res.text();
  if (typeof text !== 'string' || text.length > MAX_BODY) throw new Error('response too large');
  return text;
}

async function runPool(tasks, limit) {
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const task = tasks[next];
      next += 1;
      await task();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}

export async function fetchNewest({
  items = [],
  fetchImpl = globalThis.fetch,
  now = new Date(),
} = {}) {
  const result = {
    asOf: now.toISOString(),
    errors: 0,
    foundry: { newestStable: null, newestAny: null, newestAnyChannel: null },
    byId: {},
  };
  const get = (url, headers) => fetchText(fetchImpl, url, headers);
  const manifestVersion = async (url, hint) => {
    const item = parseManifest(JSON.parse(await get(url)), hint);
    if (!item) throw new Error('not a manifest');
    return { version: item.version, minCore: item.minCore };
  };

  const list = Array.isArray(items) ? items.filter(isObject) : [];
  const tasks = [];

  tasks.push(async () => {
    try {
      result.foundry = parseFoundryReleases(await get(RELEASES_URL));
    } catch {
      result.errors += 1;
    }
  });

  tasks.push(async () => {
    try {
      const body = JSON.parse(
        await get(DND5E_LATEST_URL, {
          accept: 'application/vnd.github+json',
          'user-agent': 'foundry-ai-tool-project-dashboard',
        })
      );
      const version = str(body && body.tag_name, 80).replace(/^\D*/, '');
      if (!version || version.length > 40 || !/^[0-9A-Za-z.+_-]+$/.test(version)) {
        throw new Error('no version in tag');
      }
      result.byId.dnd5e = { version, minCore: null };
      return;
    } catch {
      result.errors += 1;
    }
    const system = list.find(i => i.id === 'dnd5e' && isHttpUrl(i.manifest));
    if (!system) return;
    try {
      result.byId.dnd5e = await manifestVersion(system.manifest, 'system');
    } catch {
      result.errors += 1;
    }
  });

  const seen = new Set();
  for (const item of list) {
    if (item.kind !== 'module' || typeof item.id !== 'string' || seen.has(item.id)) continue;
    if (!isHttpUrl(item.manifest)) continue;
    seen.add(item.id);
    tasks.push(async () => {
      try {
        result.byId[item.id] = await manifestVersion(item.manifest, 'module');
      } catch {
        result.errors += 1;
      }
    });
  }

  await runPool(tasks, MAX_IN_FLIGHT);
  return result;
}

// ---------------------------------------------------------------- rows

export function buildVersionRows({ pc, pi, newest } = {}) {
  const pcItems = new Map();
  const piItems = new Map();
  for (const item of (pc && pc.items) || []) pcItems.set(item.id, item);
  for (const item of (pi && pi.items) || []) piItems.set(item.id, item);
  const byId = (newest && newest.byId) || {};
  const rows = [];
  for (const id of new Set([...pcItems.keys(), ...piItems.keys()])) {
    const a = pcItems.get(id);
    const b = piItems.get(id);
    const base = a || b;
    const online = Object.hasOwn(byId, id) ? byId[id] : null;
    const newestVersion =
      base.kind === 'core'
        ? (newest && newest.foundry && newest.foundry.newestStable) || null
        : (online && online.version) || null;
    const pcVersion = a ? a.version : null;
    const piVersion = b ? b.version : null;
    let status = 'unknown';
    if (
      newestVersion &&
      [pcVersion, piVersion].some(v => v && compareVersions(v, newestVersion) < 0)
    ) {
      status = 'behind';
    } else if (pcVersion && piVersion && pcVersion !== piVersion) {
      status = 'differs';
    } else if (newestVersion) {
      status = 'ok';
    }
    rows.push({
      id,
      kind: base.kind,
      title: (a && a.title) || (b && b.title) || id,
      pc: pcVersion,
      pi: piVersion,
      newest: newestVersion,
      minCore: (online && online.minCore) || null,
      status,
    });
  }
  return sortItems(rows);
}

// ---------------------------------------------------------------- cache and snapshot

function readCache(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

function writeCache(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  } catch {
    // the cache is only an optimisation
  }
}

function textOrNull(v) {
  return typeof v === 'string' ? v : null;
}

function cleanItem(i) {
  if (!isObject(i) || typeof i.id !== 'string' || typeof i.version !== 'string') return null;
  if (i.id === '__proto__') return null;
  return {
    id: i.id,
    kind: i.kind === 'core' || i.kind === 'system' ? i.kind : 'module',
    title: typeof i.title === 'string' ? i.title : i.id,
    version: i.version,
    manifest: textOrNull(i.manifest),
    minCore: textOrNull(i.minCore),
  };
}

function cleanPi(r) {
  if (!isObject(r)) return null;
  const items = Array.isArray(r.items) ? r.items.map(cleanItem).filter(Boolean) : [];
  return { asOf: textOrNull(r.asOf), error: textOrNull(r.error), items };
}

function cleanNewest(r) {
  if (!isObject(r)) return null;
  const f = isObject(r.foundry) ? r.foundry : {};
  const byId = {};
  if (isObject(r.byId)) {
    for (const [id, v] of Object.entries(r.byId)) {
      if (id === '__proto__' || !isObject(v) || typeof v.version !== 'string') continue;
      byId[id] = { version: v.version, minCore: textOrNull(v.minCore) };
    }
  }
  return {
    asOf: textOrNull(r.asOf),
    errors: Number.isFinite(r.errors) ? r.errors : 0,
    foundry: {
      newestStable: textOrNull(f.newestStable),
      newestAny: textOrNull(f.newestAny),
      newestAnyChannel: textOrNull(f.newestAnyChannel),
    },
    byId,
  };
}

function entry(raw, clean) {
  if (!isObject(raw) || !Number.isFinite(raw.at)) return null;
  const result = clean(raw.result);
  return result ? { at: raw.at, result } : null;
}

function isDue(cached, nowMs, force, failed = false) {
  if (force || !cached) return true;
  return nowMs < cached.at || nowMs - cached.at >= (failed ? RETRY_MS : REFRESH_MS);
}

function hasData(r) {
  return r.foundry.newestStable !== null || Object.keys(r.byId).length > 0;
}

// A new result that failed (or only half worked) is filled in from the previous one.
function mergeNewest(fresh, prev) {
  if (!prev) return hasData(fresh) ? fresh : { ...fresh, asOf: null };
  if (!hasData(fresh)) return { ...prev, errors: fresh.errors };
  return {
    asOf: fresh.asOf,
    errors: fresh.errors,
    foundry: fresh.foundry.newestStable !== null ? fresh.foundry : prev.foundry,
    byId: { ...prev.byId, ...fresh.byId },
  };
}

function cut(v) {
  return typeof v === 'string' && v.length > MAX_STRING ? v.slice(0, MAX_STRING) : v;
}

let inFlight = null;

async function refresh({ paths, now, deps, force }) {
  const readPc = deps.readPc || readPcVersions;
  const readPi = deps.readPi || readPiVersions;
  const getNewest = deps.fetchNewest || fetchNewest;
  const nowMs = now.getTime();
  const cacheFile = path.join(paths.dataDir, CACHE_FILE);

  let pc;
  try {
    pc = await readPc({ root: paths.testEnvRoot, now });
  } catch {
    pc = null;
  }
  if (!pc || !Array.isArray(pc.items)) {
    pc = { asOf: null, error: 'could not read the test server', items: [] };
  }

  const raw = readCache(cacheFile);
  const cachedPi = entry(raw && raw.pi, cleanPi);
  const cachedNewest = entry(raw && raw.newest, cleanNewest);
  let pi = cachedPi ? cachedPi.result : { asOf: null, error: null, items: [] };
  let newest = cachedNewest
    ? cachedNewest.result
    : cleanNewest({ asOf: null, errors: 0, foundry: {}, byId: {} });
  let piAt = cachedPi ? cachedPi.at : nowMs;
  let newestAt = cachedNewest ? cachedNewest.at : nowMs;
  let changed = false;

  if (isDue(cachedPi, nowMs, force, Boolean(cachedPi && cachedPi.result.error))) {
    changed = true;
    let fresh;
    try {
      fresh = await readPi({ now });
    } catch (err) {
      fresh = { asOf: null, error: shortError(err), items: [] };
    }
    if (!fresh || !Array.isArray(fresh.items)) {
      fresh = { asOf: null, error: 'could not read the Orange Pi', items: [] };
    }
    if (fresh.error && cachedPi && cachedPi.result.items.length > 0) {
      pi = { asOf: cachedPi.result.asOf, error: fresh.error, items: cachedPi.result.items };
    } else {
      pi = { asOf: fresh.asOf ?? null, error: fresh.error ?? null, items: fresh.items };
    }
    piAt = nowMs;
  }

  if (isDue(cachedNewest, nowMs, force)) {
    changed = true;
    const items = [...pc.items, ...pi.items];
    let fresh;
    try {
      fresh = cleanNewest(await getNewest({ items, now }));
    } catch {
      fresh = null;
    }
    if (!fresh) fresh = cleanNewest({ asOf: null, errors: 1, foundry: {}, byId: {} });
    newest = mergeNewest(fresh, cachedNewest ? cachedNewest.result : null);
    newestAt = nowMs;
  }

  if (changed) {
    writeCache(cacheFile, {
      pi: { at: piAt, result: pi },
      newest: { at: newestAt, result: newest },
    });
  }

  const rows = buildVersionRows({ pc, pi, newest }).map(row =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, cut(v)]))
  );
  return {
    pc: { asOf: cut(pc.asOf ?? null), error: cut(pc.error ?? null) },
    pi: { asOf: cut(pi.asOf), error: cut(pi.error) },
    newest: { asOf: cut(newest.asOf), errors: newest.errors },
    foundry: {
      newestStable: cut(newest.foundry.newestStable),
      newestAny: cut(newest.foundry.newestAny),
      newestAnyChannel: cut(newest.foundry.newestAnyChannel),
    },
    rows,
  };
}

// Overlapping calls share one refresh.
export function getVersions({ paths, now = new Date(), deps = {}, force = false } = {}) {
  if (inFlight) return inFlight;
  inFlight = refresh({ paths, now, deps, force }).finally(() => {
    inFlight = null;
  });
  return inFlight;
}
