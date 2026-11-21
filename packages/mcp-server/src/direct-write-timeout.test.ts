/* eslint-disable @typescript-eslint/require-await -- fakes that mimic async module calls */
import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import {
  DIRECT_WRITE_TIMEOUT_MS,
  directWriteLostAnswerMessage,
  isDirectWriteTool,
  runDirectWrite,
} from './direct-write-timeout.js';
import { FoundryConnector } from './foundry-connector.js';
import { makeLogger } from './test-support/stub-tool-deps.js';
import { ErrorHandler } from './utils/error-handler.js';

class FakeSocket extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  sent: any[] = [];
  send = vi.fn((raw: string) => {
    const frame = JSON.parse(raw);
    if (frame.type === 'mcp-query') this.sent.push(frame);
  });
  close = vi.fn();
  say(message: unknown): void {
    this.emit('message', Buffer.from(JSON.stringify(message)));
  }
}

let connector: FoundryConnector;
let socket: FakeSocket;

beforeEach(() => {
  vi.useFakeTimers();
  connector = new FoundryConnector({
    config: { port: 0, namespace: '/' } as any,
    logger: makeLogger(),
  });
  (connector as any).isStarted = true;
  socket = new FakeSocket();
  connector.attachSocket(socket as unknown as WebSocket);
});

afterEach(async () => {
  await connector.stop();
  vi.useRealTimers();
});

describe('direct write timeout truth', () => {
  it('classifies direct writes, not reads, plans or the plan story', () => {
    expect(isDirectWriteTool('send-chat-message', 'write')).toBe(true);
    expect(isDirectWriteTool('advance-combat-turn', 'destructive')).toBe(true);
    expect(isDirectWriteTool('get-party', 'read')).toBe(false);
    expect(isDirectWriteTool('plan-actor-change', 'write')).toBe(false);
    expect(isDirectWriteTool('apply-planned-change', 'destructive')).toBe(false);
    expect(isDirectWriteTool('undo-change', 'destructive')).toBe(false);
    expect(isDirectWriteTool('unknown-tool', undefined)).toBe(false);
  });

  it('waits longer than 10 s and names the uncertainty when nothing answers', async () => {
    const run = runDirectWrite('send-chat-message', () =>
      connector.query('foundry-mcp-bridge.sendChat', {})
    );
    const rejected = expect(run).rejects.toThrow(
      /no answer from Foundry in 30 s.*may or may not have happened.*chat log or the change list before trying again/
    );
    await vi.advanceTimersByTimeAsync(10_001);
    // Past the default timeout the call is still waiting.
    expect(socket.sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(DIRECT_WRITE_TIMEOUT_MS);
    await rejected;
  });

  it('returns a module answer that arrives after the default 10 s', async () => {
    const run = runDirectWrite('send-chat-message', () =>
      connector.query('foundry-mcp-bridge.sendChat', {})
    );
    await vi.advanceTimersByTimeAsync(15_000);
    socket.say({
      type: 'mcp-response',
      id: socket.sent[0].id,
      data: { success: true, data: { ok: true } },
    });
    await expect(run).resolves.toEqual({ ok: true });
  });

  it('leaves a query outside a direct write on the default timeout', async () => {
    const read = connector.query('foundry-mcp-bridge.getParty', {});
    const rejected = expect(read).rejects.toThrow('Query timeout: foundry-mcp-bridge.getParty');
    await vi.advanceTimersByTimeAsync(10_001);
    await rejected;
  });

  it('passes other errors through unchanged', async () => {
    await expect(
      runDirectWrite('send-chat-message', async () => {
        throw new Error('Actor not found');
      })
    ).rejects.toThrow('Actor not found');
  });

  it('finds a lost answer a tool wrapped with ErrorHandler and keeps the honest text', async () => {
    const handler = new ErrorHandler(makeLogger());
    await expect(
      runDirectWrite('create-quest-journal', async () => {
        try {
          throw new Error('Query timeout: foundry-mcp-bridge.createJournal');
        } catch (e) {
          handler.handleToolError(e, 'create-quest-journal');
        }
      })
    ).rejects.toThrow(/no answer from Foundry in 30 s.*may or may not have happened/);
  });

  it('words a closed link without claiming 30 s passed', async () => {
    await expect(
      runDirectWrite('use-item', async () => {
        throw new Error('Connection closed');
      })
    ).rejects.toThrow(
      /no answer from Foundry, the link closed first.*may or may not have happened/
    );
  });

  it('words the message with the seconds waited', () => {
    expect(directWriteLostAnswerMessage('use-item', 45_000)).toContain(
      'no answer from Foundry in 45 s'
    );
  });
});
