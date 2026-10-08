// Incremental scan of Claude Code transcripts (~/.claude/projects/<slug>*/**.jsonl).
// Only a fixed set of keys is ever kept (see README "Secrets and campaign text"). Lines that are not
// assistant records or custom titles are never JSON-parsed; only their timestamp is read.
import fs from 'node:fs/promises';
import path from 'node:path';

const KEEP_DAYS = 8;
const CHUNK = 4 * 1024 * 1024;
const TS_KEY = '"timestamp":"';
const STATE_VERSION = 2;

function freshState() {
  return { version: STATE_VERSION, files: {} };
}

function freshAgg(sessionId, folder) {
  return {
    sessionId,
    title: '',
    firstTs: null,
    lastTs: null,
    lastRequestTs: null,
    firstContext: 0,
    context: 0,
    peak: 0,
    model: null,
    cwd: null,
    branch: null,
    folder,
  };
}

function isoOk(s) {
  return typeof s === 'string' && s.length >= 10 && !Number.isNaN(Date.parse(s));
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

function noteTs(agg, ts) {
  if (!isoOk(ts)) return;
  if (!agg.firstTs || ts < agg.firstTs) agg.firstTs = ts;
  if (!agg.lastTs || ts > agg.lastTs) agg.lastTs = ts;
}

function str(v, max = 200) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

// Handle one parsed record; copies only whitelisted keys into the aggregate / message map.
function applyRecord(rec, entry, cutoffMs) {
  if (!rec || typeof rec !== 'object') return;
  const agg = entry.agg;
  noteTs(agg, rec.timestamp);
  if (typeof rec.customTitle === 'string' && rec.customTitle) agg.title = str(rec.customTitle, 300);
  if (rec.type !== 'assistant') return;
  const cwd = str(rec.cwd, 300);
  if (cwd) agg.cwd = cwd;
  const branch = str(rec.gitBranch, 200);
  if (branch) agg.branch = branch;
  const msg = rec.message && typeof rec.message === 'object' ? rec.message : null;
  const u = msg && msg.usage && typeof msg.usage === 'object' ? msg.usage : null;
  if (!u) return;
  const tokens = {
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cacheRead: num(u.cache_read_input_tokens),
    cacheWrite: num(u.cache_creation_input_tokens),
  };
  const sub = entry.kind === 'sub' || rec.isSidechain === true;
  const ts = isoOk(rec.timestamp) ? rec.timestamp : null;
  const model = str(msg.model, 100);
  if (!sub && entry.kind === 'main') {
    const ctx = tokens.input + tokens.cacheRead + tokens.cacheWrite;
    if (ctx > 0) {
      agg.lastRequestTs = ts || agg.lastRequestTs;
      if (!agg.firstContext) agg.firstContext = ctx;
      agg.context = ctx;
      if (ctx > agg.peak) agg.peak = ctx;
      if (model && model !== '<synthetic>') agg.model = model;
    }
  }
  const id = str(msg.id, 100);
  if (id && ts && Date.parse(ts) >= cutoffMs) {
    const prev = entry.msgs[id];
    if (!prev || tokens.output >= prev.tokens.output) entry.msgs[id] = { ts, tokens, sub };
  }
}

function processLine(line, entry, cutoffMs) {
  if (!line) return;
  if (line.includes('"type":"assistant"') || line.includes('"customTitle"')) {
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      return;
    }
    applyRecord(rec, entry, cutoffMs);
    return;
  }
  // The record's own timestamp comes first; nested content (toolUseResult) follows it.
  const at = line.indexOf(TS_KEY);
  if (at === -1) return;
  const start = at + TS_KEY.length;
  const end = line.indexOf('"', start);
  if (end > start) noteTs(entry.agg, line.slice(start, end));
}

// Read [offset, size) in chunks, call onLine for each complete line; returns the new offset.
async function readNew(file, offset, size, onLine) {
  const fh = await fs.open(file, 'r');
  try {
    let pos = offset;
    let consumed = offset;
    let carry = Buffer.alloc(0);
    while (pos < size) {
      const len = Math.min(CHUNK, size - pos);
      const buf = Buffer.allocUnsafe(len);
      const { bytesRead } = await fh.read(buf, 0, len, pos);
      if (bytesRead <= 0) break;
      pos += bytesRead;
      let data = carry.length
        ? Buffer.concat([carry, buf.subarray(0, bytesRead)])
        : buf.subarray(0, bytesRead);
      let start = 0;
      let nl;
      while ((nl = data.indexOf(0x0a, start)) !== -1) {
        onLine(data.toString('utf8', start, nl).replace(/\r$/, ''));
        consumed += nl + 1 - start;
        start = nl + 1;
      }
      carry = Buffer.from(data.subarray(start));
    }
    return consumed;
  } finally {
    await fh.close();
  }
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function listDir(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function scanFile(file, kind, sessionId, folder, state, nextFiles, cutoffMs, extra) {
  let st;
  try {
    st = await fs.stat(file);
  } catch {
    return;
  }
  let entry = state.files[file];
  if (!entry || st.size < entry.offset || entry.kind !== kind) {
    entry = { size: 0, offset: 0, kind, agg: freshAgg(sessionId, folder), msgs: {} };
  }
  entry.agg.folder = folder;
  entry.agg.sessionId = sessionId;
  if (st.size > entry.offset) {
    entry.offset = await readNew(file, entry.offset, st.size, line =>
      processLine(line, entry, cutoffMs)
    );
  }
  entry.size = st.size;
  if (extra && extra.model) entry.model = extra.model;
  for (const [id, m] of Object.entries(entry.msgs)) {
    if (Date.parse(m.ts) < cutoffMs) delete entry.msgs[id];
  }
  nextFiles[file] = entry;
}

export async function scanTranscripts({ projectsDir, slug, state, now = new Date() }) {
  const prev = state && state.version === STATE_VERSION && state.files ? state : freshState();
  const cutoffMs = now.getTime() - KEEP_DAYS * 86400000;
  const nextFiles = {};
  const folders = (await listDir(projectsDir)).filter(
    // The main checkout and its worktrees; a sibling folder ("<project>-Backup") is another project.
    d => d.isDirectory() && (d.name === slug || d.name.startsWith(slug + '--claude-worktrees-'))
  );
  for (const folder of folders) {
    const dir = path.join(projectsDir, folder.name);
    for (const f of await listDir(dir)) {
      if (f.isFile() && f.name.endsWith('.jsonl')) {
        const sessionId = f.name.slice(0, -'.jsonl'.length);
        await scanFile(
          path.join(dir, f.name),
          'main',
          sessionId,
          folder.name,
          prev,
          nextFiles,
          cutoffMs
        );
      } else if (f.isDirectory()) {
        const subDir = path.join(dir, f.name, 'subagents');
        for (const s of await listDir(subDir)) {
          if (!s.isFile() || !s.name.endsWith('.jsonl')) continue;
          const meta = await readJson(
            path.join(subDir, s.name.slice(0, -'.jsonl'.length) + '.meta.json')
          );
          const model = meta && typeof meta.model === 'string' ? meta.model.slice(0, 100) : null;
          await scanFile(
            path.join(subDir, s.name),
            'sub',
            f.name,
            folder.name,
            prev,
            nextFiles,
            cutoffMs,
            { model }
          );
        }
      }
    }
  }
  const nextState = { version: STATE_VERSION, files: nextFiles };

  const sessions = [];
  const messages = new Map();
  // The newest subagent record per session: a lane whose subagent works is not idle.
  const subLast = new Map();
  for (const entry of Object.values(nextFiles)) {
    if (entry.kind !== 'sub' || !entry.agg.lastTs) continue;
    const have = subLast.get(entry.agg.sessionId);
    if (!have || entry.agg.lastTs > have) subLast.set(entry.agg.sessionId, entry.agg.lastTs);
  }
  for (const [file, entry] of Object.entries(nextFiles)) {
    for (const [id, m] of Object.entries(entry.msgs)) {
      const have = messages.get(id);
      if (!have || m.tokens.output > have.tokens.output)
        messages.set(id, { ts: m.ts, tokens: m.tokens, sub: m.sub });
    }
    if (entry.kind !== 'main') continue;
    const agg = { ...entry.agg, subLastTs: subLast.get(entry.agg.sessionId) || null };
    if (!agg.title) {
      const dir = path.dirname(file);
      const t = await readJson(path.join(dir, agg.sessionId, 'custom-title.json'));
      if (t && typeof t.customTitle === 'string') agg.title = t.customTitle.slice(0, 300);
    }
    sessions.push(agg);
  }
  return { sessions, messages, state: nextState };
}
