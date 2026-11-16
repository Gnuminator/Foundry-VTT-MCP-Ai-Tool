// Merges the two-sided story render (packages/cogm-dashboard/web/visual/stories-diff.spec.ts) of
// one or more shards into one report: visual-diff.json, a diff page (index.html, before / after /
// diff side by side) and a markdown summary for the job summary.
//
//   node scripts/visual-diff-report.mjs --out <dir> [--base-sha <sha>] [--head-sha <sha>]
//        [--summary <file>] <shardDir>...
//
// A shard dir holds entries/<id>.json and before|after|diff/<id>.png. A difference is data, not a
// failure: the exit code is 0 unless the arguments are wrong. `hash` is the first 8 hex characters
// of the sha256 of the sorted ids of the changed, added and removed stories (what a reviewer
// accepts later).
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KINDS = ['before', 'after', 'diff'];

export function mergeShards(dirs) {
  const entries = [];
  for (const dir of dirs) {
    const entriesDir = path.join(dir, 'entries');
    if (!existsSync(entriesDir)) continue;
    for (const name of readdirSync(entriesDir).filter(n => n.endsWith('.json'))) {
      const entry = JSON.parse(readFileSync(path.join(entriesDir, name), 'utf8'));
      entries.push({ ...entry, dir });
    }
  }
  return entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function buildReport(entries, meta = {}) {
  const ids = status => entries.filter(e => e.status === status).map(e => e.id);
  const changed = entries
    .filter(e => e.status === 'changed')
    .map(e => ({ id: e.id, pixels: e.pixels, sizeDiffers: Boolean(e.sizeDiffers) }));
  const added = ids('added');
  const removed = ids('removed');
  const errors = entries
    .filter(e => e.status === 'error')
    .map(e => ({ id: e.id, error: e.error ?? '' }));
  const flagged = [...changed.map(c => c.id), ...added, ...removed].sort();
  const hash = createHash('sha256').update(flagged.join('\n')).digest('hex').slice(0, 8);
  return {
    baseSha: meta.baseSha ?? null,
    headSha: meta.headSha ?? null,
    compared: entries.length,
    changed,
    added,
    removed,
    errors,
    count: flagged.length,
    hash,
  };
}

const esc = s =>
  String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function renderPage(report) {
  const img = (kind, id) =>
    `<figure><figcaption>${kind}</figcaption><img loading="lazy" src="${kind}/${encodeURIComponent(id)}.png" alt="${kind} ${esc(id)}"></figure>`;
  const section = (id, title, kinds) =>
    `<section id="${esc(id)}"><h2>${esc(title)}</h2><div class="row">${kinds.map(k => img(k, id)).join('')}</div></section>`;
  const parts = [
    ...report.changed.map(c =>
      section(
        c.id,
        `${c.id} (${c.sizeDiffers ? 'size differs' : `${c.pixels} px`})`,
        c.sizeDiffers ? ['before', 'after'] : ['before', 'after', 'diff']
      )
    ),
    ...report.added.map(id => section(id, `${id} (added)`, ['after'])),
    ...report.removed.map(id => section(id, `${id} (removed)`, ['before'])),
  ];
  const errors = report.errors.length
    ? `<h2>Could not render (${report.errors.length})</h2><ul>${report.errors.map(e => `<li>${esc(e.id)}: ${esc(e.error)}</li>`).join('')}</ul>`
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard visual diff</title>
<style>
body{font:14px/1.4 system-ui,sans-serif;margin:16px;background:#fff;color:#111}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start}
figure{margin:0}figcaption{font-weight:600;margin-bottom:4px}
img{max-width:100%;border:1px solid #ccc;background:#eee}
section{margin:0 0 28px}h2{font-size:15px}
</style></head><body>
<h1>Dashboard visual diff</h1>
<p>${esc(report.compared)} stories compared: ${report.changed.length} changed, ${report.added.length} added, ${report.removed.length} removed, ${report.errors.length} could not render. Hash ${esc(report.hash)}.</p>
${parts.join('\n') || '<p>No differences.</p>'}
${errors}
</body></html>
`;
}

export function renderSummary(report) {
  const lines = [`### Dashboard story shots: ${report.count} changed against the base`, ''];
  lines.push(
    `${report.compared} stories compared (base ${report.baseSha?.slice(0, 8) ?? 'unknown'}, head ${report.headSha?.slice(0, 8) ?? 'unknown'}); ` +
      `${report.changed.length} changed, ${report.added.length} added, ${report.removed.length} removed, ${report.errors.length} could not render. Hash \`${report.hash}\`.`,
    '',
    'The images are in the `dashboard-visual-diff` artifact (open `index.html`).',
    ''
  );
  if (report.changed.length) {
    lines.push('| Changed story | Pixels |', '| --- | --- |');
    for (const c of report.changed) lines.push(`| ${c.id} | ${c.sizeDiffers ? 'size differs' : c.pixels} |`);
    lines.push('');
  }
  if (report.added.length) lines.push(`Added: ${report.added.map(i => `\`${i}\``).join(', ')}`, '');
  if (report.removed.length)
    lines.push(`Removed: ${report.removed.map(i => `\`${i}\``).join(', ')}`, '');
  if (report.errors.length) {
    lines.push('Could not render:');
    for (const e of report.errors) lines.push(`- \`${e.id}\`: ${e.error}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function writeReport(outDir, dirs, meta = {}) {
  const entries = mergeShards(dirs);
  const report = buildReport(entries, meta);
  mkdirSync(outDir, { recursive: true });
  for (const entry of entries) {
    for (const kind of KINDS) {
      const src = path.join(entry.dir, kind, `${entry.id}.png`);
      if (!existsSync(src)) continue;
      mkdirSync(path.join(outDir, kind), { recursive: true });
      copyFileSync(src, path.join(outDir, kind, `${entry.id}.png`));
    }
  }
  writeFileSync(path.join(outDir, 'visual-diff.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(path.join(outDir, 'index.html'), renderPage(report));
  return report;
}

function main(argv) {
  const dirs = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (['--out', '--base-sha', '--head-sha', '--summary'].includes(a)) opts[a] = argv[++i];
    else if (a.startsWith('--')) {
      console.error(`visual-diff-report: unknown option ${a}`);
      return 2;
    } else dirs.push(a);
  }
  if (!opts['--out'] || dirs.length === 0) {
    console.error(
      'usage: node scripts/visual-diff-report.mjs --out <dir> [--base-sha s] [--head-sha s] [--summary file] <shardDir>...'
    );
    return 2;
  }
  const report = writeReport(opts['--out'], dirs, {
    baseSha: opts['--base-sha'],
    headSha: opts['--head-sha'],
  });
  const summary = renderSummary(report);
  if (opts['--summary']) writeFileSync(opts['--summary'], `${summary}\n`, { flag: 'a' });
  console.log(summary);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
