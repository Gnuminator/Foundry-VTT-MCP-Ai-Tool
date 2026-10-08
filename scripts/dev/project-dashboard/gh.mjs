// PRs and CI through the gh CLI (read-only). Cached for 60 s; a failed call keeps the last good data.
//
//   getPrs({ now, force, run }) -> { asOf, error, items: [PrItem], mainRuns: [RunItem] }
//
// `run(file, args)` returns the stdout text (a promise); the default runs gh without a shell.
import { execFile } from 'node:child_process';

const REPO = 'Gnuminator/Foundry-VTT-MCP-Ai-Tool';
const CACHE_MS = 60_000;
const TIMEOUT_MS = 20_000;

const PR_ARGS = [
  'pr',
  'list',
  '--repo',
  REPO,
  '--state',
  'all',
  '--limit',
  '20',
  '--json',
  'number,title,state,isDraft,headRefName,headRefOid,updatedAt,url,statusCheckRollup',
];
const RUN_ARGS = [
  'run',
  'list',
  '--repo',
  REPO,
  '--branch',
  'main',
  '--limit',
  '5',
  '--json',
  'workflowName,displayTitle,status,conclusion,headSha,createdAt',
];

const PASS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const FAIL = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'ERROR']);

function str(v, max) {
  if (typeof v !== 'string') return '';
  return v.length > max ? v.slice(0, max) : v;
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function asArray(json) {
  let data = json;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return [];
    }
  }
  return Array.isArray(data) ? data : [];
}

// One statusCheckRollup entry: 'pass' | 'fail' | 'pending', and its name.
function classifyCheck(entry) {
  if (!entry || typeof entry !== 'object') return { kind: 'pending', name: '' };
  const name = str(entry.name, 60) || str(entry.context, 60) || str(entry.workflowName, 60);
  const isRun =
    typeof entry.status === 'string' ||
    typeof entry.conclusion === 'string' ||
    entry.__typename === 'CheckRun';
  let value;
  if (isRun && typeof entry.state !== 'string') {
    // CheckRun: only a completed run has a conclusion that counts.
    if (typeof entry.status === 'string' && entry.status.toUpperCase() !== 'COMPLETED')
      return { kind: 'pending', name };
    value = typeof entry.conclusion === 'string' ? entry.conclusion.toUpperCase() : '';
  } else {
    // StatusContext: state is SUCCESS, FAILURE, ERROR, PENDING or EXPECTED.
    value = typeof entry.state === 'string' ? entry.state.toUpperCase() : '';
  }
  if (PASS.has(value)) return { kind: 'pass', name };
  if (FAIL.has(value)) return { kind: 'fail', name };
  return { kind: 'pending', name };
}

function summarizeChecks(rollup) {
  const checks = { pass: 0, fail: 0, pending: 0, failing: [] };
  for (const entry of Array.isArray(rollup) ? rollup : []) {
    const { kind, name } = classifyCheck(entry);
    checks[kind] += 1;
    if (kind === 'fail' && checks.failing.length < 5) checks.failing.push(name);
  }
  return checks;
}

function byUpdatedDesc(a, b) {
  return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;
}

export function parsePrList(json) {
  const items = [];
  for (const pr of asArray(json)) {
    if (!pr || typeof pr !== 'object') continue;
    items.push({
      number: num(pr.number),
      title: str(pr.title, 120),
      state: str(pr.state, 20),
      draft: pr.isDraft === true,
      branch: str(pr.headRefName, 120),
      headSha: str(pr.headRefOid, 40),
      updatedAt: str(pr.updatedAt, 40),
      url: str(pr.url, 200),
      checks: summarizeChecks(pr.statusCheckRollup),
    });
  }
  const rank = p => (p.state === 'OPEN' ? (p.checks.fail > 0 ? 0 : 1) : 2);
  return items.sort((a, b) => rank(a) - rank(b) || byUpdatedDesc(a, b));
}

export function parseRunList(json) {
  const runs = [];
  for (const r of asArray(json)) {
    if (!r || typeof r !== 'object') continue;
    runs.push({
      workflow: str(r.workflowName, 80),
      title: str(r.displayTitle, 120),
      status: str(r.status, 30),
      conclusion: str(r.conclusion, 30),
      headSha: str(r.headSha, 40),
      createdAt: str(r.createdAt, 40),
    });
  }
  return runs;
}

function defaultRun(file, args) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
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
  if (err && err.code === 'ENOENT') return 'gh not found on PATH';
  if (err && err.killed) return 'gh timed out after 20 s';
  const raw = (err && (err.stderr || err.message)) || 'gh failed';
  const line =
    String(raw)
      .split(/\r?\n/)
      .find(l => l.trim()) || 'gh failed';
  const text = line.trim();
  return text.length > 150 ? `${text.slice(0, 147)}...` : text;
}

let cache = null; // { at: ms, data }
let lastGood = { items: null, mainRuns: null, asOf: null };

export function resetPrCache() {
  cache = null;
  lastGood = { items: null, mainRuns: null, asOf: null };
}

export async function getPrs({ now = new Date(), force = false, run = defaultRun } = {}) {
  const nowMs = now.getTime();
  if (!force && cache && nowMs - cache.at < CACHE_MS && nowMs >= cache.at) return cache.data;

  const [prResult, runResult] = await Promise.allSettled([run('gh', PR_ARGS), run('gh', RUN_ARGS)]);
  let error = null;

  if (prResult.status === 'fulfilled') {
    lastGood.items = parsePrList(prResult.value);
  } else {
    error = shortError(prResult.reason);
  }
  if (runResult.status === 'fulfilled') {
    lastGood.mainRuns = parseRunList(runResult.value);
  } else if (!error) {
    error = shortError(runResult.reason);
  }
  if (!error) lastGood.asOf = now.toISOString();

  const data = {
    asOf: lastGood.asOf,
    error,
    items: lastGood.items ?? [],
    mainRuns: lastGood.mainRuns ?? [],
  };
  // A failed call is not cached as fresh, so the next poll tries again.
  if (!error) cache = { at: nowMs, data };
  return data;
}
