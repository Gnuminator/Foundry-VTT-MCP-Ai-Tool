/**
 * Sends the approved session notes from the outbox (tools/session-notes `outbox`): a Discord DM
 * from the bot to each player for their "Your character" note, and one post per recap and Table
 * page to the session notes channel.
 *
 *   node packages/discord-bot/announce/send-notes.mjs <outbox.json> [--dry-run] [--only <id,id>]
 *
 * Rules:
 * - Only items with `status: "approved"` go out. A draft is never sent, whatever else is set.
 * - Each Discord channel of an item goes out once: `sent.discordDm` / `sent.discordGroup` is
 *   written to the file after each message part, so a rerun carries on where it stopped and never
 *   repeats a part whose delivery was saved (a part whose answer was lost may repeat).
 * - `--dry-run` sends nothing and writes nothing; it prints per recipient what would go out.
 * - No message mentions anyone (allowed_mentions parse is empty).
 * - The group channel is DISCORD_SESSION_NOTES_CHANNEL_ID, else DISCORD_SESSION_POST_CHANNEL_ID
 *   (real environment, then discord-bot.env).
 *   Without it the group items are reported as "no channel set" and nothing is posted.
 * - DISCORD_API_BASE points the calls at a fake Discord for tests (default the real API).
 * The token is never printed.
 */
import { createHash } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { API, MAX_CONTENT, defaultEnvFile, isEntry, loadSettings, parseEnv } from './announce.mjs';

const TIMEOUT_MS = 10000;

/** @param {Record<string, string | undefined>} env @param {string} [envFile] */
export function groupChannel(env = process.env, envFile = defaultEnvFile(env)) {
  const keys = ['DISCORD_SESSION_NOTES_CHANNEL_ID', 'DISCORD_SESSION_POST_CHANNEL_ID'];
  for (const k of keys) if ((env[k] || '').trim()) return (env[k] || '').trim();
  try {
    const file = parseEnv(readFileSync(envFile, 'utf8'));
    for (const k of keys) if ((file[k] || '').trim()) return (file[k] || '').trim();
  } catch {
    // no settings file
  }
  return '';
}

/** Fingerprint of the Discord text, kept with a partial send so an edit cannot mix old and new parts. */
const textHash = messages => createHash('sha256').update(JSON.stringify(messages)).digest('hex').slice(0, 16);

/** One authorised JSON call to Discord; returns the parsed body or throws without the token. */
async function discord(fetchImpl, base, token, method, path, body) {
  const res = await fetchImpl(`${base}${path}`, {
    method,
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Discord answered ${res.status} for ${path.replace(/\d{6,}/g, '#')}`);
  return res.json().catch(() => ({}));
}

/**
 * What the run would send, for the preview and the dry run.
 * @param {{ items: any[] }} outbox
 * @returns {Array<{ id: string, to: string, kind: 'dm' | 'group', messages: string[], skip?: string }>}
 */
export function plan(outbox, { group = '', only } = {}) {
  /** @type {Array<{ id: string, to: string, kind: 'dm' | 'group', messages: string[], skip?: string }>} */
  const out = [];
  for (const item of outbox.items) {
    if (only && !only.includes(item.id)) continue;
    const dm = item.channels.includes('discord-dm');
    const grp = item.channels.includes('discord-group');
    if (!dm && !grp) continue;
    const kind = dm ? 'dm' : 'group';
    const key = dm ? 'discordDm' : 'discordGroup';
    const to = dm ? `${item.to.player} (${item.to.discordId || 'no id'})` : `channel ${group || 'not set'}`;
    let skip;
    if (item.status !== 'approved') skip = 'not approved';
    else if (item.sent?.[key]?.done) skip = 'already sent';
    else if (item.sent?.[key]?.parts && item.sent[key].textHash !== textHash(item.discord))
      skip = 'text changed after some parts went out; clear sent.' + key + ' in the outbox to resend all';
    else if (dm && !item.to.discordId) skip = 'no Discord id for this player';
    else if (grp && !group) skip = 'no session notes channel set (DISCORD_SESSION_NOTES_CHANNEL_ID)';
    out.push({ id: item.id, to, kind, messages: item.discord, ...(skip ? { skip } : {}) });
  }
  return out;
}

function save(path, outbox) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(outbox, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}

/**
 * @param {string[]} argv
 * @param {{ env?: Record<string, string | undefined>, envFile?: string, fetchImpl?: typeof fetch,
 *   log?: (line: string) => void }} [o]
 * @returns {Promise<number>} 0 done (or dry run), 1 some part failed, 2 usage
 */
export async function runCli(argv, o = {}) {
  const { env = process.env, fetchImpl = globalThis.fetch, log = console.log } = o;
  const args = argv.filter(a => !a.startsWith('--'));
  const dry = argv.includes('--dry-run');
  const onlyAt = argv.indexOf('--only');
  const only = onlyAt >= 0 ? (argv[onlyAt + 1] || '').split(',').filter(Boolean) : undefined;
  const file = args.find(a => a !== (only ? argv[onlyAt + 1] : undefined));
  if (!file) {
    log('send-notes: usage: send-notes.mjs <outbox.json> [--dry-run] [--only <id,id>]');
    return 2;
  }
  const outbox = JSON.parse(readFileSync(file, 'utf8'));
  const ids = outbox.items.map(i => i.id);
  if (new Set(ids).size !== ids.length) {
    log('send-notes: the outbox has two notes with the same id; nothing sent');
    return 1;
  }
  const settings = loadSettings(env, o.envFile);
  const group = groupChannel(env, o.envFile);
  const todo = plan(outbox, { group, ...(only ? { only } : {}) });
  const base = (env.DISCORD_API_BASE || API).replace(/\/+$/, '');

  if (dry) {
    for (const p of todo) {
      const total = p.messages.reduce((n, m) => n + m.length, 0);
      log(`${p.skip ? 'SKIP' : 'SEND'} ${p.id} -> ${p.kind} ${p.to}: ${p.messages.length} message(s), ${total} characters${p.skip ? ` (${p.skip})` : ''}`);
    }
    log('send-notes: dry run, nothing sent');
    return 0;
  }
  if (!settings.token || !/^[\w.-]+$/.test(settings.token)) {
    log('send-notes: no usable bot token; nothing sent');
    return 1;
  }
  let failed = 0;
  for (const p of todo) {
    if (p.skip) {
      log(`skip ${p.id}: ${p.skip}`);
      continue;
    }
    const item = outbox.items.find(i => i.id === p.id);
    const key = p.kind === 'dm' ? 'discordDm' : 'discordGroup';
    item.sent ??= {};
    const rec = (item.sent[key] ??= { parts: 0, done: false });
    rec.textHash = textHash(p.messages);
    try {
      let channelId = group;
      if (p.kind === 'dm') {
        channelId = (
          await discord(fetchImpl, base, settings.token, 'POST', '/users/@me/channels', {
            recipient_id: item.to.discordId,
          })
        ).id;
        if (!channelId) throw new Error('Discord gave no DM channel');
      }
      for (let i = rec.parts; i < p.messages.length; i += 1) {
        await discord(fetchImpl, base, settings.token, 'POST', `/channels/${channelId}/messages`, {
          content: p.messages[i].slice(0, MAX_CONTENT),
          allowed_mentions: { parse: [] },
        });
        rec.parts = i + 1;
        save(file, outbox);
      }
      rec.done = true;
      delete rec.error;
      rec.at = new Date().toISOString();
      save(file, outbox);
      log(`sent ${p.id} -> ${p.kind} ${p.to}: ${p.messages.length} message(s)`);
    } catch (e) {
      failed += 1;
      rec.error = e instanceof Error ? e.message.split(settings.token).join('[token]') : String(e);
      save(file, outbox);
      log(`FAILED ${p.id}: ${rec.error} (${rec.parts}/${p.messages.length} parts delivered; a rerun continues)`);
    }
  }
  return failed ? 1 : 0;
}

if (isEntry(process.argv[1], fileURLToPath(import.meta.url))) {
  runCli(process.argv.slice(2)).then(
    code => {
      process.exitCode = code;
    },
    e => {
      console.log(`send-notes: stopped: ${e instanceof Error ? e.message : String(e)} (a part may have been delivered but not saved; check sent.* in the outbox before a rerun)`);
      process.exitCode = 1;
    }
  );
}
