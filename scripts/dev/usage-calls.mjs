#!/usr/bin/env node
// `npm run usage:calls` (D-126, I-113): counts MCP tool calls from the tool call log.
//
//   node scripts/dev/usage-calls.mjs [--days N] [--json] [--dir <folder>]
//
// Source: <dataDir>/_usage/<date>.calls.jsonl, one line per call written by the MCP server
// (packages/mcp-server/src/tool-call-log.ts): time, tool, set, ms, size, ok. No arguments.
// Prints calls per tool set, calls per tool (errors, median and p95 ms, largest result) and the
// slowest calls, then the tools in the tool sets that were never called in the window.
// Overrides: FOUNDRY_AI_DATA_DIR (as the server), --dir (the _usage folder itself).

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

/** Parse the call lines of the day files in the last `days` days (0 = all). */
export function readCalls(dir, days = 7, now = new Date()) {
  if (!existsSync(dir)) return [];
  // Calendar days, so a daylight-saving change never shifts the window by a day.
  const first =
    days > 0 ? dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1))) : '';
  const calls = [];
  for (const file of readdirSync(dir).sort()) {
    const m = /^(\d{4}-\d{2}-\d{2})\.calls\.jsonl$/.exec(file);
    if (!m || m[1] < first) continue;
    for (const line of readFileSync(path.join(dir, file), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const c = JSON.parse(line);
        if (typeof c.tool === 'string') calls.push(c);
      } catch {
        // a torn last line is skipped
      }
    }
  }
  return calls;
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
  const summary = summarize(readCalls(dir, days), await loadCatalog());
  process.stdout.write(
    argv.includes('--json') ? JSON.stringify(summary, null, 2) + '\n' : render(summary, days)
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main(process.argv.slice(2));
