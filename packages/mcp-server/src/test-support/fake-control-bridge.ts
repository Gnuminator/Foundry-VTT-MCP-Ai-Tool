/**
 * A fake control channel for tests that start the built stdio wrapper (`dist/index.js`): the
 * newline-delimited JSON the wrapper dials on `MCP_CONTROL_PORT`, answering `list_tools` and
 * `call_tool` without Foundry.
 */
import * as net from 'node:net';

// Deliberately not alphabetical: the order we serve is the bridge's order, and it must not move.
export const FAKE_TOOLS = [
  'search-journals',
  'get-world-info',
  'list-characters',
  'get-character',
].map(name => ({
  name,
  description: `Fake ${name}`,
  inputSchema: { type: 'object', properties: {} },
}));

/** `failList` answers `list_tools` with an error, to exercise the wrapper's failure path. */
export function startFakeBridge(
  opts: { failList?: boolean } = {}
): Promise<{ server: net.Server; port: number }> {
  return new Promise(resolve => {
    const server = net.createServer(sock => {
      let buf = '';
      sock.setEncoding('utf8');
      sock.on('error', () => {});
      sock.on('data', (chunk: string) => {
        buf += chunk;
        let idx: number;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          let req: { id: string; method: string };
          try {
            req = JSON.parse(line) as { id: string; method: string };
          } catch {
            continue;
          }
          if (opts.failList && req.method === 'list_tools') {
            sock.write(`${JSON.stringify({ id: req.id, error: { message: 'bridge down' } })}\n`);
            continue;
          }
          const result =
            req.method === 'list_tools'
              ? { tools: FAKE_TOOLS }
              : { content: [{ type: 'text', text: 'fake result' }] };
          sock.write(`${JSON.stringify({ id: req.id, result })}\n`);
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as net.AddressInfo).port });
    });
  });
}
