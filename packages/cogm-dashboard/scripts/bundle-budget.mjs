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
// To raise a limit on purpose, change the constant below in the same PR and say why in the PR.
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

/**
 * Limits in KB of gzip. Measured 2026-10-10 on the build of that day: today's gzip size plus 10
 * percent, rounded up to the next KB.
 */
export const FIRST_LOAD_LIMIT_KB = 150; // measured 136.2 KB (one entry chunk, no modulepreload)

/**
 * Lazy chunks by name stem (the file name without its hash and extension: `Tarokka-Cx9aB1zQ.js`
 * is `Tarokka`). There are none yet: the whole dashboard is one entry chunk. Add `Stem: limitKB`
 * when a split is made, measured the same way (size plus 10 percent, rounded up).
 */
export const LAZY_LIMITS_KB = {};

/** A lazy chunk whose stem is not listed above gets this: a new split is fine, a big one is not. */
export const DEFAULT_LAZY_LIMIT_KB = 40;

const KB = 1000;

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

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    const title = `### Dashboard bundle budget: ${ok ? 'ok' : 'over'}`;
    appendFileSync(summary, `${title}\n\n${formatTable(rows, true)}\n\n`);
  }
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
