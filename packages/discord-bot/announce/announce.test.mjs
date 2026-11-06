import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  SUPPRESS_NOTIFICATIONS,
  deployLine,
  isEntry,
  loadSettings,
  parseEnv,
  postMessage,
  prLine,
  runCli,
} from './announce.mjs';

const env = {
  DISCORD_TOKEN: 'tok',
  DISCORD_CHANGELOG_CHANNEL_ID: '111',
  DISCORD_PRLOG_CHANNEL_ID: '222',
  DISCORD_DASHBOARD_CHANGELOG_CHANNEL_ID: '333',
  DISCORD_GM_ROLE_ID: '444',
  ANNOUNCE_ENV_FILE: 'Z:/does/not/exist.env',
};

/** A fake fetch that records calls. */
function fakeFetch(status = 200) {
  return vi.fn(async () => new Response(JSON.stringify({ id: '999' }), { status }));
}

describe('announce', () => {
  it('parses an env file', () => {
    expect(parseEnv('# c\nA=1\nB = "two"\n\nbad\n')).toEqual({ A: '1', B: 'two' });
  });

  it('reads settings from the file when the environment lacks them', () => {
    expect(loadSettings({}, 'Z:/nope.env')).toEqual({
      token: '',
      changelogChannel: '',
      prLogChannel: '',
      dashboardChannel: '',
      gmRoleId: '',
      gmBotChannel: '',
    });
  });

  it('falls back to the file when the environment value is blank or only whitespace', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'announce-'));
    const file = path.join(dir, 'bot.env');
    writeFileSync(file, 'DISCORD_TOKEN=from-file\nDISCORD_GM_ROLE_ID= 123 \n');
    try {
      const s = loadSettings({ DISCORD_TOKEN: '   ', DISCORD_GM_ROLE_ID: '' }, file);
      expect(s.token).toBe('from-file');
      expect(s.gmRoleId).toBe('123');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('posts gm-bot text as a normal, mention-free message to the GM bot channel, else the watch channel', async () => {
    const f = fakeFetch();
    const log = vi.fn();
    const own = { ...env, DISCORD_GM_BOT_CHANNEL_ID: '555', GAMENIGHT_WATCH_CHANNEL_ID: '666' };
    expect(await runCli(['gm-bot', '<@&444> notes', 'paused'], { env: own, fetchImpl: f, log })).toBe(0);
    expect(f.mock.calls[0][0]).toContain('/channels/555/messages');
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.content).toBe('<@&444> notes paused');
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.flags).toBeUndefined();
    const watch = { ...env, GAMENIGHT_WATCH_CHANNEL_ID: '666' };
    await runCli(['gm-bot', 'x'], { env: watch, fetchImpl: f, log });
    expect(f.mock.calls[1][0]).toContain('/channels/666/messages');
  });

  it('does nothing for gm-bot without a channel, and rejects an empty gm-bot call', async () => {
    const f = fakeFetch();
    const log = vi.fn();
    expect(await runCli(['gm-bot', 'x'], { env, fetchImpl: f, log })).toBe(0);
    expect(f).not.toHaveBeenCalled();
    expect(await runCli(['gm-bot'], { env, fetchImpl: f, log })).toBe(2);
  });

  it('formats the lines', () => {
    expect(prLine(683, 'Merge  the\nthing')).toBe(
      '[#683](<https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool/pull/683>) Merge the thing'
    );
    expect(deployLine('v0.24.0')).toBe('Serveren kører nu v0.24.0.');
  });

  it('sends silent, mention-free posts to the right channel', async () => {
    const f = fakeFetch();
    const r = await postMessage({ token: 't', channelId: '222', content: 'hi @everyone', fetchImpl: f });
    expect(r).toEqual({ ok: true, id: '999' });
    const [url, init] = f.mock.calls[0];
    expect(url).toContain('/channels/222/messages');
    const body = JSON.parse(init.body);
    expect(body.flags).toBe(SUPPRESS_NOTIFICATIONS);
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(init.headers.Authorization).toBe('Bot t');
  });

  it('sends a normal post, still without mentions, when silent is false', async () => {
    const f = fakeFetch();
    await postMessage({ token: 't', channelId: '1', content: 'x', silent: false, fetchImpl: f });
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.flags).toBeUndefined();
    expect(body.allowed_mentions).toEqual({ parse: [] });
  });

  it('truncates long text and reports a Discord error without throwing', async () => {
    const f = fakeFetch(403);
    const r = await postMessage({ token: 't', channelId: '1', content: 'x'.repeat(5000), fetchImpl: f });
    expect(r).toEqual({ ok: false, reason: 'Discord answered 403' });
    expect(JSON.parse(f.mock.calls[0][1].body).content).toHaveLength(2000);
  });

  it('turns a network error into a result', async () => {
    const f = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await postMessage({ token: 't', channelId: '1', content: 'x', fetchImpl: f })).toEqual({
      ok: false,
      reason: 'offline',
    });
  });

  it('never lets the token reach a result, even through an error message', async () => {
    const bad = await postMessage({ token: 'abc\ndef', channelId: '1', content: 'x', fetchImpl: fakeFetch() });
    expect(bad).toEqual({ ok: false, reason: 'token has invalid characters' });
    const f = vi.fn(async () => {
      throw new Error('bad header Bot sekret.tok');
    });
    const r = await postMessage({ token: 'sekret.tok', channelId: '1', content: 'x', fetchImpl: f });
    expect(JSON.stringify(r)).not.toContain('sekret');
  });

  it('knows its own entry through real paths', () => {
    const self = fileURLToPath(import.meta.url);
    expect(isEntry(self, self)).toBe(true);
    expect(isEntry(undefined, self)).toBe(false);
    expect(isEntry(`${self}.other`, self)).toBe(false);
    if (process.platform === 'win32') expect(isEntry(self.toUpperCase(), self)).toBe(true);
  });

  it('routes pr to #pr-log and changelog/deploy to #changelog', async () => {
    const f = fakeFetch();
    const log = vi.fn();
    expect(await runCli(['pr', '5', 'A', 'title'], { env, fetchImpl: f, log })).toBe(0);
    expect(await runCli(['deploy', 'v0.24.0'], { env, fetchImpl: f, log })).toBe(0);
    expect(await runCli(['changelog', 'Nyt', 'i', 'spillet'], { env, fetchImpl: f, log })).toBe(0);
    expect(f.mock.calls.map(c => c[0].match(/channels\/(\d+)/)[1])).toEqual(['222', '111', '111']);
    expect(JSON.parse(f.mock.calls[2][1].body).content).toBe('Nyt i spillet');
    // only #pr-log is silent
    expect(f.mock.calls.map(c => JSON.parse(c[1].body).flags)).toEqual([4096, undefined, undefined]);
  });

  it('posts dashboard text to the GM channel and may mention only the GM role', async () => {
    const f = fakeFetch();
    const log = vi.fn();
    const text = '<@&444> Nyt i dashboardet (v0.26.0):\n• Ny knap';
    expect(await runCli(['dashboard', text], { env, fetchImpl: f, log })).toBe(0);
    expect(f.mock.calls[0][0]).toContain('/channels/333/messages');
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.content).toBe(text);
    expect(body.allowed_mentions).toEqual({ parse: [], roles: ['444'] });
    expect(body.flags).toBeUndefined();
  });

  it('keeps roles-only mentions when the text itself says @everyone or @here', async () => {
    const f = fakeFetch();
    await runCli(['dashboard', '<@&444> @everyone @here hej'], { env, fetchImpl: f, log: vi.fn() });
    expect(JSON.parse(f.mock.calls[0][1].body).allowed_mentions).toEqual({ parse: [], roles: ['444'] });
  });

  it('fills {gm} with the role mention, drops it without a role id, and trims the id', async () => {
    const f = fakeFetch();
    const log = vi.fn();
    await runCli(['dashboard', '{gm} Nyt'], { env: { ...env, DISCORD_GM_ROLE_ID: '444 ' }, fetchImpl: f, log });
    const withId = JSON.parse(f.mock.calls[0][1].body);
    expect(withId.content).toBe('<@&444> Nyt');
    expect(withId.allowed_mentions).toEqual({ parse: [], roles: ['444'] });
    const noRole = { ...env };
    delete noRole.DISCORD_GM_ROLE_ID;
    await runCli(['dashboard', '{gm} Nyt'], { env: noRole, fetchImpl: f, log });
    expect(JSON.parse(f.mock.calls[1][1].body).content).toBe('Nyt');
  });

  it('keeps the dashboard post mention-free without a GM role id, and #changelog never mentions', async () => {
    const f = fakeFetch();
    const log = vi.fn();
    const noRole = { ...env };
    delete noRole.DISCORD_GM_ROLE_ID;
    await runCli(['dashboard', 'x'], { env: noRole, fetchImpl: f, log });
    expect(JSON.parse(f.mock.calls[0][1].body).allowed_mentions).toEqual({ parse: [] });
    await runCli(['changelog', '<@&444> x'], { env, fetchImpl: f, log });
    expect(JSON.parse(f.mock.calls[1][1].body).allowed_mentions).toEqual({ parse: [] });
    await postMessage({ token: 't', channelId: '1', content: 'x', mentionRoleId: '4 44', fetchImpl: f });
    expect(JSON.parse(f.mock.calls[2][1].body).allowed_mentions).toEqual({ parse: [] });
  });

  it('does nothing for dashboard without its channel, and rejects an empty dashboard call', async () => {
    const f = fakeFetch();
    const log = vi.fn();
    const only = { DISCORD_TOKEN: 'tok', DISCORD_CHANGELOG_CHANNEL_ID: '111', ANNOUNCE_ENV_FILE: 'Z:/x.env' };
    expect(await runCli(['dashboard', 'x'], { env: only, fetchImpl: f, log })).toBe(0);
    expect(f).not.toHaveBeenCalled();
    expect(await runCli(['dashboard'], { env, fetchImpl: f, log })).toBe(2);
  });

  it('does nothing without settings, fails soft on errors, and rejects bad usage', async () => {
    const f = fakeFetch();
    const log = vi.fn();
    expect(await runCli(['pr', '5', 't'], { env: { ANNOUNCE_ENV_FILE: 'Z:/x.env' }, fetchImpl: f, log })).toBe(0);
    expect(f).not.toHaveBeenCalled();
    expect(await runCli(['pr', '5', 't'], { env, fetchImpl: fakeFetch(500), log })).toBe(1);
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('WARNING'));
    expect(await runCli(['pr', 'x'], { env, fetchImpl: f, log })).toBe(2);
    expect(await runCli([], { env, fetchImpl: f, log })).toBe(2);
  });
});
