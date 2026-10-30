/** Gzip for the React build's hashed files (I-098): only what is safe to cache, only when asked. */
import express from 'express';
import rateLimit from 'express-rate-limit';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { tmpdir } from 'os';
import * as path from 'path';
import { gunzipSync } from 'zlib';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { gzipAssets, sendJsonGzip } from './gzip-assets.js';

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
  writeFileSync(path.join(dir, 'assets', 'style-abc.css'), 'a { color: red; }\n'.repeat(200));
  writeFileSync(path.join(dir, 'assets', 'UP-abc.JS'), BIG_JS);
  writeFileSync(path.join(dir, 'secret.js'), BIG_JS);
  writeFileSync(path.join(dir, 'old.css'), 'a { color: red; }\n'.repeat(200));
  writeFileSync(path.join(dir, 'old.js'), BIG_JS);
  const app = express();
  // The old pages' stylesheets: css only, revalidated, headers hook still runs.
  app.use(
    '/pub',
    gzipAssets(dir, {
      extensions: ['.css'],
      cacheControl: 'public, max-age=0',
      setHeaders: res => res.setHeader('X-Page-Header', 'kept'),
    })
  );
  app.use('/pub', (_req, res) => res.status(404).send('fell through'));
  app.get('/json/:size', (req, res) => {
    void sendJsonGzip(req, res, { text: 'x'.repeat(Number(req.params.size)) });
  });
  // The dashboard mounts it behind the same kind of limiter (app.ts).
  const limit = rateLimit({ windowMs: 10_000, limit: 1000, validate: false });
  app.use('/next/assets', limit, gzipAssets(path.join(dir, 'assets')));
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

describe('gzipAssets for unhashed files', () => {
  it('gzips css only, revalidates, and still runs the page headers hook', async () => {
    const css = await get('/pub/old.css', { 'Accept-Encoding': 'gzip' });
    expect(css.headers['content-encoding']).toBe('gzip');
    expect(css.headers['cache-control']).toBe('public, max-age=0');
    expect(css.headers['x-page-header']).toBe('kept');
    expect(gunzipSync(css.body).toString()).toContain('color: red');
    const js = await get('/pub/old.js', { 'Accept-Encoding': 'gzip' });
    expect(js.body.toString()).toBe('fell through');
    const plain = await get('/pub/old.css', { 'Accept-Encoding': 'identity' });
    expect(plain.body.toString()).toBe('fell through');
  });
});

describe('sendJsonGzip', () => {
  it('gzips a big answer for a browser that accepts it', async () => {
    const a = await get('/json/5000', { 'Accept-Encoding': 'gzip' });
    expect(a.headers['content-encoding']).toBe('gzip');
    expect(a.headers['content-type']).toContain('application/json');
    expect(a.headers['vary']).toContain('Accept-Encoding');
    expect(JSON.parse(gunzipSync(a.body).toString())).toEqual({ text: 'x'.repeat(5000) });
  });

  it('sends plain JSON without gzip or for a small answer', async () => {
    const plain = await get('/json/5000', { 'Accept-Encoding': 'identity' });
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(JSON.parse(plain.body.toString()).text.length).toBe(5000);
    const small = await get('/json/10', { 'Accept-Encoding': 'gzip' });
    expect(small.headers['content-encoding']).toBeUndefined();
    expect(JSON.parse(small.body.toString()).text).toBe('x'.repeat(10));
  });
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
    const paths = [
      '/next/assets/..%2Fsecret.js',
      '/next/assets/%2e%2e/secret.js',
      '/next/assets/..%5Csecret.js',
      '/next/assets/%252e%252e/secret.js',
      '/next/assets/%zz.js',
      '/next/assets/big-abc.js%00.js',
    ];
    for (const p of paths) {
      const a = await get(p, { 'Accept-Encoding': 'gzip' });
      expect(a.headers['content-encoding']).toBeUndefined();
      expect(a.body.toString()).not.toContain('hello hello');
    }
  });

  it('treats gzip;q=0 as a refusal', async () => {
    const a = await get('/next/assets/big-abc.js', { 'Accept-Encoding': 'gzip;q=0' });
    expect(a.body.toString()).toBe('fell through');
  });

  it('answers HEAD without a body and serves css and upper-case extensions', async () => {
    const head = await new Promise<http.IncomingHttpHeaders>((resolve, reject) => {
      http
        .request(
          {
            host: '127.0.0.1',
            port,
            path: '/next/assets/big-abc.js',
            method: 'HEAD',
            headers: { 'Accept-Encoding': 'gzip' },
          },
          res => {
            res.resume();
            res.on('end', () => resolve(res.headers));
          }
        )
        .on('error', reject)
        .end();
    });
    expect(head['content-encoding']).toBe('gzip');
    const css = await get('/next/assets/style-abc.css', { 'Accept-Encoding': 'gzip' });
    expect(css.headers['content-type']).toContain('text/css');
    const upper = await get('/next/assets/UP-abc.JS', { 'Accept-Encoding': 'gzip' });
    expect(upper.headers['content-encoding']).toBe('gzip');
  });

  it('answers a conditional request with 304 and recompresses a changed file', async () => {
    const first = await get('/next/assets/big-abc.js', { 'Accept-Encoding': 'gzip' });
    const etag = first.headers['etag'] as string;
    expect(etag).toBeTruthy();
    const cond = await get('/next/assets/big-abc.js', {
      'Accept-Encoding': 'gzip',
      'If-None-Match': etag,
    });
    expect(cond.status).toBe(304);
    expect(cond.body.length).toBe(0);
    const changing = path.join(dir, 'assets', 'changing-abc.js');
    writeFileSync(changing, BIG_JS);
    const one = await get('/next/assets/changing-abc.js', { 'Accept-Encoding': 'gzip' });
    writeFileSync(changing, `${BIG_JS}// more changed text\n`.repeat(2));
    const two = await get('/next/assets/changing-abc.js', { 'Accept-Encoding': 'gzip' });
    expect(gunzipSync(two.body).toString()).toContain('more changed text');
    expect(two.headers['etag']).not.toBe(one.headers['etag']);
  });
});
