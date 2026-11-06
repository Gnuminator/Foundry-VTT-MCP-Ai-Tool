import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { RecorderHealth, SILENCE_MS } from './rec/health.js';
import { startStatusServer } from './status-server.js';

const T = 1_000_000;
const servers: Array<{ close(): void }> = [];
afterEach(() => servers.splice(0).forEach(s => s.close()));

describe('RecorderHealth.problems', () => {
  it('lists a silent speaker every time, and not a muted or departed one', () => {
    const h = new RecorderHealth();
    h.join('u1', 'Mara', false, T);
    h.join('u2', 'Brenna', true, T);
    h.join('u3', 'Aldric', false, T);
    h.leave('u3');
    expect(h.problems(T + SILENCE_MS - 1)).toEqual([]);
    const first = h.problems(T + SILENCE_MS);
    expect(first).toHaveLength(1);
    expect(first[0]?.text).toContain('Mara has not been recorded at all');
    h.silent(T + SILENCE_MS); // the one-time alert does not hide it from the line
    expect(h.problems(T + SILENCE_MS + 1)).toHaveLength(1);
    h.packet('u1', 'Mara', T + SILENCE_MS + 2);
    expect(h.problems(T + SILENCE_MS + 3)).toEqual([]);
  });

  it('shows a stream error until that speaker is heard again', () => {
    const h = new RecorderHealth();
    h.join('u1', 'Mara', false, T);
    h.streamError('u1', 'Mara', 'boom', T);
    expect(h.problems(T + 1)[0]).toMatchObject({ kind: 'stream' });
    h.packet('u1', 'Mara', T + 2);
    expect(h.problems(T + 3)).toEqual([]);
  });

  it('shows a failed rejoin from attempt 3 on, until the bot is back', () => {
    const h = new RecorderHealth();
    h.rejoinFailed(2, T);
    expect(h.problems(T)).toEqual([]);
    h.rejoinFailed(4, T + 1);
    expect(h.problems(T + 2)[0]).toMatchObject({ kind: 'rejoin' });
    expect(h.problems(T + 2)[0]?.text).toContain('attempt 4');
    h.rejoined();
    expect(h.problems(T + 3)).toEqual([]);
  });
});

describe('status endpoint', () => {
  it('answers GET /status with the JSON and nothing else', async () => {
    const server = startStatusServer(
      '127.0.0.1',
      0,
      () => ({
        recording: true,
        problems: [{ kind: 'silent', text: 'Mara has not been recorded' }],
      }),
      () => undefined
    );
    servers.push(server);
    await new Promise<void>(r => server.once('listening', r));
    const port = (server.address() as AddressInfo).port;
    const ok = await fetch(`http://127.0.0.1:${port}/status`);
    expect(await ok.json()).toEqual({
      recording: true,
      problems: [{ kind: 'silent', text: 'Mara has not been recorded' }],
    });
    expect((await fetch(`http://127.0.0.1:${port}/other`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/status`, { method: 'POST' })).status).toBe(404);
  });
});
