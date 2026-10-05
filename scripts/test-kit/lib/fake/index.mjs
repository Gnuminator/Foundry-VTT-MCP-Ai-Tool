/**
 * The fake target: an in-process HTTP server that speaks the part of the co-GM dashboard API the
 * kit uses (/api/health, /api/tools, /api/tool, /api/control, /api/player/state, /player), on top
 * of a small in-memory world, plus a `gm` object with every GM action. `kit all --fake` builds
 * and runs the whole kit against it, so CI catches scenario and engine regressions without
 * Foundry. It does not simulate dnd5e.
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadToolCatalog } from '../catalog.mjs';
import { isDestructiveTool, isReadTool } from '../dashboard.mjs';
import { PLAYER_HTML, playerState } from './player.mjs';
import { createWorld } from './state.mjs';
import { createFakeGm } from './gm.mjs';
import { READ_TOOLS } from './tools-read.mjs';
import { GUARDED_TOOLS } from './tools-guarded.mjs';
import { COMBAT_TOOLS } from './tools-combat.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

const TOOLS = { ...READ_TOOLS, ...GUARDED_TOOLS, ...COMBAT_TOOLS };

/** Every tool name the fake implements. */
export const FAKE_TOOL_NAMES = Object.keys(TOOLS);

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

/** @param {import('node:http').IncomingMessage} req */
async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

/** @param {string} name */
function classify(name) {
  return isDestructiveTool(name) ? 'destructive' : isReadTool(name) ? 'read' : 'write';
}

/**
 * @param {{world: string}} opts
 * @returns {Promise<{base: string, gm: {call: (action: string, args?: object) => Promise<any>}, close: () => Promise<void>, world: import('./state.mjs').World}>}
 */
export async function startFake({ world: worldId }) {
  const catalog = await loadToolCatalog(repoRoot);
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const w = createWorld({ world: worldId, moduleVersion: pkg.version });

  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
  async function handleTool(req, res) {
    const body = await readBody(req);
    const name = String(body.name ?? '').trim();
    if (!name) return sendJson(res, 400, { error: 'A non-empty "name" is required.' });
    const mutates = classify(name);
    if (mutates !== 'read') {
      if (!w.gmActions) {
        return sendJson(res, 403, { code: 'gm-actions-disabled', error: 'GM Actions are off.' });
      }
      if (body.confirm !== true) {
        return sendJson(res, 412, { code: 'confirm-required', mutates, error: 'Confirm it.' });
      }
      if (mutates === 'destructive' && body.confirmDestructive !== true) {
        return sendJson(res, 412, {
          code: 'confirm-destructive-required',
          mutates,
          error: 'Needs explicit confirmation.',
        });
      }
    }
    const tool = /** @type {Record<string, any>} */ (TOOLS)[name];
    if (!tool) {
      const error = `Unknown tool "${name}" (the fake has not got it)`;
      return sendJson(res, 422, { ok: false, name, kind: 'tool', error });
    }
    try {
      const args = JSON.parse(JSON.stringify(body.args ?? {}));
      const flags = { confirm: body.confirm, confirmDestructive: body.confirmDestructive };
      const result = JSON.parse(JSON.stringify(tool(w, args, flags)));
      return sendJson(res, 200, { ok: true, name, mutates, result });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      return sendJson(res, 422, { ok: false, name, kind: 'tool', error });
    }
  }

  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://fake');
    const get = req.method === 'GET';
    if (get && url.pathname === '/api/health') {
      const body = { ok: true, controlChannel: 'connected', aiEnabled: false, splitEnabled: false };
      return sendJson(res, 200, body);
    }
    if (get && url.pathname === '/api/tools') {
      const tools = [...catalog.all].sort().map(name => ({
        name,
        description: '',
        inputSchema: { type: 'object', properties: {} },
        mutates: classify(name),
      }));
      return sendJson(res, 200, { tools, gmActionsEnabled: w.gmActions });
    }
    if (get && url.pathname === '/api/player/state') return sendJson(res, 200, playerState(w));
    if (get && url.pathname === '/player') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(PLAYER_HTML);
    }
    if (req.method === 'POST' && url.pathname === '/api/control') {
      const body = await readBody(req);
      if (body.action !== 'set-gm-actions') return sendJson(res, 400, { error: 'unknown action' });
      w.gmActions = body.value === true;
      return sendJson(res, 200, { ok: true, gmActionsEnabled: w.gmActions });
    }
    if (req.method === 'POST' && url.pathname === '/api/tool') return handleTool(req, res);
    return sendJson(res, 404, { error: 'not found' });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch(e =>
      sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) })
    );
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());

  return {
    base: `http://127.0.0.1:${address.port}`,
    gm: createFakeGm(w),
    world: w,
    close: () =>
      new Promise(resolve => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
