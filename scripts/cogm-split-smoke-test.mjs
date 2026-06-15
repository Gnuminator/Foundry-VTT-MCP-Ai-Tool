#!/usr/bin/env node
/**
 * Player/GM split integration smoke test (DETACH-PLAN Phase 6 — B).
 *
 * Proves the server-side filtering end-to-end over real HTTP, against a mock
 * JSON-lines bridge (never the live 31414/31415):
 *
 *   - stand up a mock control channel returning canned world/combat/events/errors
 *   - run the REAL dashboard server pointed at it, with the split enabled
 *     (GM_DASHBOARD_TOKEN set, ANTHROPIC_API_KEY empty)
 *   - GM /api/state    → sees exact enemy HP, module errors, settings, GM names
 *   - player /api/state → enemy HP nulled, hidden combatant dropped, NO errors/
 *     settings, GM names stripped; still sees the PC HP + public event feed
 *   - POST /api/tool with no token → 403 (write surface gated server-side)
 *
 * All ports are throwaway/free. Run from repo root after a build.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(repoRoot, 'packages', 'cogm-dashboard', 'dist', 'server.js');
const GM_TOKEN = 'gm-secret-token';
const now = new Date().toISOString();

const CANNED = {
  'get-world-info': {
    title: 'Rime of the Frostmaiden',
    system: { id: 'dnd5e', version: '3.3.1' },
    foundry: { version: '12.331' },
    activeUsers: [
      { name: 'DungeonMaster', isGM: true },
      { name: 'Aria', isGM: false },
    ],
  },
  'get-combat-state': {
    success: true,
    active: true,
    round: 2,
    turn: 0,
    current: pc(),
    combatants: [pc(), goblin(), hiddenAssassin()],
  },
  'get-recent-events': {
    success: true,
    latestTimestamp: now,
    events: [
      {
        id: 'ev1',
        timestamp: now,
        timestampMs: Date.parse(now),
        eventType: 'damage',
        actorName: 'Goblin',
        actorId: 'gob1',
        description: 'Goblin took 5 damage',
        details: { amount: 5, from: 12, to: 7, source: 'sword' },
      },
    ],
  },
  'get-module-errors': {
    success: true,
    count: 1,
    errors: [
      {
        id: 'er1',
        timestamp: now,
        timestampMs: Date.parse(now),
        level: 'warn',
        message: 'some-module deprecation warning',
        stack: null,
        module: 'module:some-module',
      },
    ],
  },
};

function pc() {
  return {
    id: 'pc1',
    name: 'Aria',
    initiative: 18,
    isCurrentTurn: true,
    actedThisRound: false,
    hp: { value: 20, max: 24, temp: 0 },
    conditions: [],
    isPC: true,
    category: 'pc',
    defeated: false,
    deathSaves: null,
  };
}
function goblin() {
  return {
    id: 'gob1',
    name: 'Goblin',
    initiative: 12,
    isCurrentTurn: false,
    actedThisRound: false,
    hp: { value: 7, max: 10, temp: 0 },
    conditions: ['prone'],
    isPC: false,
    category: 'enemy',
    defeated: false,
    deathSaves: null,
  };
}
function hiddenAssassin() {
  return {
    id: 'assassin1',
    name: 'Hidden Assassin',
    initiative: 20,
    isCurrentTurn: false,
    actedThisRound: false,
    hp: { value: 30, max: 30, temp: 0 },
    conditions: [],
    isPC: false,
    category: 'enemy',
    defeated: false,
    deathSaves: null,
    hidden: true,
  };
}

let failed = false;
function check(name, cond) {
  if (cond) {
    console.error(`[cogm-split-smoke]   ✓ ${name}`);
  } else {
    failed = true;
    console.error(`[cogm-split-smoke]   ✗ ${name}`);
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Minimal JSON-lines mock bridge: ping / list_tools / call_tool(canned). */
function startMockBridge(port) {
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let buf = '';
    socket.on('data', chunk => {
      buf += chunk.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let req;
        try {
          req = JSON.parse(line);
        } catch {
          continue;
        }
        respond(socket, req);
      }
    });
    socket.on('error', () => {});
  });
  server.destroyAll = () => {
    for (const s of sockets) s.destroy();
    sockets.clear();
  };
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

function respond(socket, req) {
  const { id, method, params } = req;
  let result;
  if (method === 'ping') {
    result = { ok: true };
  } else if (method === 'list_tools') {
    result = { tools: Object.keys(CANNED).map(name => ({ name })) };
  } else if (method === 'call_tool') {
    const canned = CANNED[params?.name] ?? {};
    result = { content: [{ type: 'text', text: JSON.stringify(canned) }] };
  } else {
    socket.write(JSON.stringify({ id, error: { message: `unknown method ${method}` } }) + '\n');
    return;
  }
  socket.write(JSON.stringify({ id, result }) + '\n');
}

/** HTTP request via node:http with keep-alive OFF (no lingering sockets at exit). */
function request(method, url, headers = {}, bodyObj) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = bodyObj === undefined ? undefined : JSON.stringify(bodyObj);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        agent: false, // Connection: close — nothing survives into process teardown
        headers: {
          ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
      },
      res => {
        let data = '';
        res.on('data', d => (data += d));
        res.on('end', () => {
          let body = {};
          try {
            body = JSON.parse(data);
          } catch {
            /* non-JSON */
          }
          resolve({ status: res.statusCode, body });
        });
      }
    );
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

const getJson = (url, headers = {}) => request('GET', url, headers);

async function main() {
  const bridgePort = await freePort();
  const dashPort = await freePort();
  const base = `http://127.0.0.1:${dashPort}`;
  const mock = await startMockBridge(bridgePort);
  console.error(`[cogm-split-smoke] mock bridge on ${bridgePort}, dashboard on ${dashPort}`);

  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      MCP_CONTROL_HOST: '127.0.0.1',
      MCP_CONTROL_PORT: String(bridgePort),
      PORT: String(dashPort),
      GM_DASHBOARD_TOKEN: GM_TOKEN,
      ANTHROPIC_API_KEY: '',
      POLL_INTERVAL_MS: '250',
      COMBAT_POLL_INTERVAL_MS: '250',
      ERROR_POLL_INTERVAL_MS: '250',
      LOG_LEVEL: 'error',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let childErr = '';
  child.stderr.on('data', d => (childErr += d.toString()));
  let exited = false;
  child.on('exit', () => (exited = true));

  const cleanup = () =>
    new Promise(resolve => {
      const finish = () => {
        mock.destroyAll();
        mock.close(() => resolve());
        // mock.close() waits for the server handle; resolve anyway after a beat.
        setTimeout(resolve, 500).unref();
      };
      if (exited) return finish();
      child.once('exit', finish);
      child.kill('SIGKILL'); // hard-kill the test child; no graceful path needed
    });

  try {
    // Wait for the dashboard + for the feed to have polled the mock (world+combat).
    const deadline = Date.now() + 20_000;
    let gm;
    for (;;) {
      try {
        gm = await getJson(`${base}/api/state`, { 'X-CoGM-Token': GM_TOKEN });
        if (gm.status === 200 && gm.body.world && gm.body.combat) break;
      } catch {
        /* server not up yet */
      }
      if (Date.now() >= deadline) {
        await cleanup();
        console.error('[cogm-split-smoke] FAIL: dashboard/feed never populated.\n' + childErr);
        process.exit(1);
      }
      await new Promise(r => setTimeout(r, 250));
    }

    // --- GM view -----------------------------------------------------------
    console.error('[cogm-split-smoke] GM view:');
    const gmGoblin = gm.body.combat.combatants.find(c => c.id === 'gob1');
    check('GM role is gm', gm.body.role === 'gm');
    check('GM sees exact enemy HP', gmGoblin && gmGoblin.hp && gmGoblin.hp.value === 7);
    check('GM sees the hidden combatant', !!gm.body.combat.combatants.find(c => c.id === 'assassin1'));
    check('GM sees module errors', Array.isArray(gm.body.errors) && gm.body.errors.length >= 1);
    check('GM sees settings', !!gm.body.settings);
    check('GM sees GM names', !!gm.body.world.gmNames && gm.body.world.gmNames.includes('DungeonMaster'));
    check('GM event keeps details', (gm.body.events[0]?.details || {}).from === 12);

    // --- Player view (no token) -------------------------------------------
    console.error('[cogm-split-smoke] Player view:');
    const player = await getJson(`${base}/api/state`);
    const plGoblin = player.body.combat.combatants.find(c => c.id === 'gob1');
    const plPc = player.body.combat.combatants.find(c => c.id === 'pc1');
    check('player role is player', player.body.role === 'player');
    check('player enemy HP is nulled', plGoblin && plGoblin.hp === null);
    check('player still sees PC HP', plPc && plPc.hp && plPc.hp.value === 20);
    check('player does NOT see hidden combatant', !player.body.combat.combatants.find(c => c.id === 'assassin1'));
    check('player gets NO module errors', player.body.errors === undefined);
    check('player gets NO settings', player.body.settings === undefined);
    check('player world has NO GM names', player.body.world && player.body.world.gmNames === undefined);
    check('player event details stripped', Object.keys(player.body.events[0]?.details || {}).length === 0);
    check('player still sees public event description', player.body.events[0]?.description === 'Goblin took 5 damage');

    // --- Write surface gated ----------------------------------------------
    console.error('[cogm-split-smoke] Auth gate:');
    const noToken = await request('POST', `${base}/api/tool`, {}, { name: 'get-world-info' });
    check('POST /api/tool without token → 403', noToken.status === 403);
    const askNoToken = await request('POST', `${base}/api/ask`, {}, { question: 'hi' });
    check('POST /api/ask without token → 403', askNoToken.status === 403);
    const ctrlNoToken = await request('POST', `${base}/api/control`, {}, { action: 'pause' });
    check('POST /api/control without token → 403', ctrlNoToken.status === 403);
    // GM token reaches the write surface (read tool → not gated by GM-actions confirm).
    const gmTool = await request(
      'POST',
      `${base}/api/tool`,
      { 'X-CoGM-Token': GM_TOKEN },
      { name: 'get-world-info' }
    );
    check('POST /api/tool with GM token (read) → 200', gmTool.status === 200);

    // --- Player page is served (static, ungated) --------------------------
    console.error('[cogm-split-smoke] Player page:');
    const playerPage = await request('GET', `${base}/player`);
    check('GET /player → 200', playerPage.status === 200);
    const playerJs = await request('GET', `${base}/player.js`);
    check('GET /player.js → 200', playerJs.status === 200);
  } finally {
    await cleanup();
  }

  if (failed) {
    console.error('[cogm-split-smoke] FAIL: one or more checks failed.');
    process.exit(1);
  }
  console.error('[cogm-split-smoke] PASS: server-side player/GM split verified over HTTP.');
  process.exit(0);
}

main().catch(e => {
  console.error('[cogm-split-smoke] FAIL:', e);
  process.exit(1);
});
