/**
 * The bot's small status endpoint (item health-line-dots): the dashboard's health line asks it
 * whether a recording runs and what is wrong with it. Read only, no secrets, no audio, one JSON
 * document. Off unless `FOUNDRY_AI_BOT_STATUS_PORT` is set; it listens on `FOUNDRY_AI_BOT_STATUS_HOST`
 * (default 127.0.0.1), which on the Pi network is the Pi's LAN address and nothing else, never a
 * port forwarded to the internet.
 */
import { createServer, type Server } from 'node:http';

import type { RecorderProblem } from './rec/health.js';

export interface BotStatus {
  /** A recording is running right now. */
  recording: boolean;
  /** What is wrong, in plain words; empty when all is well or nothing records. */
  problems: RecorderProblem[];
}

export function startStatusServer(
  host: string,
  port: number,
  read: () => BotStatus,
  onError: (err: Error) => void
): Server {
  const server = createServer((req, res) => {
    if (req.method !== 'GET' || (req.url ?? '').split('?')[0] !== '/status') {
      res.writeHead(404).end();
      return;
    }
    let body: string;
    try {
      body = JSON.stringify(read());
    } catch (err) {
      onError(err as Error);
      res.writeHead(500).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(body);
  });
  server.on('error', onError);
  server.listen(port, host);
  return server;
}
