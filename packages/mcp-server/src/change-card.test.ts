import { describe, expect, it } from 'vitest';

import {
  CHANGE_CARD_HTML,
  CHANGE_CARD_MIME,
  CHANGE_CARD_URI,
  hasChangeCard,
  withChangeCardMeta,
} from './change-card.js';

describe('change card', () => {
  it('hangs the card on plan-* tools only', () => {
    expect(hasChangeCard('plan-token-change')).toBe(true);
    expect(hasChangeCard('apply-planned-change')).toBe(false);
    expect(hasChangeCard('get-character')).toBe(false);
    // Prep has no size-budget room left, so its plan tools stay text only.
    expect(hasChangeCard('plan-tarokka-reveal')).toBe(false);
  });

  it('adds the ui pointer and keeps other meta', () => {
    const t = withChangeCardMeta({ name: 'plan-token-change', _meta: { keep: 1 } });
    expect(t._meta).toMatchObject({
      keep: 1,
      ui: { resourceUri: CHANGE_CARD_URI },
    });
  });

  it('leaves other tools untouched', () => {
    const t = { name: 'get-character' };
    expect(withChangeCardMeta(t)).toBe(t);
  });

  it('lists and reads the card over MCP', async () => {
    const { Server, InMemoryTransport } = await import('@modelcontextprotocol/server');
    const { Client } = await import('@modelcontextprotocol/client');
    const { RESOURCES_CAPABILITY, registerChangeCardHandlers } = await import('./change-card.js');
    const server = new Server({ name: 't', version: '1' }, { capabilities: RESOURCES_CAPABILITY });
    registerChangeCardHandlers(server);
    const client = new Client({ name: 'c', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const list = await client.listResources();
    expect(list.resources.map(r => r.uri)).toEqual([CHANGE_CARD_URI]);
    const read = await client.readResource({ uri: CHANGE_CARD_URI });
    expect(read.contents[0]?.mimeType).toBe(CHANGE_CARD_MIME);
    await expect(client.readResource({ uri: 'ui://nope' })).rejects.toThrow(/Unknown resource/);
  });

  it('serves a self-contained page with the app mime type', () => {
    expect(CHANGE_CARD_MIME).toBe('text/html;profile=mcp-app');
    expect(CHANGE_CARD_HTML).toContain('ui/notifications/tool-result');
    expect(CHANGE_CARD_HTML).not.toMatch(/innerHTML|src="http|href="http/);
  });
});
