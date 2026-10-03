// A small OBS WebSocket (protocol v5, built into OBS 28+) client on Node 22's
// built-in WebSocket. Only what the demo takes need: identify with the password,
// send requests, and wait for an event. Protocol reference:
// https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md

import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';

const OP = { Hello: 0, Identify: 1, Identified: 2, Event: 5, Request: 6, RequestResponse: 7 };

/** The v5 auth string: base64(sha256(base64(sha256(password + salt)) + challenge)). */
export function obsAuth(password, salt, challenge) {
  const secret = createHash('sha256')
    .update(password + salt)
    .digest('base64');
  return createHash('sha256')
    .update(secret + challenge)
    .digest('base64');
}

export class ObsClient {
  /** @param {WebSocket} ws */
  constructor(ws) {
    this.ws = ws;
    /** @type {Map<string, {resolve: Function, reject: Function, type: string}>} */
    this.pending = new Map();
    /** @type {Set<(event: {eventType: string, eventData: any}) => void>} */
    this.listeners = new Set();
  }

  /**
   * Connect and identify. Resolves once OBS answers Identified.
   * @param {{port?: number, password?: string, timeoutMs?: number}} opts
   */
  static connect({ port = 4455, password = '', timeoutMs = 5000 } = {}) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      const client = new ObsClient(ws);
      const timer = setTimeout(() => {
        ws.close();
        reject(
          new Error(`OBS WebSocket on port ${port}: no answer in ${timeoutMs} ms (is OBS running?)`)
        );
      }, timeoutMs);
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error(`OBS WebSocket on port ${port}: cannot connect (is OBS running?)`));
      });
      ws.addEventListener('close', ev => {
        clearTimeout(timer);
        const why = ev.code === 4009 ? 'wrong password' : `closed (${ev.code})`;
        for (const p of client.pending.values()) p.reject(new Error(`OBS WebSocket ${why}`));
        client.pending.clear();
        reject(new Error(`OBS WebSocket ${why}`));
      });
      ws.addEventListener('message', ev => {
        const msg = JSON.parse(String(ev.data));
        if (msg.op === OP.Hello) {
          const d = { rpcVersion: 1, eventSubscriptions: 1 << 6 /* Outputs */ };
          if (msg.d.authentication) {
            const { salt, challenge } = msg.d.authentication;
            d.authentication = obsAuth(password, salt, challenge);
          }
          ws.send(JSON.stringify({ op: OP.Identify, d }));
        } else if (msg.op === OP.Identified) {
          clearTimeout(timer);
          resolve(client);
        } else if (msg.op === OP.RequestResponse) {
          const p = client.pending.get(msg.d.requestId);
          if (!p) return;
          client.pending.delete(msg.d.requestId);
          const status = msg.d.requestStatus;
          if (status.result) p.resolve(msg.d.responseData ?? {});
          else p.reject(new Error(`OBS ${p.type}: ${status.comment ?? `code ${status.code}`}`));
        } else if (msg.op === OP.Event) {
          for (const fn of client.listeners) fn(msg.d);
        }
      });
    });
  }

  /** Send one request; resolves with its responseData. */
  call(requestType, requestData = {}) {
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, type: requestType });
      this.ws.send(JSON.stringify({ op: OP.Request, d: { requestType, requestId, requestData } }));
    });
  }

  /** Resolve with the data of the first event of this type that passes the test. */
  waitForEvent(eventType, test = () => true, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(fn);
        reject(new Error(`OBS: no ${eventType} event in ${timeoutMs} ms`));
      }, timeoutMs);
      const fn = ev => {
        if (ev.eventType !== eventType || !test(ev.eventData)) return;
        clearTimeout(timer);
        this.listeners.delete(fn);
        resolve(ev.eventData);
      };
      this.listeners.add(fn);
    });
  }

  setScene(sceneName) {
    return this.call('SetCurrentProgramScene', { sceneName });
  }

  /** Start recording into a folder; resolves once the output runs. */
  async startRecord(directory) {
    if (directory) {
      // OBS stops at once with "bad output path" when the folder is missing.
      mkdirSync(directory, { recursive: true });
      await this.call('SetRecordDirectory', { recordDirectory: directory });
    }
    await this.call('StartRecord');
    for (let i = 0; i < 50; i++) {
      if ((await this.call('GetRecordStatus')).outputActive) return;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('OBS did not start recording (see the OBS log: Help > Log Files).');
  }

  /** Stop recording; resolves with the finished file's path once it is written. */
  async stopRecord() {
    const stopped = this.waitForEvent(
      'RecordStateChanged',
      d => d.outputState === 'OBS_WEBSOCKET_OUTPUT_STOPPED',
      120000
    );
    const { outputPath } = await this.call('StopRecord');
    await stopped;
    return outputPath;
  }

  close() {
    this.ws.close();
  }
}
