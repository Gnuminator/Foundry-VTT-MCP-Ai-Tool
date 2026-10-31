// Bundle budget for the React dashboard (UI-05): fails the build when the JavaScript a first visit
// downloads, or any lazy chunk, grows past its limit. Reads the build in dist/web:
//
//   - first-load JS: the entry script and every modulepreload link in dist/web/index.html
//   - lazy chunks: every other .js in dist/web/assets (loaded on demand)
//
// Sizes are gzip (zlib, level 9) and raw bytes; 1 KB = 1000 bytes, as Vite prints them. Source
// maps are ignored. Prints a table, and writes it to $GITHUB_STEP_SUMMARY when that is set.
//
//   npm run build -w @gnuminator/cogm-dashboard && npm run bundle:budget -w @gnuminator/cogm-dashboard
//
// To raise a limit on purpose, change the constant below in the same PR and say why in the PR. A
// raise must leave at least 2 KB of headroom on the first load, or the PR makes something lazy
// instead: a limit set to measured plus 1 KB is overflowed by the next two PRs that each fit alone
// (main was red for 11.5 hours on 2026-10-30). Under 2 KB of headroom the script prints a GitHub
// warning annotation; it never fails the build for that.
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

/**
 * Limits in KB of gzip. Measured 2026-10-10 on the build of that day: today's gzip size plus 10
 * percent, rounded up to the next KB.
 */
// 143 on 2026-10-16, a ratchet and not the 10 percent rule: the panels Tools, Tarokka, Prep, Party,
// Handouts, Player links and Module diagnostics moved to their own chunks (App.tsx, LazyPanel) and
// the first load measured 140.2 KB (entry plus the shared ui chunk; it was 150.5 KB in one entry
// chunk, 136.2 KB on 2026-10-10). A new panel starts as a lazy chunk, not in the entry.
// 144 on 2026-10-23: the After a paper night menu item and chunk reference (paper-form) took the
// first load to 143.3 KB; the panel itself is the lazy PaperSync chunk.
// 145 on 2026-10-24: the During bar's focus handling for the Start combat picker (about 0.5 KB)
// took the first load to 144.0 KB.
// 146 on 2026-10-28: reading the token image and uuid of each combatant (lib/combat.ts, which every
// fight passes through, so it cannot be lazy) took the first load to 145.1 KB; the portrait and
// pan code itself is in the lazy InitiativeRibbon chunk.
// 147 on 2026-10-30: the "Turn on for tonight" button on a refusal toast (lib/guarded.ts, which
// every guarded change passes through, so it cannot be lazy) took the first load to 146.4 KB.
// 148 on 2026-10-30: the Use Foundry targets wiring in the combat strip and the usage catalog entry
// for the picker button, on top of the toast button, took the first load to 147.2 KB; the button
// itself is the lazy FoundryTargetsButton chunk.
// 150 on 2026-10-30: the one live switch (livePlay, liveSwitches, TurnOnNote, During and
// GmActionsSwitch wiring, which the entry carries) took the first load to 149.2 KB; main alone was
// 147.3 KB. Handouts went 3.0 to 3.1 KB with the switch note, so its limit is 4.
// 150 kept on 2026-10-31 (the build had reached 150.0 KB): the Pre-flight drawer (PreflightDrawer)
// moved to its own chunk and the first load measured 147.8 KB. Not raised.
// 150 kept on 2026-10-31 (after the live screens): the Advanced menu's Radix dropdown (AdvancedMenuImpl,
// behind a stand-in button) and the combat strip (CombatStrip) moved to their own chunks; the
// first load measured 144.6 KB, 5.4 KB of headroom. Not raised.
export const FIRST_LOAD_LIMIT_KB = 150;

/**
 * Lazy chunks by name stem (the file name without its hash and extension: `Tarokka-Cx9aB1zQ.js`
 * is `Tarokka`). Add `Stem: limitKB` when a split is made, measured the same way (size plus 10
 * percent, rounded up). Measured 2026-10-16.
 */
export const LAZY_LIMITS_KB = {
  AdvancedMenuImpl: 7, // 5.7 KB, measured 2026-10-31
  CombatStrip: 5, // 3.8 KB, measured 2026-10-31
  Handouts: 4, // 3.1 KB with the live-switch note, measured 2026-10-30 (was 2.2 KB)
  InitiativeRibbon: 2, // 1.8 KB with portraits and the pan click (was 1.6 KB), measured 2026-10-28
  ModuleDiagnostics: 1, // 0.8 KB
  PaperSync: 6, // 5.1 KB, measured 2026-10-23
  Party: 4, // 3.0 KB
  PlayerLinks: 2, // 1.2 KB
  PreflightDrawer: 4, // 3.3 KB, measured 2026-10-31
  Prep: 4, // 3.2 KB
  RecentChanges: 7, // 5.6 KB, measured 2026-10-17
  Tarokka: 4, // 2.8 KB
  Tools: 8, // 6.8 KB
};

/** A lazy chunk whose stem is not listed above gets this: a new split is fine, a big one is not. */
export const DEFAULT_LAZY_LIMIT_KB = 40;

const KB = 1000;

/** A limit with less room than this (in KB of gzip) gets a warning annotation. */
export const MIN_HEADROOM_KB = 2;

/**
 * Rows that fit but have little room left: the first load under MIN_HEADROOM_KB, a lazy chunk under
 * MIN_HEADROOM_KB and under 5 percent of its limit (a small chunk's limit is a tenth above its size
 * by the rule above, so a flat 2 KB would flag every one). Rows over the limit are not listed.
 */
export function lowHeadroom(rows, minKb = MIN_HEADROOM_KB) {
  return rows.filter(r => {
    if (!r.ok) return false;
    const room = r.limitKb * KB - r.gzip;
    if (!r.name.startsWith('lazy:')) return room < minKb * KB;
    return room < minKb * KB && room < r.limitKb * KB * 0.05;
  });
}

/** `index-CZFZNM0R.js` is `index`: Vite ends a file name with `-` and an 8 character hash. */
export function chunkStem(file) {
  return file.replace(/\.js$/, '').replace(/-[A-Za-z0-9_-]{8}$/, '');
}

/** The limit in KB for a lazy chunk file. */
export function lazyLimitKb(file, limits = LAZY_LIMITS_KB) {
  const stem = chunkStem(file);
  return Object.hasOwn(limits, stem) ? limits[stem] : DEFAULT_LAZY_LIMIT_KB;
}

/**
 * The .js file names the page loads first: its scripts and modulepreload links, in order, once
 * each. The file name is the last part of the URL (the assets are served from /next/assets/).
 */
export function firstLoadFiles(html) {
  const files = [];
  for (const [tag, name] of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const attr = key => new RegExp(`\\b${key}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1];
    const url = name.toLowerCase() === 'script' ? attr('src') : attr('href');
    const preload =
      name.toLowerCase() === 'link' && attr('rel')?.split(/\s+/).includes('modulepreload');
    if (!url || (name.toLowerCase() === 'link' && !preload)) continue;
    const file = url.split(/[?#]/)[0].split('/').pop();
    if (file?.endsWith('.js') && /\/assets\//.test(url) && !files.includes(file)) files.push(file);
  }
  return files;
}

/**
 * Checks sizes (in bytes of gzip) against the limits. `first` is the list of first-load files with
 * their sizes, `lazy` the other chunks. Returns the table rows and whether everything fits.
 */
export function checkBudget({ first, lazy }, limits = {}) {
  const firstLimit = limits.firstLoadKb ?? FIRST_LOAD_LIMIT_KB;
  const lazyLimits = limits.lazyKb ?? LAZY_LIMITS_KB;
  const totalGzip = first.reduce((sum, f) => sum + f.gzip, 0);
  const totalRaw = first.reduce((sum, f) => sum + f.raw, 0);
  const rows = [
    {
      name: 'first load (entry + preloads)',
      raw: totalRaw,
      gzip: totalGzip,
      limitKb: firstLimit,
      ok: totalGzip <= firstLimit * KB,
    },
    ...lazy.map(f => {
      const limitKb = lazyLimitKb(f.file, lazyLimits);
      return {
        name: `lazy: ${f.file}`,
        raw: f.raw,
        gzip: f.gzip,
        limitKb,
        ok: f.gzip <= limitKb * KB,
      };
    }),
  ];
  return { rows, ok: rows.every(r => r.ok) };
}

const kb = bytes => (bytes / KB).toFixed(1);

/** The table as plain text, or as Markdown for the job summary. */
export function formatTable(rows, markdown = false) {
  const head = ['Part', 'Raw KB', 'Gzip KB', 'Limit KB', 'Result'];
  const body = rows.map(r => [
    r.name,
    kb(r.raw),
    kb(r.gzip),
    String(r.limitKb),
    r.ok ? 'ok' : 'OVER',
  ]);
  if (markdown) {
    const line = cells => `| ${cells.join(' | ')} |`;
    return [line(head), line(head.map(() => '---')), ...body.map(line)].join('\n');
  }
  const widths = head.map((h, i) => Math.max(h.length, ...body.map(row => row[i].length)));
  const line = cells =>
    cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
  return [line(head), line(widths.map(w => '-'.repeat(w))), ...body.map(line)].join('\n');
}

function measure(dir, file) {
  const buffer = readFileSync(path.join(dir, file));
  return { file, raw: buffer.length, gzip: gzipSync(buffer, { level: 9 }).length };
}

function main() {
  const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'web');
  const indexHtml = path.join(webDir, 'index.html');
  if (!existsSync(indexHtml)) {
    console.error('dist/web is not built. Run: npm run build -w @gnuminator/cogm-dashboard');
    process.exit(2);
  }
  const assets = path.join(webDir, 'assets');
  const firstNames = firstLoadFiles(readFileSync(indexHtml, 'utf8'));
  if (firstNames.length === 0) {
    console.error('Found no script in dist/web/index.html; the budget cannot tell the first load.');
    process.exit(2);
  }
  const all = readdirSync(assets).filter(f => f.endsWith('.js'));
  const missing = firstNames.filter(f => !all.includes(f));
  if (missing.length > 0) {
    console.error(`index.html names files that are not in dist/web/assets: ${missing.join(', ')}`);
    process.exit(2);
  }
  const first = firstNames.map(f => measure(assets, f));
  const lazy = all.filter(f => !firstNames.includes(f)).map(f => measure(assets, f));

  const { rows, ok } = checkBudget({ first, lazy });
  console.log(formatTable(rows));
  console.log(ok ? '\nBundle budget: ok.' : '\nBundle budget: OVER. See the rows marked OVER.');

  for (const r of lowHeadroom(rows)) {
    const room = ((r.limitKb * KB - r.gzip) / KB).toFixed(1);
    console.log(
      `::warning title=Dashboard bundle headroom::${r.name} has ${room} KB left of ${r.limitKb} KB. Make something lazy before the next PR needs a raise.`
    );
  }

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    const title = `### Dashboard bundle budget: ${ok ? 'ok' : 'over'}`;
    appendFileSync(summary, `${title}\n\n${formatTable(rows, true)}\n\n`);
  }
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
