// A stand-in for Foundry in the test stack (deploy/pi/compose.test.yml): it answers what the compose health check and
// the dependants ask of Foundry, nothing else. Foundry is licensed and never goes into CI.
//   GET /api/status  200 {"active":false,"version":"stand-in"}   (the shape is a subset of Foundry's)
//   anything else    404
// The port comes from FOUNDRY_HTTP_PORT (default 30100), the same variable compose passes to the real service.
import http from 'node:http';

const port = Number(process.env.FOUNDRY_HTTP_PORT || 30100);

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url?.split('?')[0] === '/api/status') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ active: false, version: 'stand-in' }));
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

server.listen(port, '127.0.0.1', () => console.log(`[stand-in-foundry] listening on 127.0.0.1:${port}`));

// Compose stops containers with SIGTERM; node as PID 1 ignores it without a handler.
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
