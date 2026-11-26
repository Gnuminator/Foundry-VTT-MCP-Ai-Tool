import { describe, expect, it, vi } from 'vitest';

import { createOmensPoster, omenMessage } from './omens-post.js';

function bodyOf(init?: RequestInit): string {
  return typeof init?.body === 'string' ? init.body : '';
}

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('omens poster', () => {
  it('claims, sends to the claimed recipient only, and reports the result', async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace('http://dash', '');
      calls.push(`${init?.method ?? 'GET'} ${path} ${bodyOf(init)}`);
      if (path === '/api/omens/outbox') return reply({ items: [{ id: 'o1', discordId: '999' }] });
      if (path === '/api/omens/claim') {
        return reply({ item: { id: 'o1', discordId: '111111111111111111', text: 'Hello' } });
      }
      return reply({ omen: {} });
    });
    const send = vi.fn(async () => true);
    const check = createOmensPoster({
      dashboardUrl: 'http://dash/',
      gmToken: 't',
      send,
      fetch: fetchFn as unknown as typeof fetch,
    });
    expect(await check()).toBe(1);
    // The outbox's own discordId is ignored; the claim decides the recipient.
    expect(send).toHaveBeenCalledWith('111111111111111111', omenMessage('Hello'));
    expect(calls[calls.length - 1]).toBe(
      'POST /api/omens/finish {"id":"o1","ok":true,"error":"Discord did not take the message"}'
    );
  });

  it('reports a failed send as not ok and sends nothing when the claim is empty', async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace('http://dash', '');
      calls.push(`${path} ${bodyOf(init)}`);
      if (path === '/api/omens/outbox') return reply({ items: [{ id: 'o1' }, { id: 'o2' }] });
      if (path === '/api/omens/claim') {
        const id = (JSON.parse(bodyOf(init)) as { id: string }).id;
        return reply({ item: id === 'o1' ? { id, discordId: '1', text: 'x' } : null });
      }
      return reply({});
    });
    const send = vi.fn(async () => {
      throw new Error('Cannot send messages to this user');
    });
    const log = vi.fn();
    const check = createOmensPoster({
      dashboardUrl: 'http://dash',
      gmToken: 't',
      send,
      log,
      fetch: fetchFn as unknown as typeof fetch,
    });
    expect(await check()).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(calls).toContain(
      '/api/omens/finish {"id":"o1","ok":false,"error":"Cannot send messages to this user"}'
    );
    expect(log).toHaveBeenCalled();
  });

  it('never throws and logs an outage once', async () => {
    const log = vi.fn();
    const check = createOmensPoster({
      dashboardUrl: 'http://dash',
      gmToken: 't',
      send: async () => true,
      log,
      fetch: async (): Promise<Response> => {
        throw new Error('down');
      },
    });
    expect(await check()).toBe(0);
    expect(await check()).toBe(0);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('heads a whisper from the whisper desk as a whisper, not an omen', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      const path = url.replace('http://dash', '');
      if (path === '/api/omens/outbox') return reply({ items: [{ id: 'w1' }] });
      if (path === '/api/omens/claim') {
        return reply({ item: { id: 'w1', discordId: '2', text: 'Psst', kind: 'whisper' } });
      }
      return reply({});
    });
    const send = vi.fn(async () => true);
    const check = createOmensPoster({
      dashboardUrl: 'http://dash',
      gmToken: 't',
      send,
      fetch: fetchFn as unknown as typeof fetch,
    });
    expect(await check()).toBe(1);
    expect(send).toHaveBeenCalledWith('2', '**A whisper from your GM**\n\nPsst');
    expect(omenMessage('Hi')).toBe('**An omen for you**\n\nHi');
  });
});
