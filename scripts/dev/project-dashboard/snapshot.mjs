// Builds the dashboard snapshot (README "Snapshot schema") and checks it against the key whitelist.
import fs from 'node:fs/promises';
import path from 'node:path';
import { scanTranscripts } from './transcripts.mjs';
import { readLiveSessions } from './sessions.mjs';
import { buildLanes } from './lanes.mjs';
import { readWatchdog, sessionsDirFrom, watchdogWarning } from './watchdog.mjs';
import {
  loadUsageState,
  saveUsageState,
  updateUsageState,
  usageSummary,
  usageWarning,
} from './usage-log.mjs';

const CACHE_MS = 10000;
const MAX_STRING = 200;
let cache = null;
let inFlight = null; // { key, promise }: concurrent requests share one build
let tmpCounter = 0;

const EMPTY_PRS = () => ({ asOf: null, error: null, items: [], mainRuns: [] });
const EMPTY_PLAN = () => ({ source: null, asOf: null, windows: [] });
const EMPTY_VERSIONS = () => ({
  pc: { asOf: null, error: null },
  pi: { asOf: null, error: null },
  newest: { asOf: null, errors: 0 },
  foundry: { newestStable: null, newestAny: null, newestAnyChannel: null },
  rows: [],
});
const EMPTY_LOCK = () => ({
  state: 'no-script',
  holder: null,
  session: null,
  since: null,
  purpose: null,
  old: false,
  queue: [],
});

function shortText(err) {
  return String(err?.message || err)
    .replace(/\s+/g, ' ')
    .slice(0, 150);
}

async function loadScanState(dataDir) {
  try {
    return JSON.parse(await fs.readFile(path.join(dataDir, 'scan-state.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function writeAtomic(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  tmpCounter += 1;
  const tmp = `${file}.${process.pid}.${tmpCounter}.tmp`;
  await fs.writeFile(tmp, text);
  await fs.rename(tmp, file);
}

function localDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function zeroTokens() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

export function buildUsageDays(messages, now) {
  const days = [];
  const byDate = new Map();
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i, 12);
    const row = { date: localDate(d.getTime()), main: zeroTokens(), sub: zeroTokens() };
    days.push(row);
    byDate.set(row.date, row);
  }
  for (const m of messages.values()) {
    const row = byDate.get(localDate(Date.parse(m.ts)));
    if (!row) continue;
    const t = m.sub ? row.sub : row.main;
    t.input += m.tokens.input;
    t.output += m.tokens.output;
    t.cacheRead += m.tokens.cacheRead;
    t.cacheWrite += m.tokens.cacheWrite;
  }
  return days;
}

async function pick(deps, name, file) {
  if (deps[name]) return deps[name];
  const mod = await import(file);
  return mod[name];
}

export async function buildSnapshot({
  paths,
  now,
  withPrs = false,
  withVersions = false,
  updateUsage = false,
  force = false,
  deps = {},
} = {}) {
  const useCache = !now && Object.keys(deps).length === 0;
  const cacheKey = `${paths.dataDir}|${withPrs}|${withVersions}`;
  if (useCache && !force && cache && cache.key === cacheKey && Date.now() - cache.at < CACHE_MS)
    return cache.snap;
  if (useCache && !force && inFlight && inFlight.key === cacheKey) return inFlight.promise;
  const promise = build({
    paths,
    now,
    withPrs,
    withVersions,
    updateUsage,
    deps,
    useCache,
    cacheKey,
  });
  if (useCache && !force) {
    inFlight = { key: cacheKey, promise };
    promise.then(
      () => {
        if (inFlight?.promise === promise) inFlight = null;
      },
      () => {
        if (inFlight?.promise === promise) inFlight = null;
      }
    );
  }
  return promise;
}

async function build({ paths, now, withPrs, withVersions, updateUsage, deps, useCache, cacheKey }) {
  const at = now || new Date();
  const warnings = [];

  const scanned = await scanTranscripts({
    projectsDir: paths.projectsDir,
    slug: paths.slug,
    state: await loadScanState(paths.dataDir),
    now: at,
  });
  try {
    await writeAtomic(path.join(paths.dataDir, 'scan-state.json'), JSON.stringify(scanned.state));
  } catch (err) {
    warnings.push(`scan state not saved: ${shortText(err)}`);
  }

  const live = readLiveSessions({ sessionsDir: paths.sessionsDir, isAlive: deps.isAlive });
  if (live.formatChanged) warnings.push('sessions format changed');

  let prs = EMPTY_PRS();
  if (withPrs) {
    try {
      const getPrs = await pick(deps, 'getPrs', './gh.mjs');
      prs = await getPrs({ now: at, force: false });
    } catch (err) {
      prs = { ...EMPTY_PRS(), error: shortText(err) };
    }
  }
  let plan = EMPTY_PLAN();
  try {
    plan = await (await pick(deps, 'readPlan', './plan.mjs'))(paths.dataDir, at);
  } catch (err) {
    warnings.push(`plan unavailable: ${shortText(err)}`);
  }
  let lock = EMPTY_LOCK();
  try {
    lock = await (await pick(deps, 'readLock', './lock.mjs'))(paths.testEnvRoot, { now: at });
  } catch (err) {
    warnings.push(`lock unavailable: ${shortText(err)}`);
  }

  const lanes = buildLanes({ transcripts: scanned, live, prs, repoRoot: paths.repoRoot, now: at });

  let versions = EMPTY_VERSIONS();
  if (withVersions) {
    try {
      versions = await (await pick(deps, 'getVersions', './versions.mjs'))({ paths, now: at });
    } catch (err) {
      warnings.push(`versions unavailable: ${shortText(err)}`);
    }
  }

  const watchdog = (deps.readWatchdog || readWatchdog)({
    dir: paths.recordingsDir || sessionsDirFrom(),
    now: at,
  });
  const wdWarning = watchdogWarning(watchdog);
  if (wdWarning) warnings.push(wdWarning);

  const usageState = loadUsageState(paths.dataDir, at);
  if (updateUsage) {
    updateUsageState(usageState, {
      sessions: scanned.sessions,
      lanes,
      plan,
      messages: scanned.messages,
      now: at,
    });
    try {
      saveUsageState(paths.dataDir, usageState);
    } catch (err) {
      warnings.push(`usage rows not saved: ${shortText(err)}`);
    }
  }
  const usageLog = usageSummary(usageState);
  const usWarning = usageWarning(usageLog, at.getTime());
  if (usWarning) warnings.push(usWarning);
  const snap = {
    version: 2,
    generatedAt: at.toISOString(),
    project: { slug: paths.slug, root: paths.repoRoot },
    warnings,
    lanes,
    usage: { days: buildUsageDays(scanned.messages, at) },
    plan,
    lock,
    prs,
    versions,
    watchdog,
    usageLog,
  };
  if (useCache) cache = { key: cacheKey, at: Date.now(), snap };
  return snap;
}

export async function writeSnapshot(dataDir, snap) {
  assertWhitelisted(snap);
  const file = path.join(dataDir, 'snapshot.json');
  await writeAtomic(file, JSON.stringify(snap, null, 2));
  return file;
}

// Allowed keys. 's' = scalar (string/number/boolean/null), [x] = array of x, {..} = object.
const TOKENS = { input: 's', output: 's', cacheRead: 's', cacheWrite: 's' };
const LOCK_ENTRY = { holder: 's', session: 's', since: 's', purpose: 's', old: 's' };
const SCHEMA = {
  version: 's',
  generatedAt: 's',
  project: { slug: 's', root: 's' },
  warnings: ['s'],
  lanes: {
    rows: [
      {
        sessionId: 's',
        hostSessionId: 's',
        title: 's',
        closed: 's',
        state: 's',
        pid: 's',
        lastActivity: 's',
        lastRequest: 's',
        context: 's',
        peak: 's',
        level: 's',
        doNotReuse: 's',
        cacheColdAt: 's',
        cacheMinutesLeft: 's',
        model: 's',
        branch: 's',
        worktree: 's',
        pr: 's',
      },
    ],
    cap: { used: 's', max: 's', steward: 's' },
  },
  usage: { days: [{ date: 's', main: TOKENS, sub: TOKENS }] },
  plan: {
    source: 's',
    asOf: 's',
    windows: [{ kind: 's', label: 's', percentUsed: 's', resetsAt: 's' }],
  },
  lock: { state: 's', ...LOCK_ENTRY, queue: [LOCK_ENTRY] },
  versions: {
    pc: { asOf: 's', error: 's' },
    pi: { asOf: 's', error: 's' },
    newest: { asOf: 's', errors: 's' },
    foundry: { newestStable: 's', newestAny: 's', newestAnyChannel: 's' },
    rows: [
      {
        id: 's',
        kind: 's',
        title: 's',
        pc: 's',
        pi: 's',
        newest: 's',
        minCore: 's',
        status: 's',
      },
    ],
  },
  watchdog: {
    dir: 's',
    state: 's',
    lastPass: 's',
    items: [{ name: 's', state: 's', finishedAt: 's' }],
  },
  usageLog: {
    file: 's',
    since: 's',
    rows: [{ at: 's', title: 's', event: 's', context: 's', peak: 's' }],
    push: { state: 's', detail: 's', at: 's' },
    waitingSince: 's',
    nextPushAt: 's',
  },
  prs: {
    asOf: 's',
    error: 's',
    items: [
      {
        number: 's',
        title: 's',
        state: 's',
        draft: 's',
        branch: 's',
        headSha: 's',
        updatedAt: 's',
        url: 's',
        checks: { pass: 's', fail: 's', pending: 's', failing: ['s'] },
      },
    ],
    mainRuns: [
      { workflow: 's', title: 's', status: 's', conclusion: 's', headSha: 's', createdAt: 's' },
    ],
  },
};

function walk(value, schema, where, problems) {
  if (schema === 's') {
    if (value !== null && typeof value === 'object')
      problems.push(`${where}: expected a plain value`);
    else if (typeof value === 'string' && value.length > MAX_STRING)
      problems.push(`${where}: string over ${MAX_STRING} characters`);
    return;
  }
  if (Array.isArray(schema)) {
    if (!Array.isArray(value)) problems.push(`${where}: expected an array`);
    else value.forEach((v, i) => walk(v, schema[0], `${where}[${i}]`, problems));
    return;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    problems.push(`${where}: expected an object`);
    return;
  }
  for (const [k, v] of Object.entries(value)) {
    if (!(k in schema)) problems.push(`${where}.${k}: key not in the schema`);
    else walk(v, schema[k], `${where}.${k}`, problems);
  }
}

export function assertWhitelisted(snap) {
  const problems = [];
  walk(snap, SCHEMA, 'snapshot', problems);
  if (problems.length) throw new Error(`snapshot breaks the whitelist:\n${problems.join('\n')}`);
  return true;
}
