#!/usr/bin/env node
/**
 * Who uses what (D-146): reads the GM-only `GET /api/who-uses-what` report from a dashboard and
 * writes it as one Markdown note, which the PM board shows. Read-only against the dashboard.
 *
 *   node scripts/who-uses-what.mjs --base <dashboard address> [--days 7] [--out <file>] [--json <file>]
 *
 * --json writes the report itself (the JSON the dashboard answered with), which the Pi posts to the PM board (stage 35).
 *
 * Environment: COGM_TOKEN (the GM token, when the dashboard asks for one). The report holds
 * names, versions, tool names and counts only; never typed text, arguments or results.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const cell = value => String(value ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ');
const when = iso => (iso ? iso.slice(0, 16).replace('T', ' ') : 'never');

/** The report (see packages/mcp-server/src/who-uses-what.ts) as a Markdown note. */
export function renderWhoUsesWhat(report) {
  const out = [];
  out.push('# Who uses what');
  out.push('');
  out.push(
    `Last ${report.days} days, made ${when(report.generatedAt)} UTC. Table version ${report.current}. ` +
      'Counts only: never typed text, tool arguments or results. The group knows features are counted.'
  );
  out.push('');
  out.push(
    'Claude calls are what people asked Claude to do; Dashboard calls are the GM dashboard refreshing itself. ' +
      'Errors leave out Foundry-down windows (backup, update, restart).'
  );
  out.push('');
  out.push(
    '| Person | Claude calls | Dashboard calls | Errors | Last seen | Top tools (Claude) | Skills | Dashboard and Foundry controls |'
  );
  out.push('| --- | ---: | ---: | ---: | --- | --- | --- | --- |');
  for (const p of report.people) {
    const name = p.role === 'gm' ? 'GM' : p.name ?? (p.role === 'unknown' ? 'Unknown (older lines)' : p.key);
    out.push(
      `| ${cell(name)} | ${p.claudeCalls ?? p.calls} | ${p.dashboardCalls ?? 0} | ${p.realErrors ?? p.errors} | ${when(p.lastSeen)} | ` +
        `${cell(p.topTools.map(t => `${t.name} ${t.calls}`).join(', ') || 'none')} | ` +
        `${cell(p.skills.map(s => `${s.skill} (stub ${s.stub ?? '?'}) ${s.calls}`).join(', ') || 'none')} | ` +
        `${cell(p.controls.top.map(c => `${c.name} ${c.uses}`).join(', ') || 'none')} |`
    );
  }
  out.push('');
  const causes = report.errorCauses;
  if (causes && causes.total > 0) {
    out.push('## Errors by cause');
    out.push('');
    out.push(
      `${causes.total} failed calls: ${causes.foundryDown.calls} while Foundry was down or not linked, ${causes.total - causes.foundryDown.calls} other.`
    );
    for (const w of causes.foundryDown.windows.slice(-10)) {
      out.push(`- Foundry down ${when(w.from)} to ${when(w.to)} UTC: ${w.calls} calls`);
    }
    for (const r of causes.real) out.push(`- ${cell(r.cause)}: ${r.calls}`);
    out.push('');
  }
  out.push('## Versions');
  out.push('');
  out.push('| Person | Piece | Version | Install | Status | Last seen |');
  out.push('| --- | --- | --- | --- | --- | --- |');
  let any = false;
  for (const p of report.people) {
    const name = p.role === 'gm' ? 'GM' : p.name ?? p.key;
    for (const v of p.versions) {
      any = true;
      const piece = v.piece === 'claude' && v.name ? `claude (${v.name})` : v.piece;
      out.push(
        `| ${cell(name)} | ${cell(piece)} | ${cell(v.version ?? 'unknown')} | ${cell(v.install || '-')} | ` +
          `${v.behind ? 'BEHIND' : 'ok'} | ${when(v.lastSeen)} |`
      );
    }
  }
  if (!any) out.push('| none yet | | | | | |');
  out.push('');
  out.push('## Tools');
  out.push('');
  out.push(`Tools called at least once: ${report.tools.used}.`);
  if (report.tools.neverCalled) {
    out.push('');
    out.push(`Never called (${report.tools.neverCalled.length}): ${report.tools.neverCalled.join(', ') || 'none'}.`);
  }
  if (report.tools.errorRates.length > 0) {
    out.push('');
    out.push('Error rate (tools with errors):');
    for (const e of report.tools.errorRates) {
      out.push(`- ${e.name}: ${e.errors} of ${e.calls}`);
    }
  }
  out.push('');
  // The PM board reads this block, not the tables above (counts and names only, same as the tables).
  out.push('```json');
  out.push(JSON.stringify(report));
  out.push('```');
  out.push('');
  return out.join('\n');
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const base = arg('base', '').replace(/\/+$/, '');
  if (!base) throw new Error('Pass --base <dashboard address>.');
  const days = Number(arg('days', '7'));
  const token = process.env.COGM_TOKEN;
  const res = await fetch(`${base}/api/who-uses-what?days=${days}`, {
    headers: token ? { 'X-CoGM-Token': token } : {},
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`The dashboard answered ${res.status}.`);
  const report = await res.json();
  const note = renderWhoUsesWhat(report);
  const jsonOut = arg('json', '');
  if (jsonOut) {
    await fsp.mkdir(path.dirname(path.resolve(jsonOut)), { recursive: true });
    await fsp.writeFile(jsonOut, JSON.stringify(report), 'utf8');
  }
  const out = arg('out', '');
  if (out) {
    await fsp.mkdir(path.dirname(path.resolve(out)), { recursive: true });
    await fsp.writeFile(out, note, 'utf8');
    console.log(`Wrote ${out}`);
  } else {
    console.log(note);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(e => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
