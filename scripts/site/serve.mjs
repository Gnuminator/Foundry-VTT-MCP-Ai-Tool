#!/usr/bin/env node
/** Local preview of the showcase page: builds standalone into build/site-preview and serves it on 4173. */
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(repo, 'build', 'site-preview');
execFileSync(
  process.execPath,
  [path.join(repo, 'scripts/site/build.mjs'), '--standalone', '--out', out],
  {
    stdio: 'inherit',
  }
);
const TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};
const port = Number(process.env.PORT ?? 4173);
createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(out, path.normalize(rel));
  if (!file.startsWith(out)) return void res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res
      .writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
      .end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`showcase preview on http://127.0.0.1:${port}/`));
