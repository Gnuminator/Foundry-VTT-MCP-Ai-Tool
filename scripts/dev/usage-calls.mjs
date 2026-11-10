#!/usr/bin/env node
// `npm run usage:calls` (D-126, I-113): counts MCP tool calls from the tool call log.
//
//   node scripts/dev/usage-calls.mjs [--days N] [--json] [--line] [--dir <folder>] [--pi]
//
// Source: <dataDir>/_usage/<date>.calls.jsonl, one line per call written by the MCP server
// (packages/mcp-server/src/tool-call-log.ts): time, tool, set, ms, size, ok. No arguments.
// Prints calls per tool set, calls per tool (errors, median and p95 ms, largest result) and the
// slowest calls, then the tools in the tool sets that were never called in the window.
// --line prints the one weekly line (tools used, never used, error rate) that `usage:week` also
// shows. --pi reads the Pi's _usage folder over ssh (read-only: one fixed `cat` loop, nothing is
// changed). The logs sit on the machine that runs the MCP server for the client (the PC for
// Claude Desktop and Claude Code), so the Pi folder only exists if a client runs on the Pi.
// Overrides: FOUNDRY_AI_DATA_DIR (as the server), --dir (the _usage folder itself).

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function dataDir(env = process.env) {
  const explicit = env.FOUNDRY_AI_DATA_DIR?.trim();
  if (explicit) return path.resolve(explicit);
  if (process.platform === 'win32') {
    const appData = env.APPDATA?.trim() || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'foundry-ai-tool', 'vault');
  }
  const xdg = env.XDG_DATA_HOME?.trim();
  const base = xdg && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'foundry-ai-tool', 'vault');
}

/**
 * The tools of every tool set, { set: [tool, ...] }, from the built server
 * (packages/mcp-server/dist/tool-sets.js); null when the server is not built.
 */
export async function loadCatalog(root = path.resolve(import.meta.dirname, '..', '..')) {
  try {
    const file = path.join(root, 'packages', 'mcp-server', 'dist', 'tool-sets.js');
    const { TOOL_SETS } = await import(pathToFileURL(file).href);
    return Object.fromEntries(Object.entries(TOOL_SETS).map(([set, spec]) => [set, spec.tools]));
  } catch {
    return null;
  }
}

const pad2 = n => String(n).padStart(2, '0');
const dayKey = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const PI_USAGE_DIR = '/var/lib/foundry-ai-tool/vault/_usage';

/** Parse call lines (one JSON object per line); a torn or foreign line is skipped. */
export function parseCallLines(text) {
  const calls = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const c = JSON.parse(line);
      if (c && typeof c.tool === 'string') calls.push(c);
    } catch {
      // a torn last line is skipped
    }
  }
  return calls;
}

/** First day key of a window of `days` calendar days ending today ('' = all days). */
function firstDayOf(days, now) {
  // Calendar days, so a daylight-saving change never shifts the window by a day.
  return days > 0
    ? dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)))
    : '';
}

/** Parse the call lines of the day files in the last `days` days (0 = all). */
export function readCalls(dir, days = 7, now = new Date()) {
  if (!existsSync(dir)) return [];
  const first = firstDayOf(days, now);
  const calls = [];
  for (const file of readdirSync(dir).sort()) {
    const m = /^(\d{4}-\d{2}-\d{2})\.calls\.jsonl$/.exec(file);
    if (!m || m[1] < first) continue;
    calls.push(...parseCallLines(readFileSync(path.join(dir, file), 'utf8')));
  }
  return calls;
}

/** Split the output of the Pi `cat` loop (`#FILE <name>` header, then the file) by day window. */
export function parsePiOutput(text, days = 7, now = new Date()) {
  const first = firstDayOf(days, now);
  const calls = [];
  let keep = false;
  for (const line of text.split('\n')) {
    const m = /^#FILE (\d{4}-\d{2}-\d{2})\.calls\.jsonl$/.exec(line);
    if (m) keep = m[1] >= first;
    else if (keep) calls.push(...parseCallLines(line));
  }
  return calls;
}

/**
 * The same from the Pi, read-only: a fixed `cat` loop over ssh, no input from outside. [] when
 * the folder is missing; throws when ssh fails.
 */
export function readCallsPi(days = 7, now = new Date(), host = 'foundry-pi') {
  const remote = `cd ${PI_USAGE_DIR} 2>/dev/null && for f in *.calls.jsonl; do [ -e "$f" ] && echo "#FILE $f" && cat "$f"; done; true`;
  const text = execFileSync(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host, remote],
    { encoding: 'utf8', timeout: 30000 }
  );
  return parsePiOutput(text, days, now);
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/** Tools in the catalog that no call in the window names: [{ tool, set }, ...]. */
export function neverCalled(calls, catalog) {
  if (!catalog) return null;
  const called = new Set(calls.map(c => c.tool));
  return Object.entries(catalog).flatMap(([set, tools]) =>
    tools.filter(tool => !called.has(tool)).map(tool => ({ tool, set }))
  );
}

export function summarize(calls, catalog = null) {
  const perTool = new Map();
  const perSet = new Map();
  for (const c of calls) {
    const t = perTool.get(c.tool) ?? {
      tool: c.tool,
      set: c.set ?? 'unknown',
      calls: 0,
      errors: 0,
      ms: [],
      maxSize: 0,
    };
    t.calls++;
    if (c.ok === false) t.errors++;
    t.ms.push(Number(c.ms) || 0);
    t.maxSize = Math.max(t.maxSize, Number(c.size) || 0);
    perTool.set(c.tool, t);
    const s = perSet.get(c.set ?? 'unknown') ?? { set: c.set ?? 'unknown', calls: 0, errors: 0 };
    s.calls++;
    if (c.ok === false) s.errors++;
    perSet.set(c.set ?? 'unknown', s);
  }
  const tools = [...perTool.values()]
    .map(t => {
      const sorted = [...t.ms].sort((a, b) => a - b);
      return {
        tool: t.tool,
        set: t.set,
        calls: t.calls,
        errors: t.errors,
        medianMs: quantile(sorted, 0.5),
        p95Ms: quantile(sorted, 0.95),
        maxSize: t.maxSize,
      };
    })
    .sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool));
  const sets = [...perSet.values()].sort((a, b) => b.calls - a.calls);
  const slowest = [...calls]
    .sort((a, b) => (Number(b.ms) || 0) - (Number(a.ms) || 0))
    .slice(0, 5)
    .map(c => ({ t: c.t, tool: c.tool, ms: c.ms, ok: c.ok }));
  return {
    total: calls.length,
    errors: calls.filter(c => c.ok === false).length,
    sets,
    tools,
    slowest,
    never: neverCalled(calls, catalog),
  };
}

/**
 * The weekly line: tools used (of the catalog), never used, error rate, worst tools. summary.never
 * is null when the server is not built; then "of N" and "never used" are left out.
 */
export function weekLine(summary, days = 7) {
  const label = `Tool calls, last ${days || 'all'} days`;
  if (!summary.total) return `${label}: none logged.`;
  const used = summary.tools.length;
  const rate = ((100 * summary.errors) / summary.total).toFixed(1);
  const parts = [`${label}: ${summary.total} calls, ${used} tools used`];
  if (summary.never) {
    parts[0] += ` of ${used + summary.never.length}`;
    parts.push(`${summary.never.length} never used`);
  }
  parts.push(`${summary.errors} errors (${rate}%)`);
  const bad = summary.tools
    .filter(t => t.errors > 0)
    .sort((a, b) => b.errors / b.calls - a.errors / a.calls || b.errors - a.errors)
    .slice(0, 3)
    .map(t => `${t.tool} ${t.errors}/${t.calls}`);
  if (bad.length) parts.push(`most errors: ${bad.join(', ')}`);
  return `${parts.join('; ')}.`;
}

export function render(summary, days) {
  if (!summary.total) return `No tool calls logged in the last ${days || 'all'} days.\n`;
  const out = [
    `Tool calls, last ${days || 'all'} days: ${summary.total} (${summary.errors} errors)`,
    '',
    'Per set:',
  ];
  for (const s of summary.sets)
    out.push(`  ${s.set.padEnd(8)} ${String(s.calls).padStart(5)} calls  ${s.errors} errors`);
  out.push(
    '',
    'Per tool:',
    `  ${'tool'.padEnd(34)} ${'set'.padEnd(8)} calls  err  median   p95  max chars`
  );
  for (const t of summary.tools) {
    out.push(
      `  ${t.tool.padEnd(34)} ${t.set.padEnd(8)} ${String(t.calls).padStart(5)} ${String(t.errors).padStart(4)} ${String(t.medianMs).padStart(6)} ${String(t.p95Ms).padStart(5)} ${String(t.maxSize).padStart(10)}`
    );
  }
  out.push('', 'Slowest calls:');
  for (const c of summary.slowest)
    out.push(`  ${c.ms} ms  ${c.tool}  ${c.t}${c.ok === false ? '  (error)' : ''}`);
  if (summary.never === null) {
    out.push('', 'Never called: unknown (build the server first: npm run build).');
  } else {
    out.push('', `Never called in the window (${summary.never.length}):`);
    for (const n of summary.never) out.push(`  ${n.set.padEnd(8)} ${n.tool}`);
  }
  return out.join('\n') + '\n';
}

async function main(argv) {
  const arg = name => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const days = arg('--days') !== undefined ? Number(arg('--days')) : 7;
  if (!Number.isInteger(days) || days < 0) {
    process.stderr.write('usage:calls: --days needs a whole number (0 = all days).\n');
    process.exit(2);
  }
  const dir = arg('--dir') ?? path.join(dataDir(), '_usage');
  let calls;
  if (argv.includes('--pi')) {
    try {
      calls = readCallsPi(days);
    } catch (e) {
      const why = String(e.message).split('\n')[0];
      process.stderr.write(`usage:calls: could not read the Pi over ssh (${why}).\n`);
      process.exit(1);
    }
  } else calls = readCalls(dir, days);
  const summary = summarize(calls, await loadCatalog());
  if (argv.includes('--line')) process.stdout.write(`${weekLine(summary, days)}\n`);
  else
    process.stdout.write(
      argv.includes('--json') ? JSON.stringify(summary, null, 2) + '\n' : render(summary, days)
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main(process.argv.slice(2));
