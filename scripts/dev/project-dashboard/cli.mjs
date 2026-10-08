#!/usr/bin/env node
// Entry point: serve the page, or print the lanes table / the snapshot once.
import { getPaths } from './paths.mjs';
import { buildSnapshot, writeSnapshot, assertWhitelisted } from './snapshot.mjs';
import { formatLanesTable } from './lanes.mjs';

const args = process.argv.slice(2);
const paths = getPaths();

function flagValue(name) {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? '');
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const GH_TIMEOUT_MS = 6000;

// For one-shot runs: ask gh for the PRs but never wait long for it.
async function getPrsWithTimeout(opts) {
  const { getPrs } = await import('./gh.mjs');
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('gh did not answer in time')), GH_TIMEOUT_MS);
  });
  try {
    return await Promise.race([getPrs(opts), limit]);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  if (args.includes('--lanes')) {
    const next = flagValue('--lanes');
    const n = /^\d+$/.test(next ?? '') ? Number(next) : 10;
    const snap = await buildSnapshot({
      paths,
      now: new Date(),
      withPrs: true,
      deps: { getPrs: getPrsWithTimeout },
    });
    console.log(formatLanesTable(snap.lanes.rows, n, new Date()));
    const { used, max, steward } = snap.lanes.cap;
    console.log(
      `\nlanes in use: ${used}/${max}${steward ? ` (steward ${steward.slice(0, 8)} not counted)` : ''}`
    );
    if (snap.prs.error) console.log(`PRs: ${snap.prs.error}`);
    for (const w of snap.warnings) console.log(`warning: ${w}`);
    process.exit(0);
  }
  if (args.includes('--snapshot') || args.includes('--json')) {
    const snap = await buildSnapshot({
      paths,
      now: new Date(),
      withPrs: true,
      deps: { getPrs: getPrsWithTimeout },
    });
    assertWhitelisted(snap);
    if (args.includes('--json')) {
      console.log(JSON.stringify(snap, null, 2));
    } else {
      console.log(await writeSnapshot(paths.dataDir, snap));
    }
    process.exit(0);
  }

  let port = 3200;
  const portArg = flagValue('--port');
  if (portArg !== null) {
    port = Number(portArg);
    if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`Not a valid port: ${portArg}`);
    if (port >= 31414 && port <= 31416)
      fail('Ports 31414-31416 belong to the live bridge; pick another port.');
  }
  const { startServer } = await import('./server.mjs');
  await startServer({ port, buildSnapshot: opts => buildSnapshot({ paths, ...opts }) });
}

main().catch(err => fail(err?.stack || String(err)));
