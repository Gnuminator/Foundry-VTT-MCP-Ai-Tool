#!/usr/bin/env node
/**
 * Standalone-bridge smoke test (DETACH-PLAN Phase 6 — A).
 *
 * Black-box check that the standalone entrypoint actually serves the control
 * channel as a self-supervised process, WITHOUT binding any live bridge port:
 *
 *   1. find a free TCP port (never 31414/31415/31416)
 *   2. spawn `dist/standalone.js --control-only --port <free>`  (Foundry link off)
 *   3. assert `ping` → { ok: true } and `list_tools` → a non-empty tool catalog
 *   4. SIGTERM the child and confirm it exits
 *
 * Uses its own tiny JSON-lines client (not the entrypoint's own ping helper) so a
 * shared bug can't make the test pass falsely. Run from repo root after a build.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STANDALONE = path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'standalone.js');
const LIVE_PORTS = new Set([31414, 31415, 31416]);

function fail(msg, childErr) {
  console.error(`[standalone-smoke] FAIL: ${msg}`);
  if (childErr) console.error('--- child stderr ---\n' + childErr);
  process.exit(1);
}

/** Ask the OS for a free port (and make sure it's not a live bridge port). */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => (LIVE_PORTS.has(port) ? findFreePort().then(resolve, reject) : resolve(port)));
    });
  });
}

/** One JSON-lines request/response over a fresh socket. */
function controlRequest(host, port, request, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let buffer = '';
    let settled = false;
    const done = (err, result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      err ? reject(err) : resolve(result);
    };
    const timer = setTimeout(() => done(new Error('timeout')), timeoutMs);
    timer.unref();
    socket.on('connect', () => socket.write(JSON.stringify(request) + '\n'));
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      const nl = buffer.indexOf('\n');
      if (nl < 0) return;
      clearTimeout(timer);
      try {
        const frame = JSON.parse(buffer.slice(0, nl));
        frame.error ? done(new Error(frame.error.message || 'error')) : done(null, frame.result);
      } catch (e) {
        done(e);
      }
    });
    socket.on('error', err => {
      clearTimeout(timer);
      done(err);
    });
  });
}

async function waitForPing(host, port, deadlineMs) {
  while (Date.now() < deadlineMs) {
    try {
      const r = await controlRequest(host, port, { id: 'ping', method: 'ping' });
      if (r && r.ok === true) return true;
    } catch {
      /* not up yet */
    }
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

async function main() {
  const host = '127.0.0.1';
  const port = await findFreePort();
  console.error(`[standalone-smoke] using free alternate port ${port} (live ports untouched)`);

  const child = spawn(process.execPath, [STANDALONE, '--control-only', '--port', String(port)], {
    env: { ...process.env, MCP_FOUNDRY_LINK: 'off' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let childErr = '';
  child.stderr.on('data', d => (childErr += d.toString()));
  let exited = false;
  child.on('exit', () => (exited = true));

  try {
    const ready = await waitForPing(host, port, Date.now() + 15_000);
    if (!ready) return fail(`control channel never answered ping on ${host}:${port}`, childErr);
    console.error('[standalone-smoke] ping ok { ok: true }');

    const result = await controlRequest(host, port, { id: 'list', method: 'list_tools' }, 5000);
    const tools = (result && result.tools) || [];
    if (!Array.isArray(tools) || tools.length === 0) {
      return fail(`list_tools returned no tools (got ${JSON.stringify(result).slice(0, 200)})`, childErr);
    }
    const names = tools.map(t => t.name);
    if (!names.includes('get-world-info')) {
      return fail(`tool catalog missing a known tool 'get-world-info' (have ${names.length} tools)`, childErr);
    }
    console.error(`[standalone-smoke] list_tools ok (${tools.length} tools, incl. get-world-info)`);
  } finally {
    if (!exited) child.kill('SIGTERM');
  }

  // Confirm graceful shutdown (force-kill backstop).
  const shutdownDeadline = Date.now() + 5000;
  while (!exited && Date.now() < shutdownDeadline) await new Promise(r => setTimeout(r, 100));
  if (!exited) {
    child.kill('SIGKILL');
    return fail('child did not exit on SIGTERM within 5s', childErr);
  }

  console.error('[standalone-smoke] PASS: standalone backend serves the control channel and exits cleanly.');
  process.exit(0);
}

main().catch(e => fail(e instanceof Error ? e.message : String(e)));
