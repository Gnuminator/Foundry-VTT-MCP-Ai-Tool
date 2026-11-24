import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { plan, runCli } from './send-notes.mjs';

const env = {
  DISCORD_TOKEN: 'tok',
  DISCORD_SESSION_NOTES_CHANNEL_ID: '777',
  ANNOUNCE_ENV_FILE: 'Z:/does/not/exist.env',
};

function outbox() {
  return {
    session: 's',
    items: [
      {
        id: 'pc-a-da',
        kind: 'pc-note',
        channels: ['discord-dm', 'foundry-page', 'obsidian'],
        status: 'approved',
        to: { type: 'player', player: 'Anna', discordId: '111111' },
        discord: ['one', 'two'],
        sent: {},
      },
      {
        id: 'pc-b-da',
        kind: 'pc-note',
        channels: ['discord-dm', 'foundry-page', 'obsidian'],
        status: 'draft',
        to: { type: 'player', player: 'Bo', discordId: '222222' },
        discord: ['draft'],
        sent: {},
      },
      {
        id: 'recap-da',
        kind: 'recap',
        channels: ['discord-group', 'foundry-recap', 'obsidian'],
        status: 'approved',
        to: { type: 'group' },
        discord: ['recap'],
        sent: {},
      },
    ],
  };
}

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'send-notes-'));
  const file = path.join(dir, 'outbox.json');
  writeFileSync(file, JSON.stringify(outbox()));
  return { dir, file };
}

function fakeFetch(failAt) {
  const calls = [];
  const f = vi.fn(async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (failAt && calls.length === failAt) return new Response('{}', { status: 500 });
    return new Response(JSON.stringify({ id: '555555' }), { status: 200 });
  });
  return { f, calls };
}

describe('send-notes', () => {
  it('plan skips drafts and says why', () => {
    const p = plan(outbox(), { group: '777' });
    expect(p.find(x => x.id === 'pc-b-da')?.skip).toBe('not approved');
    expect(p.find(x => x.id === 'pc-a-da')?.skip).toBeUndefined();
    expect(plan(outbox(), { group: '' }).find(x => x.id === 'recap-da')?.skip).toMatch(
      /no session notes channel/
    );
  });

  it('dry run sends and writes nothing', async () => {
    const { dir, file } = setup();
    const { f } = fakeFetch();
    const lines = [];
    expect(await runCli([file, '--dry-run'], { env, fetchImpl: f, log: l => lines.push(l) })).toBe(0);
    expect(f).not.toHaveBeenCalled();
    expect(lines.join('\n')).toContain('SEND pc-a-da');
    expect(lines.join('\n')).toContain('SKIP pc-b-da');
    expect(JSON.parse(readFileSync(file, 'utf8')).items[0].sent).toEqual({});
    rmSync(dir, { recursive: true });
  });

  it('sends approved notes only, DM then group, without mentions, and marks them sent', async () => {
    const { dir, file } = setup();
    const { f, calls } = fakeFetch();
    expect(await runCli([file], { env, fetchImpl: f, log: () => {} })).toBe(0);
    const urls = calls.map(c => c.url.replace('https://discord.com/api/v10', ''));
    expect(urls).toEqual([
      '/users/@me/channels',
      '/channels/555555/messages',
      '/channels/555555/messages',
      '/channels/777/messages',
    ]);
    expect(calls[0].body).toEqual({ recipient_id: '111111' });
    expect(calls.every(c => !c.body.content || c.body.allowed_mentions.parse.length === 0)).toBe(true);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved.items[0].sent.discordDm.done).toBe(true);
    expect(saved.items[1].sent).toEqual({});
    const again = fakeFetch();
    await runCli([file], { env, fetchImpl: again.f, log: () => {} });
    expect(again.f).not.toHaveBeenCalled();
    rmSync(dir, { recursive: true });
  });

  it('a failed part is not repeated on rerun', async () => {
    const { dir, file } = setup();
    const first = fakeFetch(3); // DM channel ok, part 1 ok, part 2 fails
    expect(await runCli([file, '--only', 'pc-a-da'], { env, fetchImpl: first.f, log: () => {} })).toBe(1);
    expect(JSON.parse(readFileSync(file, 'utf8')).items[0].sent.discordDm).toMatchObject({
      parts: 1,
      done: false,
    });
    const second = fakeFetch();
    expect(await runCli([file, '--only', 'pc-a-da'], { env, fetchImpl: second.f, log: () => {} })).toBe(0);
    expect(second.calls.filter(c => c.body.content).map(c => c.body.content)).toEqual(['two']);
    rmSync(dir, { recursive: true });
  });

  it('an edit after a partial send is not mixed with the parts already delivered', async () => {
    const { dir, file } = setup();
    const first = fakeFetch(3);
    await runCli([file, '--only', 'pc-a-da'], { env, fetchImpl: first.f, log: () => {} });
    const box = JSON.parse(readFileSync(file, 'utf8'));
    box.items[0].discord = ['new one', 'new two'];
    writeFileSync(file, JSON.stringify(box));
    const second = fakeFetch();
    await runCli([file, '--only', 'pc-a-da'], { env, fetchImpl: second.f, log: () => {} });
    expect(second.f).not.toHaveBeenCalled();
    rmSync(dir, { recursive: true });
  });
});
