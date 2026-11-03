// Tests for deploy/pi/healthcheck.mjs: the container health checks, against small fake servers.
//   node --test deploy/pi/healthcheck.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { controlPing, httpOk, processRunning, run } from './healthcheck.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dirs = [];
after(() => dirs.forEach(d => rmSync(d, { recursive: true, force: true })));

function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

describe('healthcheck', () => {
  test('http: 2xx is healthy, 500 and a closed port are not', async () => {
    const server = http.createServer((req, res) => {
      res.statusCode = req.url === '/ok' ? 200 : 500;
      res.end('x');
    });
    const port = await listen(server);
    assert.equal(await httpOk(`http://127.0.0.1:${port}/ok`), null);
    assert.equal(await httpOk(`http://127.0.0.1:${port}/bad`), 'HTTP 500');
    server.close();
    assert.match(await httpOk(`http://127.0.0.1:${port}/ok`), /ECONN/);
  });

  test('control: an ok ping is healthy, other answers and silence are not', async () => {
    const good = net.createServer(s => s.on('data', () => s.write('{"id":"ping","ok":true}\n')));
    const odd = net.createServer(s => s.on('data', () => s.write('{"id":"ping","ok":false}\n')));
    const goodPort = await listen(good);
    const oddPort = await listen(odd);
    assert.equal(await controlPing(goodPort), null);
    assert.match(await controlPing(oddPort), /not ok/);
    good.close();
    odd.close();
    assert.match(await controlPing(goodPort), /ECONNREFUSED/);
  });

  test('process: finds a command line in a fake /proc and says when there is none', () => {
    const proc = mkdtempSync(path.join(os.tmpdir(), 'hc-'));
    dirs.push(proc);
    mkdirSync(path.join(proc, '41'));
    writeFileSync(path.join(proc, '41', 'cmdline'), 'node\0/app/gm-browser/assistant-gm.mjs\0run\0');
    mkdirSync(path.join(proc, 'self'));
    assert.equal(processRunning('assistant-gm.mjs', proc), null);
    assert.match(processRunning('nothing-like-this', proc), /no process/);
  });

  test('run: usage errors are unhealthy, and the CLI exits 1 with the reason on stderr', async () => {
    assert.match(await run([]), /usage/);
    assert.match(await run(['control', 'abc']), /usage/);
    const r = spawnSync(process.execPath, [path.join(here, 'healthcheck.mjs'), 'http', 'http://127.0.0.1:1/'], {
      encoding: 'utf8',
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^unhealthy: /);
  });
});
