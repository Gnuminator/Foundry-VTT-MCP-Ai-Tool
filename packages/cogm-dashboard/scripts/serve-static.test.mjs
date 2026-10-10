// The static server for the story shots (scripts/serve-static.mjs), run as a child process on a
// free port: files are served, a path out of the folder is refused, and a malformed escape in
// the URL gets a 400 instead of taking the server down.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'serve-static.mjs');

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** A raw GET, so the path reaches the server exactly as written (fetch would tidy it). */
function get(port, rawPath) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: rawPath, method: 'GET' }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('serve-static', () => {
  let dir;
  let port;
  let child;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'serve-static-'));
    writeFileSync(path.join(dir, 'index.html'), '<p>hello</p>');
    port = await freePort();
    child = spawn(process.execPath, [script, dir, String(port)], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`server exited early with ${code}`)));
      child.stdout.once('data', resolve);
    });
  });

  afterAll(() => {
    child?.removeAllListeners('exit');
    child?.kill();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('answers /health and serves index.html for the folder', async () => {
    expect((await get(port, '/health')).body).toBe('ok');
    const page = await get(port, '/');
    expect(page.status).toBe(200);
    expect(page.body).toBe('<p>hello</p>');
  });

  it('answers 404 for a missing file and 403 for a path out of the folder', async () => {
    expect((await get(port, '/nope.js')).status).toBe(404);
    expect((await get(port, '/..%2f..%2fsecret')).status).toBe(403);
  });

  it('answers 400 for a malformed escape and keeps serving', async () => {
    expect((await get(port, '/%')).status).toBe(400);
    expect((await get(port, '/%E0%A4%A')).status).toBe(400);
    expect((await get(port, '/health')).status).toBe(200);
  });
});
