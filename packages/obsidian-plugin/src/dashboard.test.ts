import { describe, expect, it, vi } from 'vitest';

import {
  DashboardClient,
  DashboardError,
  normalizeBaseUrl,
  planLink,
  type HttpRequest,
  type HttpResponse,
} from './dashboard.js';

function client(
  answer: (req: HttpRequest) => HttpResponse | Promise<HttpResponse>,
  token: string | null = null,
  base = 'http://localhost:3000/'
): { client: DashboardClient; calls: HttpRequest[] } {
  const calls: HttpRequest[] = [];
  const http = vi.fn((req: HttpRequest) => {
    calls.push(req);
    return Promise.resolve(answer(req));
  });
  return {
    client: new DashboardClient(
      http,
      () => base,
      () => token
    ),
    calls,
  };
}

describe('addresses', () => {
  it('normalizes the base URL and builds plan links only for plan ids', () => {
    expect(normalizeBaseUrl(' http://localhost:3000// ')).toBe('http://localhost:3000');
    expect(planLink('http://localhost:3000/', 'plan-muoni1cd-47e13bf6')).toBe(
      'http://localhost:3000/?plan=plan-muoni1cd-47e13bf6'
    );
    expect(planLink('http://localhost:3000', 'javascript:alert(1)')).toBeNull();
    expect(planLink('http://localhost:3000', 'plan-A&x=1')).toBeNull();
  });
});

describe('openInFoundry', () => {
  it('posts the uuid with the open header and the token', async () => {
    const { client: c, calls } = client(
      () => ({
        status: 200,
        json: { opened: true, documentName: 'Actor', name: 'Ireena', userId: 'u1' },
      }),
      'secret-token'
    );
    await expect(c.openInFoundry('Actor.abc')).resolves.toEqual({
      kind: 'opened',
      documentName: 'Actor',
      name: 'Ireena',
    });
    expect(calls[0]).toEqual({
      url: 'http://localhost:3000/api/open',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CoGM-Request': 'open',
        'X-CoGM-Token': 'secret-token',
      },
      body: JSON.stringify({ uuid: 'Actor.abc' }),
    });
  });

  it('sends no token header without a token, and the chosen GM when given', async () => {
    const { client: c, calls } = client(() => ({ status: 200, json: { opened: true } }));
    await c.openInFoundry('Actor.abc', 'gm2');
    expect(calls[0]?.headers['X-CoGM-Token']).toBeUndefined();
    expect(calls[0]?.body).toBe(JSON.stringify({ uuid: 'Actor.abc', userId: 'gm2' }));
  });

  it('returns the GMs to choose from on 409 choose-gm', async () => {
    const { client: c } = client(() => ({
      status: 409,
      json: {
        code: 'choose-gm',
        error: 'x',
        gms: [{ id: 'g1', name: 'Gamemaster' }, { id: 'g2' }, 'bad'],
      },
    }));
    await expect(c.openInFoundry('Actor.abc')).resolves.toEqual({
      kind: 'choose-gm',
      gms: [
        { id: 'g1', name: 'Gamemaster' },
        { id: 'g2', name: 'g2' },
      ],
    });
  });

  it('turns refusals into readable errors', async () => {
    const { client: c } = client(() => ({
      status: 403,
      json: { code: 'gm-required', error: 'GM only.' },
    }));
    await expect(c.openInFoundry('Actor.abc')).resolves.toEqual({
      kind: 'error',
      message: 'GM only. Check the GM token in the plugin settings.',
    });
    const { client: d } = client(() => ({ status: 502, json: {} }));
    await expect(d.openInFoundry('Actor.abc')).resolves.toEqual({
      kind: 'error',
      message: 'The dashboard answered HTTP 502.',
    });
  });

  it('says when the dashboard is not reachable or not set', async () => {
    const { client: c } = client(() => Promise.reject(new Error('ECONNREFUSED')));
    await expect(c.openInFoundry('Actor.abc')).rejects.toThrow(/did not answer \(ECONNREFUSED\)/);
    const { client: d } = client(() => ({ status: 200, json: {} }), null, 'localhost:3000');
    await expect(d.openInFoundry('Actor.abc')).rejects.toBeInstanceOf(DashboardError);
  });
});

describe('reveal tools', () => {
  it('reads the reveal state from list-revealed-pages', async () => {
    const { client: c, calls } = client(() => ({
      status: 200,
      json: {
        ok: true,
        result: {
          pages: [
            {
              uuid: 'JournalEntry.h.JournalEntryPage.c',
              title: 'Letter',
              observable: true,
              copiedFrom: 'JournalEntry.a.JournalEntryPage.p',
              seenBy: [{ name: 'Ana' }],
            },
            { title: 'no uuid' },
          ],
          queue: [{ uuid: 'JournalEntry.a.JournalEntryPage.q', title: 'Map', sceneId: null }],
        },
      },
    }));
    await expect(c.revealState()).resolves.toEqual({
      pages: [
        {
          uuid: 'JournalEntry.h.JournalEntryPage.c',
          title: 'Letter',
          observable: true,
          copiedFrom: 'JournalEntry.a.JournalEntryPage.p',
          seenBy: [{ name: 'Ana' }],
        },
      ],
      queue: [{ uuid: 'JournalEntry.a.JournalEntryPage.q', title: 'Map', sceneId: null }],
    });
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ name: 'list-revealed-pages', args: {} });
    expect(calls[0]?.url).toBe('http://localhost:3000/api/tool');
  });

  it('plans a reveal (planId) and queues without a plan (note)', async () => {
    const { client: c, calls } = client(req => {
      const body = JSON.parse(req.body ?? '{}') as { args: { action: string } };
      return body.args.action === 'reveal'
        ? {
            status: 200,
            json: { ok: true, result: { planId: 'plan-1', summary: 'Reveal "Letter"' } },
          }
        : { status: 200, json: { ok: true, result: { queued: true, note: 'Queued "Letter".' } } };
    });
    await expect(c.planReveal('JournalEntry.a.JournalEntryPage.p', 'reveal')).resolves.toEqual({
      planId: 'plan-1',
      note: 'Reveal "Letter"',
    });
    await expect(c.planReveal('JournalEntry.a.JournalEntryPage.p', 'queue')).resolves.toEqual({
      planId: null,
      note: 'Queued "Letter".',
    });
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      name: 'plan-page-reveal',
      args: { pageUuid: 'JournalEntry.a.JournalEntryPage.p', action: 'reveal' },
    });
  });

  it('throws the tool error without the "Error: " prefix', async () => {
    const { client: c } = client(() => ({
      status: 500,
      json: { ok: false, error: 'Error: The "handouts" feature is switched off' },
    }));
    await expect(c.planReveal('JournalEntry.a.JournalEntryPage.p', 'reveal')).rejects.toThrow(
      /^The "handouts" feature is switched off$/
    );
  });
});

describe('theme', () => {
  it('reads the world theme with GET /api/theme', async () => {
    const { client: c, calls } = client(
      () => ({ status: 200, json: { theme: 'veil', themes: ['neutral', 'veil'] } }),
      'secret-token'
    );
    await expect(c.theme()).resolves.toBe('veil');
    expect(calls[0]?.url).toBe('http://localhost:3000/api/theme');
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.body).toBeUndefined();
    expect(calls[0]?.headers['X-CoGM-Token']).toBe('secret-token');
  });

  it('sets the world theme with the set-theme control', async () => {
    const { client: c, calls } = client(() => ({
      status: 200,
      json: { theme: 'neutral', themes: ['neutral', 'veil'] },
    }));
    await expect(c.setTheme('neutral')).resolves.toBe('neutral');
    expect(calls[0]?.url).toBe('http://localhost:3000/api/control');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ action: 'set-theme', value: 'neutral' });
  });

  it('reports a refusal with its status', async () => {
    const { client: c } = client(() => ({
      status: 409,
      json: { error: 'The world is not known yet; try again once Foundry is connected.' },
    }));
    await expect(c.setTheme('veil')).rejects.toMatchObject({ status: 409 });
  });
});

describe('Cloudflare Access service token (D-094 R1)', () => {
  const ACCESS = { clientId: 'id-123.access', clientSecret: 'shh-456' };

  function accessClient(
    base: string,
    access: { clientId: string; clientSecret: string } | null,
    answer: HttpResponse = { status: 200, json: { theme: 'veil', themes: ['neutral', 'veil'] } }
  ): { client: DashboardClient; calls: HttpRequest[] } {
    const calls: HttpRequest[] = [];
    const http = vi.fn((req: HttpRequest) => {
      calls.push(req);
      return Promise.resolve(answer);
    });
    return {
      client: new DashboardClient(
        http,
        () => base,
        () => 'gm-token',
        () => access
      ),
      calls,
    };
  }

  it('sends both Access headers and the GM token to an https dashboard', async () => {
    const { client: c, calls } = accessClient('https://cogm.example.org', ACCESS);
    await c.theme();
    expect(calls[0]?.headers).toMatchObject({
      'CF-Access-Client-Id': 'id-123.access',
      'CF-Access-Client-Secret': 'shh-456',
      'X-CoGM-Token': 'gm-token',
    });
  });

  it('never sends the Access headers to a plain http address', async () => {
    const { client: c, calls } = accessClient('http://100.110.82.102:3000', ACCESS);
    await c.theme();
    expect(calls[0]?.headers['CF-Access-Client-Id']).toBeUndefined();
    expect(calls[0]?.headers['CF-Access-Client-Secret']).toBeUndefined();
    expect(calls[0]?.headers['X-CoGM-Token']).toBe('gm-token');
  });

  it('sends no Access headers when none are set', async () => {
    const { client: c, calls } = accessClient('https://cogm.example.org', null);
    await c.theme();
    expect(Object.keys(calls[0]?.headers ?? {}).some(h => h.startsWith('CF-Access'))).toBe(false);
  });

  it("says to check the Access token when the answer is not the dashboard's JSON", async () => {
    // Access answers a refused or missing service token with its own HTML page.
    const { client: c } = accessClient('https://cogm.example.org', ACCESS, {
      status: 403,
      json: null,
    });
    const error = await c.theme().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DashboardError);
    expect((error as DashboardError).message).toMatch(/Cloudflare Access.*Client ID and Secret/);
    expect((error as DashboardError).message).not.toContain('shh-456');
  });
});
