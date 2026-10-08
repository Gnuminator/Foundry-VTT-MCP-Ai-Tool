// Plan gauges (5-hour, weekly, per-model weekly) from the two files in the data folder:
//   plan.json            written by our plan meter plugin after every turn
//   get-usage-plan.json  the `plan` object of Claude's get_usage tool, saved by hand
//
//   readPlan(dataDir, now) -> { source: 'plugin'|'get_usage'|null, asOf, windows: [{ kind, label, percentUsed, resetsAt }] }
//
// Only numbers and short strings are kept; everything else in the files is ignored.
import fs from 'node:fs';
import path from 'node:path';

const LABELS = { five_hour: '5-hour', seven_day: 'Weekly (all models)' };
const ORDER = ['five_hour', 'seven_day'];

function readJson(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function mtimeMs(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

function percent(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// ISO text, or epoch seconds / milliseconds turned into ISO text; null when it is neither.
function resetTime(v) {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v))) return v;
  return null;
}

function timeMs(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function label(text) {
  return typeof text === 'string' ? text.trim().slice(0, 60) : '';
}

function fromPlugin(plugin) {
  const out = [];
  const limits = Array.isArray(plugin?.rateLimits) ? plugin.rateLimits : [];
  for (const limit of limits) {
    if (!limit || typeof limit !== 'object') continue;
    const kind = limit.kind;
    if (kind !== 'five_hour' && kind !== 'seven_day') continue;
    const p = percent(limit.percentUsed);
    if (p === null) continue;
    out.push({ kind, label: LABELS[kind], percentUsed: p, resetsAt: resetTime(limit.resetsAt) });
  }
  return out;
}

function fromGetUsage(plan) {
  const out = [];
  const list = Array.isArray(plan?.windows)
    ? plan.windows
    : Array.isArray(plan?.plan?.windows)
      ? plan.plan.windows
      : [];
  for (const w of list) {
    if (!w || typeof w !== 'object') continue;
    const text = label(w.label);
    const p = percent(w.percentUsed);
    if (!text || p === null) continue;
    const resetsAt = resetTime(w.resetsAt);
    if (/^5[- ]?hour/i.test(text)) {
      out.push({ kind: 'five_hour', label: LABELS.five_hour, percentUsed: p, resetsAt });
    } else if (/^weekly\s*[·:\-]\s*all\b/i.test(text)) {
      out.push({ kind: 'seven_day', label: LABELS.seven_day, percentUsed: p, resetsAt });
    } else if (/^weekly/i.test(text)) {
      out.push({ kind: 'weekly_model', label: text, percentUsed: p, resetsAt });
    }
  }
  return out;
}

export function readPlan(dataDir, now = new Date()) {
  void now;
  const pluginFile = path.join(dataDir, 'plan.json');
  const usageFile = path.join(dataDir, 'get-usage-plan.json');
  const plugin = readJson(pluginFile);
  const usage = readJson(usageFile);
  const pluginWindows = plugin ? fromPlugin(plugin) : [];
  const usageWindows = usage ? fromGetUsage(usage) : [];
  const usageMs = usage ? mtimeMs(usageFile) : null;
  const pluginMs = plugin ? timeMs(plugin.at) : null;

  const havePlugin = pluginWindows.length > 0 && pluginMs !== null;
  const haveUsage = usageWindows.length > 0 && usageMs !== null;
  if (!havePlugin && !haveUsage) return { source: null, asOf: null, windows: [] };

  const pluginWins = havePlugin && (!haveUsage || pluginMs > usageMs);
  const primary = pluginWins ? pluginWindows : usageWindows;
  const secondary = pluginWins ? usageWindows : pluginWindows;

  const byKind = new Map();
  for (const w of primary)
    if (w.kind !== 'weekly_model' && !byKind.has(w.kind)) byKind.set(w.kind, w);
  // A kind the newer source does not have is filled in from the older one.
  for (const w of secondary)
    if (w.kind !== 'weekly_model' && !byKind.has(w.kind)) byKind.set(w.kind, w);

  const windows = ORDER.filter(k => byKind.has(k)).map(k => byKind.get(k));
  // Per-model weekly meters (Fable) only exist in get_usage.
  for (const w of usageWindows) if (w.kind === 'weekly_model') windows.push(w);

  const asOfMs = pluginWins ? pluginMs : usageMs;
  return {
    source: pluginWins ? 'plugin' : 'get_usage',
    asOf: new Date(asOfMs).toISOString(),
    windows,
  };
}
