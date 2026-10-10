// Lane rows: one per Claude Code session of this project, with state, alarm level and cache countdown.
const HOUR = 60 * 60 * 1000;
const AMBER = 200000;
const RED = 250000;
const REUSE_LIMIT = 150000;
const MAX_LANES = 3;
// A session file that says busy with no activity for this long is not trusted: after a crash,
// Windows may give the dead session's pid to another process, which would keep it busy forever.
const BUSY_STALE_MS = 30 * 60 * 1000;

function toMs(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function iso(ms) {
  return ms == null ? null : new Date(ms).toISOString();
}

function norm(p) {
  return String(p || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function underRoot(cwd, root) {
  const c = norm(cwd);
  const r = norm(root);
  return Boolean(c) && Boolean(r) && (c === r || c.startsWith(r + '/'));
}

function worktreeOf(cwd) {
  const m = /[\\/]\.claude[\\/]worktrees[\\/]([^\\/]+)/.exec(cwd || '');
  return m ? m[1] : null;
}

function cut(s, n = 120) {
  const t = String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

// Prefer a live process that is alive, then the most recently updated one.
function pickLive(list) {
  return [...list].sort(
    (a, b) =>
      Number(b.alive) - Number(a.alive) || (toMs(b.updatedAt) || 0) - (toMs(a.updatedAt) || 0)
  )[0];
}

export function buildLanes({ transcripts, live, prs, repoRoot, now = new Date(), days = 3 }) {
  const nowMs = now.getTime();
  const sessions = transcripts?.sessions || transcripts || [];
  const liveList = live?.sessions || live || [];
  const prItems = prs?.items || [];

  const liveById = new Map();
  for (const l of liveList) {
    if (!l.sessionId) continue;
    const arr = liveById.get(l.sessionId) || [];
    arr.push(l);
    liveById.set(l.sessionId, arr);
  }
  const aggById = new Map(sessions.map(a => [a.sessionId, a]));

  const ids = new Set();
  for (const a of sessions) {
    const ls = liveById.get(a.sessionId);
    const lv = ls ? pickLive(ls) : null;
    const lastMs = Math.max(
      toMs(a.lastTs) || 0,
      toMs(a.subLastTs) || 0,
      lv ? toMs(lv.updatedAt) || 0 : 0
    );
    if (lv?.alive || nowMs - lastMs <= days * 86400000) ids.add(a.sessionId);
  }
  for (const [id, ls] of liveById) {
    if (aggById.has(id)) continue;
    const lv = pickLive(ls);
    if (lv.alive && underRoot(lv.cwd, repoRoot)) ids.add(id);
  }

  const rows = [];
  for (const id of ids) {
    const agg = aggById.get(id) || null;
    const ls = liveById.get(id);
    const lv = ls ? pickLive(ls) : null;
    const lastMs = Math.max(
      toMs(agg?.lastTs) || 0,
      toMs(agg?.subLastTs) || 0,
      lv ? toMs(lv.updatedAt) || 0 : 0,
      agg || !lv ? 0 : toMs(lv.startedAt) || 0
    );
    const idleMs = Math.max(0, nowMs - lastMs);
    const alive = Boolean(lv?.alive);
    const title = cut(lv?.name || agg?.title || '(untitled)');
    const context = agg?.context || 0;
    const state =
      alive && lv.status === 'busy' && idleMs < BUSY_STALE_MS
        ? 'busy'
        : alive && idleMs < HOUR
          ? 'waiting'
          : 'stale';
    const lastReqMs = toMs(agg?.lastRequestTs);
    let cacheColdAt = null;
    let cacheMinutesLeft = null;
    if (state === 'waiting' && lastReqMs != null) {
      cacheColdAt = iso(lastReqMs + HOUR);
      cacheMinutesLeft = Math.max(0, Math.floor((lastReqMs + HOUR - nowMs) / 60000));
    }
    const cwd = agg?.cwd || lv?.cwd || null;
    const branch = agg?.branch || null;
    const pr = branch
      ? prItems.find(p => p.branch === branch && String(p.state || '').toUpperCase() === 'OPEN')
      : null;
    rows.push({
      sessionId: id,
      hostSessionId: lv?.hostSessionId || null,
      title,
      closed: title.startsWith('CLOSED'),
      state,
      pid: alive ? lv.pid : null,
      lastActivity: iso(lastMs || nowMs),
      lastRequest: iso(lastReqMs),
      context,
      peak: agg?.peak || 0,
      level: context >= RED ? 'red' : context >= AMBER ? 'amber' : 'ok',
      doNotReuse: idleMs >= HOUR && context > REUSE_LIMIT,
      cacheColdAt,
      cacheMinutesLeft,
      model: agg?.model || null,
      branch,
      worktree: worktreeOf(cwd),
      pr: pr ? pr.number : null,
    });
  }
  rows.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));

  const used = rows.filter(r => !r.closed && nowMs - Date.parse(r.lastActivity) <= HOUR).length;
  return { rows, cap: { used, max: MAX_LANES } };
}
