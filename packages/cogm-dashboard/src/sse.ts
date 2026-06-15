import type { Response } from 'express';
import type { Logger } from './logger.js';
import type { Role } from './auth.js';

/**
 * A per-client redactor: given a broadcast payload and the client's role, return
 * the payload that client should receive, or `undefined` to send them nothing
 * (used for GM-only events, and for player-side redaction). See redact.ts.
 */
export type SseRedactor = (payload: unknown, role: Role) => unknown;

/**
 * Tiny Server-Sent Events hub. Each connected dashboard tab is a long-lived
 * `text/event-stream` response; the server pushes named events to all of them.
 * A periodic comment-line heartbeat keeps proxies and browsers from closing an
 * idle connection.
 *
 * Each client carries a **role** (Phase 6). `broadcast` can take a redactor that
 * computes the per-role payload server-side, so a player's stream never carries
 * GM-only data — the filtering is here, not in the browser.
 */
export class SseHub {
  private readonly clients = new Map<Response, Role>();
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child('sse');
  }

  add(res: Response, role: Role = 'gm'): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    this.clients.set(res, role);
    this.logger.debug('Client connected', { clients: this.clients.size, role });

    res.on('close', () => {
      this.clients.delete(res);
      this.logger.debug('Client disconnected', { clients: this.clients.size });
    });

    if (!this.heartbeat) {
      this.heartbeat = setInterval(() => this.ping(), 15000);
      this.heartbeat.unref();
    }
  }

  /** End every client stream and stop the heartbeat (for a clean shutdown). */
  close(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    for (const res of this.clients.keys()) {
      try {
        res.end();
      } catch {
        // already closed
      }
    }
    this.clients.clear();
  }

  /** Send to a single client (used for the initial snapshot on connect). */
  send(res: Response, type: string, payload: unknown): void {
    try {
      res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch {
      this.clients.delete(res);
    }
  }

  /**
   * Broadcast a named event to every connected client. With a `redactor`, each
   * client receives the role-specific payload; a redactor returning `undefined`
   * skips that client entirely (GM-only events). The redactor runs at most once
   * per distinct role per broadcast.
   */
  broadcast(type: string, payload: unknown, redactor?: SseRedactor): void {
    const perRole = new Map<Role, string | null>();
    const frameFor = (role: Role): string | null => {
      if (perRole.has(role)) return perRole.get(role)!;
      const value = redactor ? redactor(payload, role) : payload;
      const frame =
        value === undefined ? null : `event: ${type}\ndata: ${JSON.stringify(value)}\n\n`;
      perRole.set(role, frame);
      return frame;
    };

    for (const [res, role] of this.clients) {
      const frame = frameFor(role);
      if (frame === null) continue;
      try {
        res.write(frame);
      } catch {
        this.clients.delete(res);
      }
    }
  }

  private ping(): void {
    for (const res of this.clients.keys()) {
      try {
        res.write(': ping\n\n');
      } catch {
        this.clients.delete(res);
      }
    }
  }

  get size(): number {
    return this.clients.size;
  }
}
