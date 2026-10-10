// A tiny static file server for a built folder, for the story shots (web/visual/stories.spec.ts):
//
//   node scripts/serve-static.mjs <folder> <port>
//
// Listens on 127.0.0.1 only, serves files under the folder (no listing, no escape from it) and
// answers GET /health, which Playwright's webServer waits for. Nothing else is needed from a
// server: Storybook's build is plain files with relative URLs.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const [folderArg, portArg] = process.argv.slice(2);
if (!folderArg || !portArg) {
  console.error('Usage: node scripts/serve-static.mjs <folder> <port>');
  process.exit(2);
}
const root = path.resolve(folderArg);
const port = Number(portArg);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
      return;
    }
    let file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep) && file !== root) {
      res.writeHead(403).end();
      return;
    }
    try {
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
      const body = await readFile(file);
      res
        .writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
        .end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  })();
});

server.listen(port, '127.0.0.1', () => console.log(`Serving ${root} on http://127.0.0.1:${port}`));
