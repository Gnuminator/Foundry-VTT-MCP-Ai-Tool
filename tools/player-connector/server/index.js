#!/usr/bin/env node
'use strict';
/**
 * Foundry player connector (D-136): an MCP server on stdio that forwards JSON-RPC requests as HTTPS
 * POSTs to the table's read-only player endpoint, adding the two Cloudflare Access service-token
 * headers. No dependencies. No secret is ever written to stdout, stderr or a file; every message
 * this process prints is fixed text or has the secret values scrubbed out.
 *
 * Environment (set by Claude Desktop from the extension's settings):
 *   FOUNDRY_PLAYER_ENDPOINT        https:// address (http only for localhost, for tests)
 *   FOUNDRY_PLAYER_CLIENT_ID       CF-Access-Client-Id
 *   FOUNDRY_PLAYER_CLIENT_SECRET   CF-Access-Client-Secret
 *   FOUNDRY_PLAYER_TIMEOUT_MS      per-request timeout, default 70000 (initialize: at most 10000);
 *                                  the dashboard gives a player tool 60 s, so this waits a bit longer
 */

const readline = require('node:readline');

const VERSION = '0.1.5';

// Protocol versions the local initialize answer offers; the newest is the fallback.
const PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'];
// Claude Desktop gives a starting extension little time: cap the first initialize attempt.
const INIT_TIMEOUT_MS = 10000;

/** Replace every secret value of 4 or more characters in `text`. */
function scrub(text, secrets) {
  let out = String(text);
  for (const s of secrets) {
    if (s && s.length >= 4) out = out.split(s).join('[hidden]');
  }
  return out;
}

function isLocalHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/** Validate the endpoint address. Returns {url} or {error}. */
function parseEndpoint(raw) {
  if (!raw || !raw.trim()) {
    return {
      error:
        'No endpoint address is set. Open the extension settings in Claude Desktop and fill in the Endpoint address.',
    };
  }
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return { error: 'The endpoint address in the extension settings is not a valid web address.' };
  }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocalHost(u.hostname))) {
    return {
      error:
        'The endpoint address must start with https:// (the login is never sent over plain http).',
    };
  }
  if (u.username || u.password)
    return { error: 'The endpoint address must not contain a user name or password.' };
  return { url: u.toString() };
}

/** Map a failure to text a player can act on. `status` is an HTTP status, `kind` a transport failure. */
function describeFailure({ status, kind }) {
  if (kind === 'timeout')
    return 'The table did not answer in time. Check your internet connection and try again in a minute.';
  if (kind === 'network') {
    return 'Could not reach the table. Check your internet connection; if it works, the table server may be off right now.';
  }
  if (kind === 'redirect' || status === 401 || status === 403) {
    const what = status ? `HTTP ${status}` : 'sent to a sign-in page';
    return `The table refused the login (${what}). Check the Client ID and Client Secret in the extension settings, or ask whoever gave them to you for new ones.`;
  }
  if (status === 404)
    return 'The player endpoint was not found at that address (HTTP 404). Check the Endpoint address in the extension settings.';
  if (status === 429) return 'Too many requests (HTTP 429). Wait a moment and try again.';
  if (status >= 500)
    return `The table server had a problem (HTTP ${status}). Try again in a minute.`;
  if (kind === 'badbody')
    return 'The table answered with something Claude cannot read. The endpoint address may be wrong.';
  return `The table answered with an unexpected status (HTTP ${status}).`;
}

/** Pull the JSON-RPC response for `id` out of a text/event-stream body. */
function fromEventStream(text, id) {
  let found = null;
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter(l => l.startsWith('data:'))
      .map(l => l.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) continue;
    try {
      const msg = JSON.parse(data);
      if (msg && msg.id === id && (msg.result !== undefined || msg.error !== undefined))
        found = msg;
    } catch {
      /* skip a block that is not JSON */
    }
  }
  return found;
}

function createForwarder(env, fetchImpl) {
  // Pasted values often carry a trailing space or newline; a newline would make fetch throw.
  const clientId = (env.FOUNDRY_PLAYER_CLIENT_ID || '').trim();
  const clientSecret = (env.FOUNDRY_PLAYER_CLIENT_SECRET || '').trim();
  const secrets = [clientId, clientSecret];
  const timeoutMs =
    Number(env.FOUNDRY_PLAYER_TIMEOUT_MS) > 0 ? Number(env.FOUNDRY_PLAYER_TIMEOUT_MS) : 70000;
  const endpoint = parseEndpoint(env.FOUNDRY_PLAYER_ENDPOINT);
  const missing = !clientId || !clientSecret;
  // Header values must be printable ASCII; anything else makes fetch throw before it sends.
  const printable = /^[\x21-\x7e]+$/;
  const badChars = !missing && !(printable.test(clientId) && printable.test(clientSecret));
  let sessionId = null;
  let initRequest = null;
  let initFailed = false;
  let reinit = null;
  const api = { forward: null, secrets, onRecovered: null };

  /**
   * The local initialize answer hid a failure: try the real initialize again before the next
   * request. One attempt is shared by requests that arrive together. Returns the failure, or null.
   */
  function ensureInit() {
    if (!initFailed || !initRequest) return null;
    if (!reinit) {
      reinit = (async () => {
        sessionId = null;
        const re = await send(
          { ...initRequest, id: `reinit-${Date.now()}` },
          Math.min(timeoutMs, INIT_TIMEOUT_MS)
        );
        if (re.failure) return re;
        await send({ jsonrpc: '2.0', method: 'notifications/initialized' }).catch(() => undefined);
        initFailed = false;
        if (api.onRecovered) api.onRecovered();
        return null;
      })().finally(() => {
        reinit = null;
      });
    }
    return reinit;
  }
  let reinitInFlight = null;

  /** One POST. Returns {message} (a JSON-RPC response object) or {failure: text, status?}. */
  async function send(request, limitMs = timeoutMs) {
    if (endpoint.error) return { failure: endpoint.error };
    if (missing) {
      return {
        failure:
          'The Client ID or Client Secret is empty. Open the extension settings in Claude Desktop and fill both in.',
      };
    }
    if (badChars) {
      return {
        failure:
          'The Client ID or Client Secret contains a character that is not allowed (a space, a line break or a special letter). Open the extension settings, delete both values and paste them again.',
      };
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), limitMs);
    try {
      const headers = {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'cf-access-client-id': clientId,
        'cf-access-client-secret': clientSecret,
        'user-agent': `foundry-player-connector/${VERSION}`,
      };
      if (sessionId) headers['mcp-session-id'] = sessionId;
      const res = await fetchImpl(endpoint.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        redirect: 'manual',
        signal: ctl.signal,
      });
      if (res.status >= 300 && res.status < 400) {
        // A refusal says nothing about whether the server's session is alive: keep the id.
        return { failure: describeFailure({ kind: 'redirect' }), status: res.status };
      }
      if (res.status < 200 || res.status >= 300) {
        await res.arrayBuffer().catch(() => undefined); // never echo a body that could hold detail
        return { failure: describeFailure({ status: res.status }), status: res.status };
      }
      const sid = res.headers.get('mcp-session-id');
      if (sid) sessionId = sid;
      const text = await res.text();
      const type = (res.headers.get('content-type') || '').toLowerCase();
      let message = null;
      if (type.includes('text/event-stream')) message = fromEventStream(text, request.id);
      else {
        try {
          message = JSON.parse(text);
        } catch {
          message = null;
        }
      }
      if (
        !message ||
        typeof message !== 'object' ||
        Array.isArray(message) ||
        (message.result === undefined && message.error === undefined)
      ) {
        return { failure: describeFailure({ kind: 'badbody' }) };
      }
      return { message };
    } catch (err) {
      if (err && err.name === 'AbortError')
        return { failure: describeFailure({ kind: 'timeout' }) };
      return { failure: describeFailure({ kind: 'network' }) };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Send a request. If the server forgot our session (404 while we hold a session id, for
   * example after a restart), start a new one with the stored initialize and retry once.
   */
  async function forward(request) {
    if (request.method === 'initialize') {
      initRequest = request;
      sessionId = null;
    }
    if (request.method !== 'initialize') {
      const bad = await ensureInit();
      if (bad) return bad;
    }
    // A call that starts while a new session is being set up waits for it.
    if (request.method !== 'initialize' && reinitInFlight)
      await reinitInFlight.catch(() => undefined);
    const had = sessionId;
    const first = await send(
      request,
      request.method === 'initialize' ? Math.min(timeoutMs, INIT_TIMEOUT_MS) : timeoutMs
    );
    if (request.method === 'initialize') initFailed = !!first.failure;
    if (!(first.status === 404 && had && initRequest && request.method !== 'initialize'))
      return first;
    // Calls that go stale together share one new session; a call that finds the session
    // already replaced just retries.
    if (sessionId === had && !reinitInFlight) {
      reinitInFlight = (async () => {
        sessionId = null;
        const re = await send(
          { ...initRequest, id: `reinit-${Date.now()}` },
          Math.min(timeoutMs, INIT_TIMEOUT_MS)
        );
        if (re.failure || re.message.error) {
          sessionId = had; // keep the old id so the next 404 tries again
          return re;
        }
        await send({ jsonrpc: '2.0', method: 'notifications/initialized' }).catch(() => undefined);
        return null;
      })().finally(() => {
        reinitInFlight = null;
      });
    }
    if (reinitInFlight) {
      const bad = await reinitInFlight;
      if (bad) return bad; // a failure text or the server's own JSON-RPC error
    }
    return send(request);
  }

  api.forward = forward;
  return api;
}

/** Handle one parsed stdin message. Returns the response object to write, or null for nothing. */
async function handleMessage(msg, forwarder) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } };
  }
  const hasId = msg.id !== null && msg.id !== undefined;
  if (!hasId) return null; // notifications (initialized, cancelled) need no answer and are not forwarded
  if (msg.method === 'ping') return { jsonrpc: '2.0', id: msg.id, result: {} };
  if (typeof msg.method !== 'string') {
    return { jsonrpc: '2.0', id: msg.id, error: { code: -32600, message: 'Invalid request' } };
  }
  const statusCall =
    msg.method === 'tools/call' && msg.params && msg.params.name === 'connection-status';
  // The status tool is ours, not the server's: check the connection with a tools/list.
  const out = await forwarder.forward({
    jsonrpc: '2.0',
    id: msg.id,
    method: statusCall ? 'tools/list' : msg.method,
    params: statusCall ? undefined : msg.params,
  });
  if (statusCall && !out.failure) {
    return {
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        content: [
          {
            type: 'text',
            text: "Connected to the table. If the table's tools are missing from Claude, turn the extension off and on again in Claude Desktop settings.",
          },
        ],
      },
    };
  }
  if (out.failure) {
    const text = scrub(out.failure, forwarder.secrets);
    if (msg.method === 'tools/call') {
      // Shown to the player as a tool result, so Claude can relay it in plain words.
      return {
        jsonrpc: '2.0',
        id: msg.id,
        result: { isError: true, content: [{ type: 'text', text }] },
      };
    }
    // Desktop is expected to show only a generic "failed to start" when initialize errors, hiding
    // the reason (to be confirmed by a manual install). Answer initialize and tools/list locally
    // so the extension stays loaded and the reason reaches the player as a tool (its description)
    // and as the tool's result.
    if (msg.method === 'initialize') {
      const asked = msg.params && msg.params.protocolVersion;
      return {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked)
            ? asked
            : PROTOCOL_VERSIONS[PROTOCOL_VERSIONS.length - 1],
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: 'foundry-player', version: VERSION },
        },
      };
    }
    if (msg.method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          tools: [
            {
              name: 'connection-status',
              description: `The table connection is not working. ${text}`,
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        },
      };
    }
    return { jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: text } };
  }
  const reply = { ...out.message, jsonrpc: '2.0', id: msg.id };
  return JSON.parse(scrub(JSON.stringify(reply), forwarder.secrets));
}

function write(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function main() {
  // The reader went away (Claude Desktop closed the pipe): leave quietly.
  process.stdout.on('error', () => process.exit(0));
  const forwarder = createForwarder(process.env, (...a) => fetch(...a));
  forwarder.onRecovered = () =>
    write({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const pending = new Set();
  rl.on('line', line => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    const p = handleMessage(msg, forwarder)
      .then(r => {
        if (r) write(r);
      })
      .catch(() => {
        if (msg && msg.id !== undefined && msg.id !== null) {
          write({
            jsonrpc: '2.0',
            id: msg.id,
            error: { code: -32603, message: 'Internal error in the connector.' },
          });
        }
      })
      .finally(() => pending.delete(p));
    pending.add(p);
  });
  rl.on('close', () => {
    // An empty write's callback runs after the earlier writes are flushed, so no reply is lost.
    Promise.allSettled([...pending]).then(() => process.stdout.write('', () => process.exit(0)));
  });
}

module.exports = {
  scrub,
  parseEndpoint,
  describeFailure,
  fromEventStream,
  createForwarder,
  handleMessage,
};

// Claude Desktop starts extension servers through its own launcher, which may load this file with
// require(), so `require.main === module` is false there and main() would never run: the process
// idled and Desktop reported "didn't respond within 2 minutes". Always start; only the tests, which
// load the file as a library, set FOUNDRY_PLAYER_NO_MAIN=1 first.
if (process.env.FOUNDRY_PLAYER_NO_MAIN !== '1') main();
