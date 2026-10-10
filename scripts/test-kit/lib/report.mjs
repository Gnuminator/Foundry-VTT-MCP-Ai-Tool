/**
 * Run reports: report.json (the KitReport), report.md and one self-contained report.html.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { KIT_FORMAT_VERSION } from './contract.mjs';
import { consoleCounts, groupConsoleErrors } from './console-errors.mjs';
import { mechanicalNever } from './picks.mjs';

/**
 * @typedef {import('./contract.mjs').KitReport} KitReport
 * @typedef {import('./contract.mjs').ScenarioResult} ScenarioResult
 */

/** @param {ScenarioResult[]} results */
export function summarize(results) {
  const passed = results.filter(r => r.status === 'pass').length;
  const skipped = results.filter(r => r.status === 'skip').length;
  const failed = results.length - passed - skipped; // fail and error
  return { passed, failed, skipped, total: results.length };
}

/**
 * Assembles a KitReport from a finished run.
 * @param {{size: string, target: KitReport['run']['target'], startedAt: Date, finishedAt?: Date,
 *   gitSha?: string, fake?: boolean, build?: KitReport['build'], results: ScenarioResult[],
 *   consoleErrors?: KitReport['consoleErrors'], knownConsole?: Array<{id: string, kind: string, why: string}>}} p
 * @returns {KitReport}
 */
export function makeReport(p) {
  const finishedAt = p.finishedAt || new Date();
  return {
    version: KIT_FORMAT_VERSION,
    run: {
      size: p.size,
      target: p.target,
      startedAt: p.startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - p.startedAt.getTime(),
      gitSha: p.gitSha || 'unknown',
      node: process.version,
      fake: Boolean(p.fake),
    },
    build: p.build || null,
    summary: summarize(p.results),
    consoleErrors: p.consoleErrors || [],
    consoleGroups: groupConsoleErrors(p.consoleErrors || [], { known: p.knownConsole }),
    scenarios: p.results,
  };
}

/**
 * Creates `<kitHome>/reports/<YYYYMMDD-HHMMSS>-<size>` and returns its path.
 * @param {string} kitHome
 * @param {string} size
 * @param {Date} [now]
 */
export function newRunDir(kitHome, size, now = new Date()) {
  const p = n => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  const base = path.join(kitHome, 'reports', `${stamp}-${size}`);
  let dir = base;
  for (let i = 2; existsSync(dir); i += 1) dir = `${base}-${i}`;
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Writes report.json, report.md and report.html into `dir` (created when missing).
 * @param {KitReport} report
 * @param {string} dir
 * @returns {{json: string, md: string, html: string}}
 */
export function writeReport(report, dir) {
  mkdirSync(dir, { recursive: true });
  const files = {
    json: path.join(dir, 'report.json'),
    md: path.join(dir, 'report.md'),
    html: path.join(dir, 'report.html'),
  };
  writeFileSync(files.json, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(files.md, renderMarkdown(report), 'utf8');
  writeFileSync(files.html, renderHtml(report), 'utf8');
  return files;
}

// --- helpers ------------------------------------------------------------------

/** @param {number} ms */
export function fmtMs(ms) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`;
}

/** @param {unknown} value @param {number} [max] */
function excerpt(value, max = 400) {
  let text;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  if (text === undefined) return '';
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

/** @param {unknown} s */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** @param {unknown} s */
function mdCell(s) {
  return String(s).replace(/[\\|]/g, '\\$&').replace(/\r?\n/g, ' ');
}

const STATUS_WORD = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP', error: 'ERROR' };

/**
 * The coverage lines of a build (the manifest's `coverage`): what the content profile offered and
 * what the builder made. Empty when the report has no build.
 * @param {KitReport} r
 * @returns {Array<[string, string]>} label and value
 */
export function coverageRows(r) {
  const b = r.build;
  if (!b || !b.coverage) return [];
  const c = b.coverage;
  const failedHeroes = (b.heroes || []).filter(h => h.buildError).length;
  const rows = /** @type {Array<[string, string]>} */ ([
    ['Classes', `${c.classes.built} built of ${c.classes.found} found`],
    ['Subclasses', `${c.subclasses.built} built of ${c.subclasses.found} found`],
  ]);
  if (c.subclasses.failed.length) {
    rows.push(['Subclasses that failed', c.subclasses.failed.join(', ')]);
  }
  rows.push(['Heroes', `${c.heroes} built${failedHeroes ? `, ${failedHeroes} failed` : ''}`]);
  return rows;
}

// --- console errors -------------------------------------------------------------

/**
 * The time of day of an ISO time; anything else as it is.
 * @param {string} at
 */
function clock(at) {
  return /T(\d\d:\d\d:\d\d)/.exec(at)?.[1] ?? at;
}

/**
 * The console groups of the run and of the build, from the report (or made from the raw lists
 * when an older report has none).
 * @param {KitReport} r
 */
export function consoleSections(r) {
  const build = ((r.build && r.build.consoleErrors) || []).map(e => ({ ...e, scenario: 'build' }));
  return {
    run: r.consoleGroups ?? groupConsoleErrors(r.consoleErrors),
    build: groupConsoleErrors(build),
    runErrors: r.consoleErrors.length,
    buildErrors: build.length,
  };
}

/**
 * How many console error groups of the run and the build are new (not on the expected list).
 * @param {KitReport} r
 */
export function newConsoleGroups(r) {
  const c = consoleSections(r);
  return c.run.filter(g => !g.known).length + c.build.filter(g => !g.known).length;
}

/** The place of a group; a slice 4 page shows its page first. @param {import('./console-errors.mjs').ConsoleGroup} g */
function groupWhere(g) {
  return g.page ? `${g.page}: ${g.source}` : g.source;
}

/** @param {import('./console-errors.mjs').ConsoleGroup} g */
function groupStatus(g) {
  return g.known ? `known (${g.kind})` : 'NEW';
}

/**
 * @param {import('./console-errors.mjs').ConsoleGroup[]} groups
 * @param {number} total
 */
function consoleMarkdown(groups, total) {
  if (!groups.length) return ['None reported.', ''];
  const c = consoleCounts(groups);
  const lines = [
    `${total} errors in ${c.groups} groups: ${c.knownErrors} known (${c.knownGroups} groups), ` +
      `**${c.newErrors} new (${c.newGroups} groups)**. The raw list is in report.json.`,
    '',
    '| Count | Status | Finding | Message | Where | Scenarios | First | Last |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const g of groups) {
    lines.push(
      `| ${g.count} | ${mdCell(groupStatus(g))} | ${mdCell(g.id)} | ${mdCell(g.message)} | ` +
        `${mdCell(groupWhere(g))} | ${mdCell(g.scenarios.join(', ') || '-')} | ${mdCell(clock(g.first))} | ${mdCell(clock(g.last))} |`
    );
  }
  lines.push('');
  return lines;
}

/**
 * @param {import('./console-errors.mjs').ConsoleGroup[]} groups
 * @param {number} total
 */
function consoleHtmlTable(groups, total) {
  if (!groups.length) return '<p>None reported.</p>';
  const c = consoleCounts(groups);
  const rows = groups
    .map(
      g =>
        `<tr class="${g.known ? 'known' : 'fresh'}"><td>${g.count}</td>` +
        `<td><span class="badge ${g.known ? 'skip' : 'fail'}">${esc(groupStatus(g))}</span></td>` +
        `<td>${esc(g.id)}${g.why ? `<div class="when">${esc(g.why)}</div>` : ''}</td>` +
        `<td>${esc(g.message)}</td><td>${esc(groupWhere(g))}</td>` +
        `<td>${esc(g.scenarios.join(', ') || '-')}</td>` +
        `<td class="t">${esc(clock(g.first))}</td><td class="t">${esc(clock(g.last))}</td></tr>`
    )
    .join('');
  return (
    `<p>${total} errors in ${c.groups} groups: ${c.knownErrors} known (${c.knownGroups} groups), ` +
    `<strong class="${c.newGroups ? 'fail' : 'pass'}">${c.newErrors} new (${c.newGroups} groups)</strong>. ` +
    `The raw list is in report.json.</p>` +
    `<table><thead><tr><th>Count</th><th>Status</th><th>Finding</th><th>Message</th><th>Where</th>` +
    `<th>Scenarios</th><th>First</th><th>Last</th></tr></thead><tbody>${rows}</tbody></table>`
  );
}

// --- markdown -----------------------------------------------------------------

/**
 * The "Known findings" section: per scenario with a `known` attachment (lib/known.mjs), the entries
 * that matched and how often, and the entries this run did not see.
 * @param {KitReport} r
 * @returns {string[]}
 */
export function knownMarkdown(r) {
  const lines = [];
  for (const s of r.scenarios) {
    const att = s.attachments.find(a => a.name === 'known');
    const data = /** @type {any} */ (att?.data);
    if (!data || !data.entries) continue;
    if (!lines.length) lines.push('## Known findings', '');
    const matched = Object.entries(data.matched ?? {});
    lines.push(`### ${s.id}: ${matched.length} of ${data.entries} entries matched`, '');
    for (const [id, m] of matched)
      lines.push(`- ${mdCell(id)} (${m.kind}, ${m.problems} problem(s)): ${mdCell(m.why)}`);
    if (data.unseen?.length)
      lines.push(`- Not seen in this run: ${data.unseen.map(mdCell).join(', ')}`);
    lines.push('');
  }
  return lines;
}

/**
 * The coverage line of the "Picks" section: how many coverage heroes the build made (extra heroes
 * for play-changing options no other hero picked, lib/coverage.mjs) and how many of those options
 * are still never picked.
 * @param {KitReport} r
 * @returns {string | null} null when the report has no build
 */
export function coverageHeroesLine(r) {
  if (!r.build) return null;
  const heroes = r.build.heroes ?? [];
  const built = heroes.filter(h => h.role === 'coverage' && h.actorId && !h.buildError).length;
  const left = mechanicalNever(/** @type {any} */ (heroes)).length;
  const pass = r.build.coveragePass;
  if (pass && !pass.enabled)
    return `Coverage heroes: none built (smoke size or --no-coverage), ${left} mechanical options never picked.`;
  if (!pass && !built)
    return `Coverage heroes: none built (this manifest has no coverage pass), ${left} mechanical options never picked.`;
  const cap = pass?.capHit ? ` (cap of ${pass.cap} reached)` : '';
  return `Coverage heroes: ${built} built, ${left} mechanical options still never picked${cap}.`;
}

/**
 * The "Picks" section: per class choice (lib/picks.mjs), the options offered, how many were picked
 * at least once, and the ones no hero picked (the first 12 names, the rest counted), then the
 * coverage heroes line.
 * @param {KitReport} r
 * @returns {string[]}
 */
export function picksMarkdown(r) {
  const s = r.scenarios.find(x => x.attachments.some(a => a.name === 'picks'));
  const rows = /** @type {any[]} */ (s?.attachments.find(a => a.name === 'picks')?.data);
  if (!Array.isArray(rows) || !rows.length) return [];
  const lines = ['## Picks', ''];
  lines.push('| Class | Choice | Heroes | Offered | Picked | Never picked |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const row of rows) {
    const never =
      row.never.slice(0, 12).join(', ') +
      (row.never.length > 12 ? ` and ${row.never.length - 12} more` : '');
    lines.push(
      `| ${mdCell(row.classIdentifier)} | ${mdCell(row.title)} | ${row.heroes} | ${row.offered} | ` +
        `${row.offered - row.never.length} | ${mdCell(never || '-')} |`
    );
  }
  const covered = coverageHeroesLine(r);
  if (covered) lines.push('', covered);
  lines.push('', 'Every pick per hero is in the manifest (`picks`) and in report.json.', '');
  return lines;
}

/**
 * The "Attachments" section: the file attachments of every scenario (screenshots), as links relative
 * to the report folder.
 * @param {KitReport} r
 * @returns {string[]}
 */
export function attachmentsMarkdown(r) {
  const lines = [];
  for (const s of r.scenarios) {
    const files = s.attachments.filter(a => a.file);
    if (!files.length) continue;
    if (!lines.length) lines.push('## Attachments', '');
    lines.push(`### ${mdCell(s.id)}`, '');
    for (const a of files) lines.push(`- [${mdCell(a.name)}](${encodeURI(String(a.file))})`);
    lines.push('');
  }
  return lines;
}

/** @param {KitReport} r */
export function renderMarkdown(r) {
  const { run, summary } = r;
  const lines = [];
  lines.push(`# Test kit report: ${run.size}`);
  lines.push('');
  lines.push(`- Size: ${run.size}${run.fake ? ' (fake)' : ''}`);
  if (r.build) lines.push(`- Profile: ${r.build.profile || 'unknown'}`);
  lines.push(
    `- Target: ${run.target.name}${run.target.server ? `, server ${run.target.server}` : ''} (dashboard ${run.target.dashboard}, Foundry ${run.target.foundry})`
  );
  lines.push(`- World: ${run.target.world}`);
  lines.push(`- Git: ${run.gitSha}, Node ${run.node}`);
  lines.push(`- Started: ${run.startedAt}, duration ${fmtMs(run.durationMs)}`);
  lines.push('');
  lines.push(
    `**${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped** of ${summary.total} scenarios.`
  );
  lines.push('');
  const fresh = newConsoleGroups(r);
  if (fresh) {
    lines.push(
      `**WARNING: ${fresh} new console error group${fresh === 1 ? '' : 's'}** (not on the expected list); see Console errors below.`
    );
    lines.push('');
  }
  lines.push('| Scenario | Tags | Status | Time |');
  lines.push('| --- | --- | --- | --- |');
  for (const s of r.scenarios) {
    lines.push(
      `| ${mdCell(s.id)}: ${mdCell(s.title)} | ${mdCell(s.tags.join(', '))} | ${STATUS_WORD[s.status]} | ${fmtMs(s.durationMs)} |`
    );
  }
  lines.push('');
  const bad = r.scenarios.filter(s => s.status === 'fail' || s.status === 'error');
  if (bad.length) {
    lines.push('## Failures');
    lines.push('');
    for (const s of bad) {
      lines.push(`### ${s.id}: ${s.title} (${STATUS_WORD[s.status]})`);
      lines.push('');
      for (const st of s.steps) {
        const tail = st.error ? `: ${st.error.message}` : st.detail ? `: ${st.detail}` : '';
        lines.push(`- ${STATUS_WORD[st.status]} ${st.label} (${fmtMs(st.durationMs)})${tail}`);
        if (st.error && st.error.reply !== undefined) {
          lines.push('');
          lines.push('  ```json');
          for (const l of excerpt(st.error.reply).split('\n')) lines.push(`  ${l}`);
          lines.push('  ```');
          lines.push('');
        }
      }
      lines.push('');
    }
  }
  const coverage = coverageRows(r);
  if (coverage.length) {
    lines.push('## Coverage');
    lines.push('');
    for (const [label, value] of coverage) lines.push(`- ${label}: ${value}`);
    lines.push('');
  }
  lines.push(...knownMarkdown(r));
  lines.push(...picksMarkdown(r));
  lines.push(...attachmentsMarkdown(r));
  const con = consoleSections(r);
  if (r.build) {
    lines.push('## Build console errors');
    lines.push('');
    lines.push(...consoleMarkdown(con.build, con.buildErrors));
  }
  lines.push('## Console errors');
  lines.push('');
  lines.push(...consoleMarkdown(con.run, con.runErrors));
  return lines.join('\n');
}

// --- html ---------------------------------------------------------------------

const CSS = `
:root{--bg:#fbfbfa;--fg:#1d1f21;--muted:#62666b;--line:#dcdcd7;--card:#fff;--pass:#1b7f3b;--fail:#b3261e;--skip:#8a6d00;--err:#7b1fa2;--code:#f0f0ec}
@media (prefers-color-scheme:dark){:root{--bg:#16181a;--fg:#e6e6e3;--muted:#9a9ea3;--line:#33373b;--card:#1e2124;--pass:#5fd081;--fail:#ff8a80;--skip:#e3c451;--err:#d79bf0;--code:#101214}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1000px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:1.5rem;margin:0 0 4px}
h2{font-size:1.1rem;margin:32px 0 8px}
.meta{color:var(--muted);font-size:.9rem;margin:0 0 16px}
.meta span{margin-right:14px;white-space:nowrap}
.bar{display:flex;height:14px;border-radius:7px;overflow:hidden;background:var(--line);margin:8px 0}
.bar i{display:block;height:100%}
.bar .p{background:var(--pass)}.bar .f{background:var(--fail)}.bar .s{background:var(--skip)}
.sum{font-weight:600}
.filters{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0 8px;align-items:center}
.filters label{color:var(--muted);font-size:.9rem}
select{font:inherit;padding:3px 6px;background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:6px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:8px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
tr:last-child td{border-bottom:0}
td.t{white-space:nowrap;color:var(--muted)}
.badge{font-weight:700;font-size:.8rem;letter-spacing:.03em}
.pass{color:var(--pass)}.fail{color:var(--fail)}.skip{color:var(--skip)}.error{color:var(--err)}
.tag{display:inline-block;border:1px solid var(--line);border-radius:10px;padding:0 7px;margin:0 4px 2px 0;font-size:.78rem;color:var(--muted)}
details>summary{cursor:pointer}
details .box{margin:8px 0 4px;padding-left:4px}
.step{margin:2px 0}
.step .when{color:var(--muted);font-size:.85rem}
pre{background:var(--code);border:1px solid var(--line);border-radius:6px;padding:8px;overflow:auto;font:12.5px/1.4 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-word}
.hide{display:none}
@media (max-width:600px){th:nth-child(2),td:nth-child(2){display:none}}
`;

const JS = `
(function(){
  var st=document.getElementById('f-status'),tg=document.getElementById('f-tag');
  var rows=document.querySelectorAll('tbody tr');
  function apply(){
    for(var i=0;i<rows.length;i++){
      var r=rows[i];
      var okS=!st.value||r.getAttribute('data-status')===st.value||(st.value==='bad'&&(r.getAttribute('data-status')==='fail'||r.getAttribute('data-status')==='error'));
      var okT=!tg.value||(' '+r.getAttribute('data-tags')+' ').indexOf(' '+tg.value+' ')>=0;
      r.classList.toggle('hide',!(okS&&okT));
    }
  }
  st.addEventListener('change',apply);tg.addEventListener('change',apply);
})();
`;

/** @param {ScenarioResult['attachments'][number]} a */
function attachmentHtml(a) {
  if (!a.file) return `<h4>${esc(a.name)}</h4><pre>${esc(excerpt(a.data, 20000))}</pre>`;
  const href = esc(encodeURI(String(a.file)));
  if (String(a.type || '').startsWith('image/')) {
    return (
      `<h4>${esc(a.name)}</h4>` +
      `<a href="${href}"><img src="${href}" alt="${esc(a.name)}" loading="lazy" style="max-width:100%"></a>`
    );
  }
  return `<h4>${esc(a.name)}</h4><p><a href="${href}">${esc(a.name)}</a></p>`;
}

/** @param {KitReport} r */
export function renderHtml(r) {
  const { run, summary } = r;
  const total = Math.max(summary.total, 1);
  const pct = n => ((n / total) * 100).toFixed(2);
  const allTags = [...new Set(r.scenarios.flatMap(s => s.tags))].sort();

  const rows = r.scenarios
    .map(s => {
      const steps = s.steps
        .map(st => {
          const tail = st.error ? st.error.message : st.detail || '';
          const reply =
            st.error && st.error.reply !== undefined
              ? `<pre>${esc(excerpt(st.error.reply, 2000))}</pre>`
              : '';
          return (
            `<div class="step"><span class="badge ${st.status}">${STATUS_WORD[st.status]}</span> ` +
            `${esc(st.label)} <span class="when">${fmtMs(st.durationMs)}</span>` +
            `${tail ? `<div>${esc(tail)}</div>` : ''}${reply}</div>`
          );
        })
        .join('');
      const logs = s.logs.length ? `<h4>Log</h4><pre>${esc(s.logs.join('\n'))}</pre>` : '';
      const atts = s.attachments.map(a => attachmentHtml(a)).join('');
      return (
        `<tr data-status="${esc(s.status)}" data-tags="${esc(s.tags.join(' '))}">` +
        `<td><details><summary><strong>${esc(s.id)}</strong>: ${esc(s.title)}</summary>` +
        `<div class="box">${steps || '<em>no steps</em>'}${logs}${atts}` +
        `<div class="when">${esc(s.file)}${s.licensed ? ' (licensed)' : ''}</div></div></details></td>` +
        `<td>${s.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</td>` +
        `<td><span class="badge ${s.status}">${STATUS_WORD[s.status]}</span></td>` +
        `<td class="t">${fmtMs(s.durationMs)}</td></tr>`
      );
    })
    .join('\n');

  const con = consoleSections(r);
  const consoleHtml = consoleHtmlTable(con.run, con.runErrors);

  const coverage = coverageRows(r);
  const coverageRowsHtml = coverage
    .map(([label, value]) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`)
    .join('');
  const coverageHtml = coverage.length
    ? `<h2>Coverage</h2><table><tbody>${coverageRowsHtml}</tbody></table>`
    : '';
  const buildErrorsHtml = r.build
    ? `<h2>Build console errors</h2>${consoleHtmlTable(con.build, con.buildErrors)}`
    : '';
  const fresh = newConsoleGroups(r);
  const warnHtml = fresh
    ? `<p class="fail"><strong>WARNING: ${fresh} new console error group${fresh === 1 ? '' : 's'}</strong> (not on the expected list); see Console errors below.</p>`
    : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Test kit report: ${esc(run.size)}</title>
<style>${CSS}</style></head>
<body><main>
<h1>Test kit report: ${esc(run.size)}${run.fake ? ' (fake)' : ''}</h1>
<p class="meta">${r.build ? `<span>Profile ${esc(r.build.profile || 'unknown')}</span>` : ''}<span>Target ${esc(run.target.name)}${run.target.server ? ` ${esc(run.target.server)}` : ''} (${esc(run.target.dashboard)})</span><span>World ${esc(run.target.world)}</span><span>Git ${esc(run.gitSha)}</span><span>Node ${esc(run.node)}</span><span>${esc(run.startedAt)}</span><span>Duration ${fmtMs(run.durationMs)}</span></p>
<p class="sum"><span class="pass">${summary.passed} passed</span>, <span class="fail">${summary.failed} failed</span>, <span class="skip">${summary.skipped} skipped</span> of ${summary.total}</p>
${warnHtml}<div class="bar" role="img" aria-label="${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped"><i class="p" style="width:${pct(summary.passed)}%"></i><i class="f" style="width:${pct(summary.failed)}%"></i><i class="s" style="width:${pct(summary.skipped)}%"></i></div>
<div class="filters"><label>Status <select id="f-status"><option value="">all</option><option value="bad">failed or error</option><option value="pass">pass</option><option value="fail">fail</option><option value="error">error</option><option value="skip">skip</option></select></label>
<label>Tag <select id="f-tag"><option value="">all</option>${allTags.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select></label></div>
<table><thead><tr><th>Scenario</th><th>Tags</th><th>Status</th><th>Time</th></tr></thead>
<tbody>
${rows}
</tbody></table>
${coverageHtml}${buildErrorsHtml}<h2>Console errors</h2>
${consoleHtml}
<script>${JS}</script>
</main></body></html>
`;
}
