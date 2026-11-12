// Sets up the Cloudflare side of the player connector, from the user's own terminal.
//
//   node scripts/pi/player-connector-cloudflare.mjs [--apply] --users <file> [--host <host>]
//     [--zone <zone>] [--tunnel <name>] [--origin <url>] [--send-to <ssh host> | --out <path>] [--rotate]
//
// Claude Desktop players call POST https://<host>/mcp/player, each with a Cloudflare Access service
// token. This script creates the four tokens, one reusable policy that lets only those tokens in,
// the Access application, the tunnel route (restricted to /mcp/player) and the DNS record, then
// writes player-connector.json for the Pi. The token secrets go from Cloudflare into that file and
// nowhere else: not to the screen, not to a log, not into the repo. Default is a plan that only
// reads; --apply writes.
//
// The API token (My Profile, API Tokens, custom; 1 hour TTL; typed into the hidden prompt) needs
// these permissions, and a plan (without --apply) fails with "found 0" accounts without the first two:
//   Account: Account Settings: Read, Zone: Zone: Read, Account: Access: Apps and Policies: Edit,
//   Account: Access: Service Tokens: Edit, Account: Cloudflare Tunnel: Edit, Zone: DNS: Edit (on the zone).
import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const API_BASE = 'https://api.cloudflare.com/client/v4';
export const POLICY_NAME = 'Player connector tokens';
export const APP_NAME = 'Player connector';
export const TOKEN_DURATION = '43800h';
export const REMOTE_FILE = '/root/player-connector.json.new';
export const DEFAULTS = {
  host: 'player-ai.spennerit.com',
  zone: 'spennerit.com',
  tunnel: 'foundry-pi',
  origin: 'http://localhost:3000',
};

const USER_ID = /^[A-Za-z0-9]{16}$/;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

/** A short, plain failure: the message is safe to print. */
export class UsageError extends Error {}

/**
 * @param {string[]} argv
 * @returns {{ apply: boolean, rotate: boolean, users?: string, host: string, zone: string,
 *   tunnel: string, origin: string, sendTo?: string, out?: string }}
 */
export function parseArgs(argv) {
  const opts = { apply: false, rotate: false, ...DEFAULTS };
  const valued = {
    '--users': 'users',
    '--host': 'host',
    '--zone': 'zone',
    '--tunnel': 'tunnel',
    '--origin': 'origin',
    '--send-to': 'sendTo',
    '--out': 'out',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') opts.apply = true;
    else if (arg === '--rotate') opts.rotate = true;
    else if (arg in valued) {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--'))
        throw new UsageError(`${arg} needs a value`);
      opts[valued[arg]] = value;
    } else throw new UsageError(`unknown argument ${arg}`);
  }
  if (!opts.users) throw new UsageError('--users <file> is required');
  // The DNS record and the Access application are made for --host inside --zone; a host outside the zone would fail late.
  if (!opts.host.toLowerCase().endsWith(`.${opts.zone.toLowerCase()}`)) {
    throw new UsageError(`--host ${opts.host} must be a name inside --zone ${opts.zone}`);
  }
  if (opts.sendTo && opts.out) throw new UsageError('use either --send-to or --out, not both');
  if (opts.sendTo && opts.sendTo.startsWith('-')) throw new UsageError('--send-to is not a host');
  if (opts.apply && !opts.sendTo && !opts.out) {
    throw new UsageError('--apply needs --send-to <ssh host> or --out <path> for the secrets');
  }
  return opts;
}

/**
 * The four players from the users file: { "<name>": "<16 char Foundry user id>" }.
 * @param {string} text
 * @returns {{ name: string, tokenName: string, userId: string }[]}
 */
export function parseUsers(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new UsageError('the users file is not valid JSON');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new UsageError('the users file must be an object of player name to user id');
  }
  const entries = Object.entries(data);
  if (entries.length !== 4) {
    throw new UsageError(`the users file must list exactly four players (found ${entries.length})`);
  }
  const seen = new Set();
  return entries.map(([rawName, userId]) => {
    const name = rawName.trim();
    if (!name) throw new UsageError('a player name is empty');
    if (typeof userId !== 'string' || !USER_ID.test(userId)) {
      throw new UsageError(`the user id for ${name} must be 16 letters and digits`);
    }
    const tokenName = `player-${name.toLowerCase()}`;
    if (seen.has(tokenName)) throw new UsageError(`two players share the token name ${tokenName}`);
    seen.add(tokenName);
    return { name, tokenName, userId };
  });
}

/** Output that cannot carry a known secret: every registered value is masked before it is written. */
export function makeLogger({ stdout, stderr }) {
  const secrets = new Set();
  const scrub = text => {
    let out = String(text);
    for (const s of secrets) out = out.split(s).join('[hidden]');
    return out;
  };
  return {
    hide(value) {
      if (typeof value === 'string' && value.length >= 6) secrets.add(value);
    },
    scrub,
    out: line => stdout(`${scrub(line)}\n`),
    err: line => stderr(`${scrub(line)}\n`),
  };
}

/**
 * A Cloudflare API client. Failures throw an Error with method, path, status and Cloudflare's own
 * messages; never a request body, header or token.
 */
export function createClient({ fetch, token }) {
  return async function call(method, apiPath, body) {
    let res;
    try {
      res = await fetch(`${API_BASE}${apiPath}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      throw new Error(`${method} ${apiPath} failed: network error${code ? ` (${code})` : ''}`, { cause: error });
    }
    let json;
    try {
      json = await res.json();
    } catch {
      json = undefined;
    }
    if (!res.ok || !json || json.success === false) {
      const messages = (json?.errors ?? [])
        .map(e => (e && e.message ? String(e.message) : ''))
        .filter(Boolean)
        .join('; ');
      throw new Error(
        `${method} ${apiPath} failed: HTTP ${res.status}${messages ? `: ${messages}` : ''}`
      );
    }
    return json.result;
  };
}

/** Same JSON with sorted keys, so Cloudflare's key order does not look like a change. */
export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(k => `${JSON.stringify(k)}:${stable(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * The tunnel ingress with the player route in place, plus what changed.
 * Every other entry is kept as it is, the catch-all stays last.
 * @returns {{ ingress: object[], changed: boolean, teamName: string, others: string[] }}
 */
export function buildIngress(existing, { host, origin, aud, routePath = '^/mcp/player$' }) {
  if (!Array.isArray(existing) || existing.length === 0) {
    throw new Error('the tunnel has no ingress rules to extend');
  }
  const last = existing[existing.length - 1];
  if (last.hostname) {
    throw new Error('the last ingress entry has a hostname: expected a catch-all without one');
  }
  let teamName;
  for (const entry of existing) {
    const found = entry?.originRequest?.access?.teamName;
    if (found) {
      teamName = found;
      break;
    }
  }
  if (!teamName) {
    throw new Error(
      'no ingress entry carries originRequest.access.teamName, cannot learn the team name'
    );
  }
  const rest = existing.slice(0, -1);
  const mine = rest.filter(e => e.hostname === host);
  if (mine.some(e => e.path !== routePath)) {
    throw new Error(`${host} already has an ingress entry with another path: fix it by hand first`);
  }
  const entry = {
    hostname: host,
    path: routePath,
    service: origin,
    originRequest: { access: { required: true, teamName, audTag: [aud] } },
  };
  const index = rest.findIndex(e => e.hostname === host);
  const ingress = [...rest];
  if (index >= 0) ingress[index] = entry;
  else ingress.push(entry);
  ingress.push(last);
  return {
    ingress,
    changed: stable(ingress) !== stable(existing),
    teamName,
    others: rest.filter(e => e.hostname !== host).map(e => e.hostname ?? '(no hostname)'),
  };
}

function ssh(spawn, host, content) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawn('ssh', [host, `umask 077; cat > ${REMOTE_FILE}`], {
        stdio: ['pipe', 'inherit', 'inherit'],
      });
    } catch {
      resolve(-1);
      return;
    }
    child.on('error', () => resolve(-1));
    child.on('close', code => resolve(code ?? -1));
    child.stdin.on('error', () => {});
    child.stdin.end(content);
  });
}

/**
 * True when `file` sits in this repo or in any folder tree that holds a `.git` (a checkout, a worktree,
 * the Obsidian vault): the login table holds secrets and must never land where git could pick it up.
 */
function insideRepo(file, repoRoot) {
  const abs = path.resolve(file);
  const rel = path.relative(repoRoot, abs);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return true;
  for (let dir = path.dirname(abs); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, '.git'))) return true;
    if (path.dirname(dir) === dir) return false;
  }
}

/** " (mode 600)" where the file mode means something; on Windows the home folder's own access rules apply. */
const MODE_NOTE = process.platform === 'win32' ? '' : ' (mode 600)';

/** Hands the file content to the Pi over ssh, or to a 0600 file as the fallback or on request. */
export async function deliver({ content, opts, spawn, log, fallbackDir }) {
  if (opts.out) {
    const target = path.resolve(opts.out);
    try {
      // wx: never overwrite (an existing file keeps its old mode and may be someone else's).
      writeFileSync(target, content, { mode: 0o600, flag: 'wx' });
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw new UsageError(`${target} exists already: delete it or pick another --out path`);
      }
      throw error;
    }
    log.out(
      `ok: wrote ${target}${MODE_NOTE}. Copy it to the Pi as ${REMOTE_FILE}, then delete it here.`
    );
    return;
  }
  const code = await ssh(spawn, opts.sendTo, content);
  if (code === 0) {
    log.out(`ok: sent the player file to ${opts.sendTo}:${REMOTE_FILE}`);
    return;
  }
  const target = path.join(fallbackDir, 'player-connector.json.new');
  mkdirSync(fallbackDir, { recursive: true });
  // An old fallback file may carry an older mode; remove it so the new one is created 0600.
  rmSync(target, { force: true });
  writeFileSync(target, content, { mode: 0o600, flag: 'wx' });
  log.err(`ssh to ${opts.sendTo} failed (exit ${code}).`);
  log.out(`ok: wrote the fallback file ${target}${MODE_NOTE}.`);
  log.out(`Copy it to the Pi as ${REMOTE_FILE} (scp), then delete it from this PC.`);
}

/**
 * Plan (apply false) or apply the Cloudflare setup. Plan only reads.
 * @param {object} deps
 * @returns {Promise<void>}
 */
export async function run({ opts, users, call, log, spawn, fallbackDir, repoRoot = REPO_ROOT }) {
  const { apply, rotate, host, zone, tunnel, origin } = opts;
  const verb = (done, would) => (apply ? done : would);
  if (apply && opts.out && insideRepo(opts.out, repoRoot)) {
    throw new UsageError('--out is inside a git folder: pick a path outside it');
  }
  log.out(
    apply
      ? `Applying the player connector setup for ${host}`
      : `Plan for ${host} (nothing is changed)`
  );

  // 1. Account, zone, tunnel.
  const accounts = await call('GET', '/accounts?per_page=50');
  if (!Array.isArray(accounts) || accounts.length !== 1) {
    throw new Error(`expected exactly one Cloudflare account, found ${accounts?.length ?? 0}`);
  }
  const account = accounts[0].id;
  const zones = await call('GET', `/zones?name=${encodeURIComponent(zone)}`);
  if (!zones?.[0]?.id) throw new Error(`zone ${zone} not found`);
  const zoneId = zones[0].id;
  const tunnels = await call(
    'GET',
    `/accounts/${account}/cfd_tunnel?is_deleted=false&name=${encodeURIComponent(tunnel)}`
  );
  if (!Array.isArray(tunnels) || tunnels.length !== 1) {
    throw new Error(`expected exactly one tunnel named ${tunnel}, found ${tunnels?.length ?? 0}`);
  }
  const tunnelId = tunnels[0].id;
  log.out(`ok: account, zone ${zone} and tunnel ${tunnel} found`);

  // 2. Service tokens. Existence is checked first so a refusal changes nothing.
  const tokenPath = `/accounts/${account}/access/service_tokens`;
  const listed = (await call('GET', `${tokenPath}?per_page=100`)) ?? [];
  const byName = new Map(listed.map(t => [t.name, t]));
  const existing = users.filter(u => byName.has(u.tokenName));
  if (existing.length > 0 && !rotate) {
    const names = existing.map(u => u.tokenName).join(', ');
    if (apply) {
      throw new UsageError(
        `token ${names} exists and its secret cannot be read: re-run with --rotate for those, or delete them in Cloudflare`
      );
    }
    for (const u of existing)
      log.out(`exists: service token ${u.tokenName} (apply needs --rotate or a delete)`);
  }
  const tokens = new Map(); // tokenName -> { id, clientId, secret }
  let touched = false;
  try {
    for (const u of users) {
      const found = byName.get(u.tokenName);
      if (!found) {
        if (!apply) {
          log.out(`would create: service token ${u.tokenName}`);
          continue;
        }
        const made = await call('POST', tokenPath, { name: u.tokenName, duration: TOKEN_DURATION });
        touched = true;
        log.hide(made.client_secret);
        tokens.set(u.tokenName, {
          id: made.id,
          clientId: made.client_id,
          secret: made.client_secret,
        });
        log.out(`created: service token ${u.tokenName}`);
      } else if (rotate && apply) {
        const made = await call('POST', `${tokenPath}/${found.id}/rotate`);
        touched = true;
        log.hide(made.client_secret);
        tokens.set(u.tokenName, {
          id: found.id,
          clientId: made.client_id ?? found.client_id,
          secret: made.client_secret,
        });
        log.out(`changed: service token ${u.tokenName} rotated`);
      } else if (rotate) {
        log.out(`would change: rotate service token ${u.tokenName}`);
      }
    }
    const tokenIds = users.map(
      u => tokens.get(u.tokenName)?.id ?? byName.get(u.tokenName)?.id ?? null
    );
    if (apply && users.some(u => !tokens.get(u.tokenName)?.secret)) {
      throw new Error('a token secret is missing: nothing further is written');
    }

    // 3. Reusable policy.
    const policyPath = `/accounts/${account}/access/policies`;
    const policies = (await call('GET', `${policyPath}?per_page=100`)) ?? [];
    const policy = policies.find(p => p.name === POLICY_NAME);
    const wantedIds = tokenIds.filter(Boolean).sort();
    const policyBody = {
      name: POLICY_NAME,
      decision: 'non_identity',
      include: tokenIds.map(id => ({ service_token: { token_id: id } })),
    };
    let policyId = policy?.id;
    const haveIds = (policy?.include ?? [])
      .map(i => i?.service_token?.token_id)
      .filter(Boolean)
      .sort();
    const sameInclude =
      policy &&
      policy.decision === 'non_identity' &&
      stable(haveIds) === stable(wantedIds) &&
      wantedIds.length === users.length;
    if (!policy) {
      if (apply) policyId = (await call('POST', policyPath, policyBody)).id;
      log.out(`${verb('created', 'would create')}: policy ${POLICY_NAME}`);
    } else if (!sameInclude) {
      if (apply) await call('PUT', `${policyPath}/${policy.id}`, policyBody);
      log.out(`${verb('changed', 'would change')}: policy ${POLICY_NAME} (the four tokens)`);
    } else {
      log.out(`exists: policy ${POLICY_NAME}`);
    }

    // 4. Access application. No allow or email policy: only the tokens get in.
    const appPath = `/accounts/${account}/access/apps`;
    const apps = (await call('GET', `${appPath}?per_page=100`)) ?? [];
    const app = apps.find(a => a.domain === host);
    const appBody = {
      name: APP_NAME,
      type: 'self_hosted',
      domain: host,
      session_duration: '24h',
      app_launcher_visible: false,
      policies: [{ id: policyId }],
    };
    let aud = app?.aud;
    const appPolicyIds = (app?.policies ?? []).map(p => (typeof p === 'string' ? p : p?.id));
    if (!app) {
      if (apply) aud = (await call('POST', appPath, appBody)).aud;
      log.out(`${verb('created', 'would create')}: Access application ${APP_NAME} on ${host}`);
    } else if (stable(appPolicyIds) !== stable([policyId])) {
      if (apply) aud = (await call('PUT', `${appPath}/${app.id}`, appBody)).aud ?? aud;
      log.out(`${verb('changed', 'would change')}: Access application ${APP_NAME} (policies)`);
    } else {
      log.out(`exists: Access application ${APP_NAME} on ${host}`);
    }
    if (apply && !aud) throw new Error('the Access application has no aud tag');

    // 5. Tunnel ingress, restricted to /mcp/player.
    const cfgPath = `/accounts/${account}/cfd_tunnel/${tunnelId}/configurations`;
    const cfg = await call('GET', cfgPath);
    if (!cfg?.config) throw new Error(`tunnel ${tunnel} has no remote configuration`);
    const built = buildIngress(cfg.config.ingress, { host, origin, aud: aud ?? 'AUD-AFTER-APPLY' });
    if (built.changed) {
      if (apply) await call('PUT', cfgPath, { config: { ...cfg.config, ingress: built.ingress } });
      log.out(
        `${verb('changed', 'would change')}: tunnel ingress, ${host} /mcp/player added before the catch-all`
      );
    } else {
      log.out(`exists: tunnel ingress for ${host} /mcp/player`);
    }
    log.out(`  other ingress entries left as they are: ${built.others.join(', ') || '(none)'}`);

    // 6. DNS.
    const records = await call(
      'GET',
      `/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(host)}`
    );
    if (!records || records.length === 0) {
      if (apply) {
        await call('POST', `/zones/${zoneId}/dns_records`, {
          type: 'CNAME',
          name: host,
          content: `${tunnelId}.cfargotunnel.com`,
          proxied: true,
          ttl: 1,
        });
      }
      log.out(`${verb('created', 'would create')}: DNS CNAME ${host}`);
    } else {
      log.out(`exists: DNS CNAME ${host}`);
    }

    if (!apply) {
      log.out(
        'This was a plan. Re-run with --apply (and --send-to or --out) to make these changes.'
      );
      return;
    }

    // 7. The file for the Pi.
    const content = `${JSON.stringify(
      {
        endpoint: `https://${host}/mcp/player`,
        audience: aud,
        players: users.map(u => ({
          clientId: tokens.get(u.tokenName).clientId,
          clientSecret: tokens.get(u.tokenName).secret,
          userId: u.userId,
        })),
      },
      null,
      2
    )}\n`;
    await deliver({ content, opts, spawn, log, fallbackDir });
    log.out('');
    log.out(`Next: run stage 30 on the Pi (it installs ${REMOTE_FILE}).`);
    log.out(`Then test https://${host}/mcp/player (and check that other paths on it stay closed).`);
  } catch (error) {
    if (touched && error instanceof Error) {
      error.message +=
        ' (service tokens were already created or rotated; their secrets are gone, re-run with --rotate)';
    }
    throw error;
  }
}

/** Reads a line from the terminal with echo off. Fails when there is no terminal. */
export function promptHidden(question, { stdin = process.stdin, stderr = process.stderr } = {}) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    return Promise.reject(
      new UsageError(
        'no terminal to ask for the API token: set CLOUDFLARE_API_TOKEN or run in a terminal'
      )
    );
  }
  return new Promise((resolve, reject) => {
    stderr.write(question);
    let buf = '';
    const finish = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stderr.write('\n');
    };
    const onData = chunk => {
      for (const ch of String(chunk)) {
        if (ch === '\r' || ch === '\n') {
          finish();
          resolve(buf);
          return;
        }
        if (ch === '\u0003') {
          finish();
          reject(new UsageError('cancelled'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') buf = buf.slice(0, -1);
        else buf += ch;
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
  });
}

/**
 * The command line. Everything it touches comes in through `deps`, so tests need no network.
 * @returns {Promise<number>} the exit code
 */
export async function main(argv, deps = {}) {
  const {
    env = process.env,
    fetch = globalThis.fetch,
    prompt = () => promptHidden('Cloudflare API token (hidden): '),
    spawn = nodeSpawn,
    stdout = s => process.stdout.write(s),
    stderr = s => process.stderr.write(s),
    readFile = file => readFileSync(file, 'utf8'),
    fallbackDir = os.homedir(),
    repoRoot = REPO_ROOT,
  } = deps;
  const log = makeLogger({ stdout, stderr });
  let token;
  try {
    const opts = parseArgs(argv);
    const users = parseUsers(readFile(opts.users));
    if (opts.out && insideRepo(opts.out, repoRoot)) {
      throw new UsageError('--out is inside a git folder: pick a path outside it');
    }
    // Before any token is made: the secrets exist only once, so the write at the end must not fail.
    if (opts.out && existsSync(path.resolve(opts.out))) {
      throw new UsageError(
        `${path.resolve(opts.out)} exists already: delete it or pick another --out path`
      );
    }
    token = env.CLOUDFLARE_API_TOKEN || (await prompt());
    token = String(token ?? '').trim();
    if (!token) throw new UsageError('no API token given');
    log.hide(token);
    const call = createClient({ fetch, token });
    await run({ opts, users, call, log, spawn, fallbackDir, repoRoot });
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    log.err(`error: ${message}`);
    return error instanceof UsageError ? 2 : 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => {
    process.exitCode = code;
  });
}
