/**
 * Read-only live verification sweep against the running co-GM dashboard
 * (http://localhost:3000) → MCP bridge → live Foundry game.
 *
 * Lists the bridge tool catalog, runs every READ-classified tool (filling
 * required args from discovered live data where possible), and prints a
 * pass/skip/fail table. Invokes NOTHING that mutates the game — the dashboard's
 * own classifier gates writes, and this only calls `mutates === 'read'` tools.
 *
 *   node scripts/live-read-sweep.mjs
 */

const BASE = process.env.COGM_BASE || 'http://localhost:3000';

async function getJson(path) {
  const r = await fetch(BASE + path, { signal: AbortSignal.timeout(20000) });
  return r.json();
}
async function callTool(name, args = {}) {
  const r = await fetch(BASE + '/api/tool', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, args }),
    signal: AbortSignal.timeout(25000),
  });
  return r.json();
}

const shortShape = v => {
  if (v == null) return String(v);
  if (Array.isArray(v)) return `array(${v.length})`;
  if (typeof v === 'object') return `{${Object.keys(v).slice(0, 6).join(',')}}`;
  return JSON.stringify(v).slice(0, 60);
};

(async () => {
  const health = await getJson('/api/health');
  const catalog = await getJson('/api/tools');
  const tools = (catalog.tools || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const reads = tools.filter(t => t.mutates === 'read');

  // --- Discover live inputs to satisfy required args ------------------------
  let tokenIds = [];
  let firstModuleId = '';
  try {
    const tp = await callTool('get-token-positions', {});
    const toks = (tp.result && (tp.result.tokens || tp.result.positions)) || [];
    tokenIds = toks.map(t => t.id || t.tokenId).filter(Boolean);
  } catch {}
  try {
    const mods = await callTool('get-modules', {});
    const list = (mods.result && mods.result.modules) || [];
    firstModuleId = (list[0] && (list[0].id || list[0].name)) || '';
  } catch {}

  const KNOWN = {
    identifier: 'Silvera Frostmantle',
    characterIdentifier: 'Silvera Frostmantle',
    characterName: 'Silvera Frostmantle',
    actorIdentifier: 'Silvera Frostmantle',
    query: 'goblin',
    searchText: 'goblin',
    packType: 'Actor',
    moduleId: firstModuleId,
    challengeRating: 1,
    partySize: 4,
    partyLevel: 5,
    partySize_: 4,
  };

  const fillArgs = schema => {
    const req = (schema && schema.required) || [];
    const props = (schema && schema.properties) || {};
    const args = {};
    const missing = [];
    for (const key of req) {
      if (/token/i.test(key) && tokenIds.length) {
        args[key] = /ids$/i.test(key) ? tokenIds.slice(0, 2) : tokenIds[0];
      } else if (key in KNOWN && KNOWN[key] !== '') {
        args[key] = KNOWN[key];
      } else if (props[key] && props[key].default !== undefined) {
        args[key] = props[key].default;
      } else {
        missing.push(key);
      }
    }
    return { args, missing };
  };

  const rows = [];
  for (const t of reads) {
    const { args, missing } = fillArgs(t.inputSchema);
    if (missing.length) {
      rows.push({ name: t.name, status: 'SKIP', detail: `needs: ${missing.join(',')}` });
      continue;
    }
    try {
      const res = await callTool(t.name, args);
      if (res.ok) {
        rows.push({ name: t.name, status: 'PASS', detail: shortShape(res.result) });
      } else {
        rows.push({
          name: t.name,
          status: 'FAIL',
          detail: `${res.kind || '?'}: ${String(res.error).replace(/\s+/g, ' ').slice(0, 90)}`,
        });
      }
    } catch (e) {
      rows.push({ name: t.name, status: 'ERROR', detail: String(e.message || e).slice(0, 90) });
    }
  }

  const counts = rows.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
  console.log('# Live read-only sweep');
  console.log(
    `health: control=${health.controlChannel} ai=${health.aiEnabled} | tools=${tools.length} (read=${reads.length})`
  );
  console.log(
    `discovered: tokens=${tokenIds.length} firstModuleId=${firstModuleId || '(none)'}`
  );
  console.log(
    `RESULT: ${counts.PASS || 0} pass, ${counts.SKIP || 0} skip, ${counts.FAIL || 0} fail, ${counts.ERROR || 0} error`
  );
  console.log('');
  for (const r of rows) {
    console.log(`${r.status.padEnd(5)} ${r.name.padEnd(28)} ${r.detail}`);
  }
})().catch(e => {
  console.error('SWEEP FAILED:', e);
  process.exit(1);
});
