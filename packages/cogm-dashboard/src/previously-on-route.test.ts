/** "Previously on" (item previously-on): off by default, GM only, text to chat, voice on request. */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import { mountPreviouslyOnRoute, recapPlainText } from './previously-on-route.js';

let server: Server | null = null;
let dir = '';

afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

function session(name: string, approved: boolean, da = 'Dansk tekst.', en = 'English text.'): void {
  const notes = join(dir, name, 'notes');
  mkdirSync(notes, { recursive: true });
  writeFileSync(
    join(notes, 'recap.player.da.md'),
    `# Recap: ${name}\n\n> Kladde: venter.\n\n${da}\n`
  );
  writeFileSync(join(notes, 'recap.player.en.md'), `# Recap\n\n${en}\n`);
  if (approved) writeFileSync(join(notes, 'approved.json'), '{}');
}

interface Harness {
  base: string;
  post: (path: string, body: unknown) => Promise<Response>;
  posts: Array<Record<string, unknown>>;
  narrated: string[];
}

async function start(
  opts: {
    enabled?: boolean;
    gmActions?: boolean;
    fail?: boolean;
    failNarrate?: boolean;
    /** What the bridge answers to the `pipeline` action (the notes run's report). */
    sent?: unknown;
  } = {}
): Promise<Harness> {
  dir = mkdtempSync(join(tmpdir(), 'prevon-'));
  const posts: Array<Record<string, unknown>> = [];
  const narrated: string[] = [];
  const app = express();
  mountPreviouslyOnRoute(app, {
    client: {
      sessionNotes: () => Promise.resolve(opts.sent ?? { status: null, recap: null }),
      callTool: <T>(_name: string, args?: Record<string, unknown>): Promise<T> => {
        if (opts.fail) return Promise.reject(new Error('down'));
        posts.push(args ?? {});
        return Promise.resolve({} as T);
      },
    },
    requireGm: (_req, _res, next) => next(),
    gmActionsEnabled: () => opts.gmActions ?? true,
    enabled: () => opts.enabled ?? true,
    sessionsDir: dir,
    narrate: s => {
      narrated.push(s);
      return opts.failNarrate ? Promise.reject(new Error('no voice')) : Promise.resolve();
    },
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(r => server!.once('listening', () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown): Promise<Response> =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { base, post, posts, narrated };
}

describe('recapPlainText', () => {
  it('drops the title, the draft quote and the marks', () => {
    expect(recapPlainText('# T\n\n> draft\n\n**Bold** and *it*.\n\n- one\n- two\n')).toBe(
      'Bold and it.\n\none\ntwo'
    );
  });
});

describe('/api/previously-on', () => {
  it('is off by default', async () => {
    const { base, post, posts } = await start({ enabled: false });
    session('2026-11-01_1800-discord', true);
    expect(await (await fetch(`${base}/api/previously-on`)).json()).toMatchObject({
      enabled: false,
    });
    expect((await post('/api/previously-on', { lang: 'da' })).status).toBe(403);
    expect(posts).toEqual([]);
  });

  it('offers the newest approved session and posts the chosen language to chat', async () => {
    const { base, post, posts } = await start();
    session('2026-10-01_1900-discord', true, 'Gammel.');
    session('2026-11-01_1900-discord', true, 'Sidste nat.');
    session('2026-11-08_1900-discord', false, 'Ikke godkendt.');
    // Only approved recaps count, so the newest approved one wins over a newer unapproved one.
    const info = (await (await fetch(`${base}/api/previously-on`)).json()) as {
      session: string;
      languages: string[];
    };
    expect(info.session).toBe('2026-11-01_1900-discord');
    expect(info.languages).toEqual(['da', 'en']);
    expect((await post('/api/previously-on', { lang: 'da' })).status).toBe(200);
    expect(posts).toEqual([{ message: '<p>Sidste nat.</p>', messageType: 'ooc' }]);
    expect((await post('/api/previously-on', { lang: 'sv' })).status).toBe(400);
  });

  it('only counts dated -discord folders', async () => {
    const { base } = await start();
    session('2026-11-01_1900-discord', true, 'Sidste nat.');
    session('livekit-recordings', true, 'Ikke en session.');
    session('.incoming', true, 'Ikke en session.');
    session('zz-scratch', true, 'Ikke en session.');
    const info = (await (await fetch(`${base}/api/previously-on`)).json()) as { session: string };
    expect(info.session).toBe('2026-11-01_1900-discord');
  });

  it('uses the approved recap the notes run sent to the bridge, with no sessions folder', async () => {
    const sent = {
      status: null,
      recap: { session: '2026-11-22_1906-discord', text: { en: '# Recap\n\nYou **walked**.\n' } },
    };
    const { base, post, posts } = await start({ sent });
    rmSync(dir, { recursive: true, force: true });
    const info = (await (await fetch(`${base}/api/previously-on`)).json()) as {
      session: string;
      languages: string[];
    };
    expect(info.session).toBe('2026-11-22_1906-discord');
    expect(info.languages).toEqual(['en']);
    expect((await post('/api/previously-on', { lang: 'en' })).status).toBe(200);
    expect(posts).toEqual([{ message: '<p>You walked.</p>', messageType: 'ooc' }]);
  });

  it('prefers an approved recap in the folder on this host over one on the bridge', async () => {
    const sent = {
      status: null,
      recap: { session: '2026-10-01_1900-discord', text: { en: 'Old news.' } },
    };
    const { base } = await start({ sent });
    session('2026-11-01_1900-discord', true);
    const info = (await (await fetch(`${base}/api/previously-on`)).json()) as { session: string };
    expect(info.session).toBe('2026-11-01_1900-discord');
  });

  it('needs GM Actions and an approved recap', async () => {
    const off = await start({ gmActions: false });
    session('2026-11-01_1900-discord', true);
    expect((await off.post('/api/previously-on', { lang: 'en' })).status).toBe(403);
    await new Promise<void>(r => server!.close(() => r()));
    server = null;
    const none = await start();
    session('2026-11-01_1900-discord', false);
    expect((await none.post('/api/previously-on', { lang: 'en' })).status).toBe(404);
  });

  it('answers 502 when Foundry is not reachable', async () => {
    const { post } = await start({ fail: true });
    session('2026-11-01_1900-discord', true);
    expect((await post('/api/previously-on', { lang: 'en' })).status).toBe(502);
  });

  it('starts the voice and has no audio until it exists', async () => {
    const { base, post, narrated } = await start();
    session('2026-11-01_1900-discord', true);
    expect((await post('/api/previously-on/audio', { lang: 'en' })).status).toBe(202);
    expect(narrated).toHaveLength(1);
    expect((await fetch(`${base}/api/previously-on/audio/en`)).status).toBe(404);
    // A half-written file does not count; only the finished one does.
    const wavDir = join(dirname(narrated[0]), 'previously-on.en');
    mkdirSync(wavDir, { recursive: true });
    writeFileSync(join(wavDir, 'previously-on.en.part.wav'), 'x');
    expect((await fetch(`${base}/api/previously-on/audio/en`)).status).toBe(404);
    writeFileSync(join(wavDir, 'previously-on.en.wav'), 'RIFF');
    const res = await fetch(`${base}/api/previously-on/audio/en`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('audio/wav');
    // The recap changes: the old voice no longer matches, so there is none until it is made again.
    session('2026-11-01_1900-discord', true, 'Dansk tekst.', 'New text.');
    expect((await fetch(`${base}/api/previously-on/audio/en`)).status).toBe(404);
  });

  it('removes render folders of an old text when a new voice starts', async () => {
    const { base, post, narrated } = await start();
    session('2026-11-01_1900-discord', true);
    await post('/api/previously-on/audio', { lang: 'en' });
    const oldDir = dirname(narrated[0]);
    expect(existsSync(oldDir)).toBe(true);
    session('2026-11-01_1900-discord', true, 'Dansk tekst.', 'New text.');
    await post('/api/previously-on/audio', { lang: 'en' });
    expect(existsSync(oldDir)).toBe(false);
    expect(narrated).toHaveLength(2);
    expect((await fetch(`${base}/api/previously-on`)).status).toBe(200);
  });

  it('stops listing a failed voice once that language has its voice', async () => {
    const { base, post, narrated } = await start({ failNarrate: true });
    session('2026-11-01_1900-discord', true);
    await post('/api/previously-on/audio', { lang: 'da' });
    for (let i = 0; i < 50; i++) {
      const s = (await (await fetch(`${base}/api/previously-on`)).json()) as { failed: string[] };
      if (s.failed.length > 0) break;
      await new Promise(r => setTimeout(r, 20));
    }
    const before = (await (await fetch(`${base}/api/previously-on`)).json()) as {
      failed: string[];
    };
    expect(before.failed).toEqual(['2026-11-01_1900-discord:da']);
    const wavDir = join(dirname(narrated[0]), 'previously-on.da');
    mkdirSync(wavDir, { recursive: true });
    writeFileSync(join(wavDir, 'previously-on.da.wav'), 'RIFF');
    const after = (await (await fetch(`${base}/api/previously-on`)).json()) as { failed: string[] };
    expect(after.failed).toEqual([]);
  });

  it('starts only one voice run for two requests at once', async () => {
    const { post, narrated } = await start();
    session('2026-11-01_1900-discord', true);
    await Promise.all([
      post('/api/previously-on/audio', { lang: 'da' }),
      post('/api/previously-on/audio', { lang: 'da' }),
    ]);
    expect(narrated).toHaveLength(1);
  });

  it('refuses a recap too long for one chat post', async () => {
    const { post, posts } = await start();
    session('2026-11-01_1900-discord', true, 'x'.repeat(4001));
    expect((await post('/api/previously-on', { lang: 'da' })).status).toBe(413);
    expect(posts).toEqual([]);
  });
});
