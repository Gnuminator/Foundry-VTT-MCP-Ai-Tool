/**
 * Line reader for the backend's control channel (TCP JSON lines, ARCHITECTURE.md §3a).
 *
 * The channel has no login of its own, so it must never be driven by something that is not a
 * JSON-lines client. A web page can POST to 127.0.0.1:<port> with `mode: 'no-cors'` (a simple
 * request, no preflight): the request line and headers fail to parse, but a body line holding a
 * `call_tool` request would run. Every real client (stdio wrapper, dashboard, tunnel ping, test
 * kit) starts with a JSON object on its first line, so the reader closes the socket when the first
 * non-empty line is not a JSON object, or when a line that is not JSON looks like an HTTP request
 * line. Redis does the same for `POST` and `Host:` (review of PR #344, M1). A header line such as
 * `Host:` is not JSON either, so it closes the socket when it is the first line.
 */
import type { Socket } from 'net';
import type { ControlRequest } from '@gnuminator/shared';

/** Largest unterminated line kept in memory (characters). Tool results are not requests: 8 MiB is generous. */
const MAX_LINE_LENGTH = 8 * 1024 * 1024;

const HTTP_REQUEST_LINE = /^(GET|POST|PUT|HEAD|OPTIONS|DELETE|PATCH|CONNECT|TRACE) /i;
const HTTP_VERSION = / HTTP\/\d/i;

export function looksLikeHttp(line: string): boolean {
  return HTTP_REQUEST_LINE.test(line) || HTTP_VERSION.test(line);
}

interface ControlReaderLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface ControlReader {
  /**
   * Feed a chunk; returns the parsed requests from the complete lines in it. A later line that is
   * not JSON gets a "Bad request" reply and is skipped. A rejected connection returns nothing (the
   * rest of that chunk is dropped too) and the socket is already destroyed.
   */
  read(chunk: string): ControlRequest[];
}

export function createControlReader(socket: Socket, logger?: ControlReaderLogger): ControlReader {
  let buffer = '';
  let seenRequest = false;
  let rejected = false;

  const reject = (reason: string): void => {
    rejected = true;
    buffer = '';
    logger?.warn('Control channel: closed a connection that is not a JSON-lines client', {
      reason,
      remote: socket.remoteAddress,
    });
    socket.destroy();
  };

  return {
    read(chunk: string): ControlRequest[] {
      if (rejected) return [];
      buffer += chunk;

      // No JSON-lines request is anywhere near this size; a longer unterminated line is not a client.
      if (buffer.length > MAX_LINE_LENGTH && buffer.indexOf('\n') < 0) {
        reject('line too long');
        return [];
      }

      const requests: ControlRequest[] = [];
      let idx: number;

      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);

        if (!line) continue;

        // Only a line that is not JSON can be an HTTP request line or header. A valid JSON line may
        // mention " HTTP/1.1" inside a string (a journal text, a note), so it is not checked.
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch (e) {
          if (looksLikeHttp(line)) {
            reject('HTTP request');
            return [];
          }
          if (!seenRequest) {
            reject('first line is not JSON');
            return [];
          }
          socket.write(
            `${JSON.stringify({ error: { message: e instanceof Error ? e.message : 'Bad request' } })}\n`
          );
          continue;
        }

        if (!seenRequest && (parsed === null || typeof parsed !== 'object')) {
          reject('first line is not a JSON object');
          return [];
        }
        seenRequest = true;
        requests.push(parsed as ControlRequest);
      }

      return requests;
    },
  };
}
