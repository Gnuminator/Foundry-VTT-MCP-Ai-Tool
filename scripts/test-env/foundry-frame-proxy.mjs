// Dev only (item gm-page-wrapper): lets the test dashboard's GM page (/gm) frame the test Foundry.
// Foundry 14 sends `X-Frame-Options: DENY`; this proxy sits in front of the test server and does
// what the Cloudflare response-header rule does on the Pi: removes that header and sets
// `Content-Security-Policy: frame-ancestors <dashboard origin>`. Never part of the production path.
//
//   node scripts/test-env/foundry-frame-proxy.mjs [--listen 30091] [--target 30001] [--dashboard http://localhost:3100]
//
// Point the test dashboard's DASHBOARD_FOUNDRY_URL at http://localhost:30091. It refuses the live
// ports (31414-31416) and the rehearsal ports (30100, 31614, 31615, 3300), as a dev session must.
import http from 'node:http';
import net from 'node:net';

export const FORBIDDEN_PORTS = [31414, 31415, 31416, 30100, 31614, 31615, 3300];

/** The headers of a Foundry response with the frame rules replaced. */
export function rewriteHeaders(headers, dashboardOrigin) {
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (lower === 'x-frame-options' || lower === 'content-security-policy') continue;
    out[name] = value;
  }
  out['content-security-policy'] = `frame-ancestors ${dashboardOrigin}`;
  return out;
}

/** An error text when the port is not one a dev session may use, else null. */
export function portProblem(port, label) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return `${label} is not a port: ${port}`;
  if (FORBIDDEN_PORTS.includes(port)) return `${label} ${port} is a live or rehearsal port`;
  return null;
}

export function createProxy({ listen, target, dashboard }) {
  const server = http.createServer((req, res) => {
    const upstream = http.request(
      { host: '127.0.0.1', port: target, method: req.method, path: req.url, headers: req.headers },
      response => {
        res.writeHead(
          response.statusCode ?? 502,
          rewriteHeaders(response.headers, new URL(dashboard).origin)
        );
        response.pipe(res);
      }
    );
    upstream.on('error', () => {
      res.writeHead(502).end('The test Foundry does not answer.');
    });
    req.pipe(upstream);
  });
  // Foundry's socket.io upgrades to a websocket: pass the bytes through untouched.
  server.on('upgrade', (req, socket, head) => {
    const upstream = net.connect(target, '127.0.0.1', () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      }
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length > 0) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    const close = () => {
      socket.destroy();
      upstream.destroy();
    };
    upstream.on('error', close);
    socket.on('error', close);
  });
  return server;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const listen = Number(arg('listen', '30091'));
  const target = Number(arg('target', '30001'));
  const dashboard = arg('dashboard', 'http://localhost:3100');
  const problem = portProblem(listen, 'listen port') ?? portProblem(target, 'target port');
  if (problem) {
    console.error(`foundry-frame-proxy: ${problem}`);
    process.exit(2);
  }
  createProxy({ listen, target, dashboard }).listen(listen, '127.0.0.1', () => {
    console.log(
      `foundry-frame-proxy: 127.0.0.1:${listen} -> 127.0.0.1:${target}, frames: ${dashboard}`
    );
  });
}
