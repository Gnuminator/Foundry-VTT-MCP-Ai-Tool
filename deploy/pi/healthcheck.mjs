// Container health checks for the Pi stack (deploy/pi/compose.yml). Exit 0 = healthy, 1 = not.
//   node healthcheck.mjs http <url>        any 2xx within 5 s (Foundry /api/status, dashboard /api/health)
//   node healthcheck.mjs control <port>    the bridge's control port answers a JSON-lines ping on loopback
//   node healthcheck.mjs process <text>    a running process whose command line contains <text> (the Assistant GM)
// Dependency-free so the same file runs in every image. The reason for a failure goes to stderr (docker inspect
// shows it in the health log).
import { readdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';

const TIMEOUT_MS = 5000;

// A refused connection on Node 24 is an AggregateError with an empty message but a code.
const reasonOf = e => e.code || e.message || String(e);

export function httpOk(url) {
  return new Promise(resolve => {
    const req = http.get(url, { timeout: TIMEOUT_MS }, res => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 300 ? null : `HTTP ${res.statusCode}`);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(`no answer from ${url} in ${TIMEOUT_MS / 1000} s`);
    });
    req.on('error', e => resolve(reasonOf(e)));
  });
}

export function controlPing(port, host = '127.0.0.1') {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port });
    let buffer = '';
    const done = reason => {
      socket.destroy();
      resolve(reason);
    };
    socket.setTimeout(TIMEOUT_MS, () => done(`no ping answer on ${host}:${port}`));
    socket.on('connect', () => socket.write('{"id":"ping","method":"ping"}\n'));
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      if (!buffer.includes('\n')) return;
      done(buffer.includes('"ok":true') ? null : 'the control port answered, but not ok');
    });
    socket.on('error', e => done(reasonOf(e)));
  });
}

export function processRunning(text, procDir = '/proc') {
  let entries;
  try {
    entries = readdirSync(procDir);
  } catch (e) {
    return `cannot read ${procDir}: ${e.message}`;
  }
  for (const pid of entries) {
    if (!/^\d+$/.test(pid) || Number(pid) === process.pid) continue;
    try {
      const cmd = readFileSync(`${procDir}/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
      if (cmd.includes(text)) return null;
    } catch {
      // the process ended while we looked
    }
  }
  return `no process with "${text}" in its command line`;
}

export async function run(argv) {
  const [kind, arg] = argv;
  if (kind === 'http' && arg) return httpOk(arg);
  if (kind === 'control' && /^\d+$/.test(arg ?? '')) return controlPing(Number(arg));
  if (kind === 'process' && arg) return processRunning(arg);
  return 'usage: healthcheck.mjs http <url> | control <port> | process <text>';
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('healthcheck.mjs')) {
  const reason = await run(process.argv.slice(2));
  if (reason) {
    process.stderr.write(`unhealthy: ${reason}\n`);
    process.exit(1);
  }
}
