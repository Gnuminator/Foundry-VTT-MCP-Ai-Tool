// The page server for the project dashboard (D-103). Local only: binds 127.0.0.1, answers
// GET/HEAD for a fixed set of routes, and rejects any request whose Host header is not exactly
// "127.0.0.1:<port>" (blocks DNS rebinding). Node built-ins only.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assertWhitelisted } from './snapshot.mjs';

export const DEFAULT_PORT = 3200;

const PAGE_DIR = fileURLToPath(new URL('./page/', import.meta.url));

// Fixed route map: the URL never takes part in building a file path.
const STATIC_ROUTES = new Map([
  ['/', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/app.js', { file: 'app.js', type: 'text/javascript; charset=utf-8' }],
  ['/style.css', { file: 'style.css', type: 'text/css; charset=utf-8' }],
]);

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'content-security-policy':
    "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:",
  'referrer-policy': 'no-referrer',
};

function send(res, status, body, headers = {}, isHead = false) {
  const buf = Buffer.from(body, 'utf8');
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-length': buf.length,
    ...headers,
  });
  res.end(isHead ? undefined : buf);
}

function sendText(res, status, text, isHead, extra = {}) {
  send(res, status, text + '\n', { 'content-type': 'text/plain; charset=utf-8', ...extra }, isHead);
}

/**
 * Start the dashboard server.
 *
 * Returns the `http.Server` synchronously (it is listening once its 'listening' event has fired;
 * `await once(server, 'listening')` from node:events waits for it). Port 0 picks a free port; read
 * it with `server.address().port`. Throws for ports 31414-31416 (the live Foundry bridge).
 *
 * @param {{ port?: number, host?: string, buildSnapshot: (opts: { withPrs: boolean }) => Promise<object> }} opts
 */
export function startServer({ port = DEFAULT_PORT, host = '127.0.0.1', buildSnapshot } = {}) {
  if (typeof buildSnapshot !== 'function')
    throw new TypeError('startServer needs a buildSnapshot function');
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new RangeError(`Bad port: ${port}`);
  if (port >= 31414 && port <= 31416)
    throw new RangeError(`Port ${port} belongs to the live Foundry bridge`);
  if (host !== '127.0.0.1') throw new RangeError('The project dashboard binds 127.0.0.1 only');

  const server = http.createServer(async (req, res) => {
    const isHead = req.method === 'HEAD';
    try {
      const actualPort = server.address().port;
      if (req.headers.host !== `127.0.0.1:${actualPort}`) {
        return sendText(res, 421, 'Misdirected request', isHead);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendText(res, 405, 'Method not allowed', false, { allow: 'GET, HEAD' });
      }

      let pathname;
      try {
        pathname = new URL(req.url, 'http://127.0.0.1').pathname;
      } catch {
        return sendText(res, 400, 'Bad request', isHead);
      }

      const route = STATIC_ROUTES.get(pathname);
      if (route) {
        let body;
        try {
          body = await readFile(PAGE_DIR + route.file, 'utf8');
        } catch {
          return sendText(res, 500, 'Page file missing', isHead);
        }
        return send(
          res,
          200,
          body,
          { 'content-type': route.type, 'cache-control': 'no-cache' },
          isHead
        );
      }

      if (pathname === '/snapshot.json') {
        let json;
        try {
          const snap = await buildSnapshot({ withPrs: true });
          // The same whitelist check as snapshot.json on disk: nothing else leaves the server.
          assertWhitelisted(snap);
          json = JSON.stringify(snap);
        } catch (err) {
          const msg = String(err?.message ?? err)
            .slice(0, 120)
            .replace(/[\r\n]+/g, ' ');
          return sendText(res, 500, `Snapshot failed: ${msg}`, isHead, {
            'cache-control': 'no-store',
          });
        }
        return send(
          res,
          200,
          json,
          { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
          isHead
        );
      }

      return sendText(res, 404, 'Not found', isHead);
    } catch {
      if (!res.headersSent) sendText(res, 500, 'Server error', false);
      else res.end();
    }
  });

  server.listen(port, host, () => {
    console.log(`Project dashboard: http://127.0.0.1:${server.address().port}/`);
  });
  return server;
}
