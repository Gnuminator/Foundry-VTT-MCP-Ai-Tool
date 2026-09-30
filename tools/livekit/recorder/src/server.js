import http from 'node:http';

/**
 * HTTP front for the handler. `receiver.receive(body, authHeader)` verifies the signature and
 * returns the event. The response is sent as soon as the event is verified; work continues after.
 */
export function createServer({ receiver, handler, log = console }) {
  let queue = Promise.resolve();

  return http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
      return;
    }
    if (req.method !== 'POST' || req.url !== '/webhook') {
      res.writeHead(404).end();
      return;
    }
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      let event;
      try {
        event = await receiver.receive(
          Buffer.concat(chunks).toString('utf8'),
          req.headers.authorization,
        );
      } catch (err) {
        log.warn?.(`rejected webhook: ${err.message}`);
        res.writeHead(401).end();
        return;
      }
      res.writeHead(200).end();
      // One event at a time keeps the session log in order.
      queue = queue
        .then(() => handler.handleEvent(event))
        .then((result) => log.info?.(`${event.event}: ${result?.action}`))
        .catch((err) => log.error?.(`${event.event} failed: ${err.stack ?? err}`));
    });
  });
}
