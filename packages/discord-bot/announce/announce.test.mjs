import { describe, expect, it, vi } from 'vitest';
import {
  SUPPRESS_NOTIFICATIONS,
  deployLine,
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
    });
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
