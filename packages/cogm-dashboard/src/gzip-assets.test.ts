/** Gzip for the React build's hashed files (I-098): only what is safe to cache, only when asked. */
import express from 'express';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { tmpdir } from 'os';
import * as path from 'path';
import { gunzipSync } from 'zlib';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { gzipAssets } from './gzip-assets.js';

const BIG_JS = 'export const x = "hello hello hello";\n'.repeat(200);

let dir: string;
let server: http.Server;
let port: number;

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

function get(urlPath: string, headers: http.OutgoingHttpHeaders = {}): Promise<Answer> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: urlPath, headers }, res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          })
        );
      })
      .on('error', reject);
  });
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'gzip-assets-'));
  mkdirSync(path.join(dir, 'assets'));
  writeFileSync(path.join(dir, 'assets', 'big-abc.js'), BIG_JS);
  writeFileSync(path.join(dir, 'assets', 'tiny-abc.js'), 'x');
  writeFileSync(path.join(dir, 'secret.js'), BIG_JS);
  const app = express();
  app.use('/next/assets', gzipAssets(path.join(dir, 'assets')));
  app.use('/next', (_req, res) => res.status(404).send('fell through'));
  await new Promise<void>(resolve => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

describe('gzipAssets', () => {
  it('sends a gzipped copy to a browser that accepts it', async () => {
    const a = await get('/next/assets/big-abc.js', { 'Accept-Encoding': 'gzip, deflate' });
    expect(a.status).toBe(200);
    expect(a.headers['content-encoding']).toBe('gzip');
    expect(a.headers['vary']).toBe('Accept-Encoding');
    expect(a.headers['cache-control']).toContain('immutable');
    expect(a.headers['content-type']).toContain('text/javascript');
    expect(a.body.length).toBeLessThan(BIG_JS.length / 4);
    expect(gunzipSync(a.body).toString()).toBe(BIG_JS);
    const again = await get('/next/assets/big-abc.js', { 'Accept-Encoding': 'gzip' });
    expect(again.body.equals(a.body)).toBe(true);
  });

  it('falls through without Accept-Encoding, for tiny files and for unknown ones', async () => {
    for (const p of ['big-abc.js', 'tiny-abc.js', 'missing.js']) {
      const a = await get(`/next/assets/${p}`, { 'Accept-Encoding': 'identity' });
      expect(a.body.toString()).toBe('fell through');
    }
    const noHeader = await get('/next/assets/big-abc.js', { 'Accept-Encoding': '' });
    expect(noHeader.body.toString()).toBe('fell through');
    const tiny = await get('/next/assets/tiny-abc.js', { 'Accept-Encoding': 'gzip' });
    expect(tiny.body.toString()).toBe('fell through');
  });

  it('never leaves the assets folder', async () => {
    for (const p of ['/next/assets/..%2Fsecret.js', '/next/assets/%2e%2e/secret.js']) {
      const a = await get(p, { 'Accept-Encoding': 'gzip' });
      expect(a.headers['content-encoding']).toBeUndefined();
    }
  });
});
