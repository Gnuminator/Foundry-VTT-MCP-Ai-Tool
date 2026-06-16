/**
 * Minimal JSON-lines control-channel probe.
 *
 * A tiny, dependency-free client for the backend's control channel (the same
 * protocol the stdio wrapper and dashboard speak — see ARCHITECTURE.md §3a). It
 * exists so the standalone entrypoint can print an honest "control channel ready"
 * banner, and so the standalone smoke test can assert `ping` / `list_tools` over
 * the wire without pulling in the dashboard's full reconnecting client.
 *
 * Read-only and never-spawning: it connects, sends one request, reads one reply,
 * and closes. It does not retry or keep the socket open.
 */
import net from 'net';

interface ControlRequest {
  id: string;
  method: 'ping' | 'list_tools';
  params?: Record<string, unknown>;
}

/** Send a single control request and resolve with the parsed `result` (or reject). */
function sendControlRequest(
  host: string,
  port: number,
  request: ControlRequest,
  timeoutMs: number
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let buffer = '';
    let settled = false;

    const done = (err: Error | null, result?: unknown): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve(result);
    };

    const timer = setTimeout(
      () => done(new Error(`control request timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
    timer.unref();

    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      clearTimeout(timer);
      try {
        const frame = JSON.parse(line) as { result?: unknown; error?: { message?: string } };
        if (frame.error) done(new Error(frame.error.message || 'control error'));
        else done(null, frame.result);
      } catch (e) {
        done(e instanceof Error ? e : new Error('bad control frame'));
      }
    });
    socket.on('error', err => {
      clearTimeout(timer);
      done(err);
    });
  });
}

/** Resolve true once the control channel answers a `ping` (retrying until `timeoutMs`). */
export async function waitForControlChannel(
  host: string,
  port: number,
  timeoutMs = 10_000,
  intervalMs = 250
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const result = (await sendControlRequest(
        host,
        port,
        { id: 'ping', method: 'ping' },
        1000
      )) as {
        ok?: boolean;
      };
      if (result && result.ok === true) return true;
    } catch {
      // not up yet
    }
    if (Date.now() >= deadline) return false;
    await new Promise(r => setTimeout(r, intervalMs).unref());
  }
}

/** Fetch the tool catalog over the control channel (single request). */
export async function listToolsOverControl(
  host: string,
  port: number,
  timeoutMs = 5_000
): Promise<Array<{ name: string }>> {
  const result = (await sendControlRequest(
    host,
    port,
    { id: 'list', method: 'list_tools' },
    timeoutMs
  )) as { tools?: Array<{ name: string }> };
  return result?.tools ?? [];
}
