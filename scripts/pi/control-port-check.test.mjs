// Tests for control_port_check in scripts/pi/remote/lib.sh (D-095): the check stage 12 runs on the bridge's
// control port before the Cloudflare TCP route points at it.
//   node --test scripts/pi/control-port-check.test.mjs
// A fake bridge (a node TCP server answering the JSON-lines ping) on a free loopback port, a stub `ss` on PATH
// for the listener check, and the real shell function run with bash.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fwd = p => p.replace(/\\/g, '/');
// A PATH entry must not hold a drive-letter colon in Git Bash: C:/x becomes /c/x (a no-op on Linux).
const posix = p => fwd(p).replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);
const lib = fwd(path.join(here, 'remote', 'lib.sh'));

const bashProbe = spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8' });
const noBash = bashProbe.status !== 0 && 'no bash here';

const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A server on a free loopback port; `reply` is what it answers to any data. */
function fakeBridge(reply) {
  return new Promise(resolve => {
    const server = net.createServer(socket => {
      socket.on('data', () => socket.write(reply));
      socket.on('error', () => {});
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/** Runs control_port_check with a stub `ss` that prints `ssOut`; resolves to { stdout, stderr }. */
function check(port, ssOut) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cpc-'));
  dirs.push(dir);
  writeFileSync(path.join(dir, 'ss'), `#!/bin/sh\nprintf '%s' '${ssOut}'\n`);
  chmodSync(path.join(dir, 'ss'), 0o755);
  // Async: the fake bridge lives in this process, so the event loop must stay free while bash runs.
  return new Promise(resolve => {
    const child = spawn(
      'bash',
      [
        '-c',
        `PATH="${posix(dir)}:$PATH"; source "${lib}"; rc=0; control_port_check ${port} || rc=$?; echo "rc=$rc"`,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => (stdout += d));
    child.stderr.on('data', d => (stderr += d));
    child.on('close', () => resolve({ stdout, stderr }));
  });
}

const PONG = '{"id":"ping","result":{"ok":true}}\n';

describe('control_port_check', { skip: noBash }, () => {
  test('0: answers the ping and listens on loopback only', async () => {
    const { server, port } = await fakeBridge(PONG);
    try {
      const r = await check(port, `LISTEN 0 511 127.0.0.1:${port} 0.0.0.0:*\n`);
      assert.match(r.stdout, /rc=0/, r.stdout + r.stderr);
    } finally {
      server.close();
    }
  });

  test('2: a listener beyond loopback is refused before the ping', async () => {
    const { server, port } = await fakeBridge(PONG);
    try {
      const r = await check(port, `LISTEN 0 511 0.0.0.0:${port} 0.0.0.0:*\n`);
      assert.match(r.stdout, /rc=2/, r.stdout + r.stderr);
    } finally {
      server.close();
    }
  });

  test('2: a wildcard IPv6 or star listener is refused too', async () => {
    const { server, port } = await fakeBridge(PONG);
    try {
      for (const local of [`[::]:${port}`, `*:${port}`]) {
        const r = await check(port, `LISTEN 0 511 ${local} 0.0.0.0:*\n`);
        assert.match(r.stdout, /rc=2/, local + r.stdout + r.stderr);
      }
    } finally {
      server.close();
    }
  });

  test('0: an IPv6 loopback listener is fine', async () => {
    const { server, port } = await fakeBridge(PONG);
    try {
      const r = await check(port, `LISTEN 0 511 [::1]:${port} [::]:*\n`);
      assert.match(r.stdout, /rc=0/, r.stdout + r.stderr);
    } finally {
      server.close();
    }
  });

  test('1: nothing answers', async () => {
    const { server, port } = await fakeBridge('');
    server.close();
    const r = await check(port, '');
    assert.match(r.stdout, /rc=1/, r.stdout + r.stderr);
  });
});
