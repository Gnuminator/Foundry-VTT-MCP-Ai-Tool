/**
 * Client for the co-GM dashboard's HTTP API, extracted from scripts/live-roundtrip.mjs and
 * scripts/live-write-sweep.mjs (those stay as they are; they are merge gates).
 */
import { EnvError, KitToolError } from './errors.mjs';

/** Tools that only read: no confirmation needed (the dashboard's tool policy). */
const READ_RE = /^(get|list|search|measure|plan|suggest)-/;
const READ_EXTRA = new Set(['check-secret-terms', 'open-in-foundry', 'mark-play-session']);
/** Tools whose class is destructive in the dashboard's tool policy: both confirmations. */
const DESTRUCTIVE = new Set([
  'undo-change',
  'clear-module-errors',
]);

/** @param {string} name */
export function isReadTool(name) {
  return READ_RE.test(name) || READ_EXTRA.has(name);
}

/** @param {string} name */
export function isDestructiveTool(name) {
  return DESTRUCTIVE.has(name);
}

/**
 * @param {{base: string, token?: string}} opts
 */
export function createDashboardClient({ base, token = process.env.COGM_TOKEN || '' }) {
  /**
   * @param {string} path
   * @param {{method?: string, body?: unknown, timeoutMs?: number, text?: boolean}} [opts]
   *   `text: true` returns the body as a string in `data` instead of parsing JSON.
   * @returns {Promise<{status: number, data: any}>}
   */
  async function http(path, { method = 'GET', body, timeoutMs = 30000, text = false } = {}) {
    let res;
    try {
      res = await fetch(base + path, {
        method,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(token ? { 'X-CoGM-Token': token } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const err = /** @type {any} */ (e);
      const code = err && err.cause && err.cause.code;
      if (
        code === 'ECONNREFUSED' ||
        code === 'ECONNRESET' ||
        code === 'UND_ERR_CONNECT_TIMEOUT' ||
        code === 'UND_ERR_SOCKET'
      ) {
        throw new EnvError(`nothing is listening on ${base}`);
      }
      if (err && err.name === 'TimeoutError') {
        throw new Error(`${method} ${path} timed out after ${timeoutMs} ms`);
      }
      throw e;
    }
    let data = null;
    if (text) {
      data = await res.text();
    } else {
      try {
        data = await res.json();
      } catch {
        /* not JSON */
      }
    }
    return { status: res.status, data };
  }

  /** @returns {Promise<{ok: boolean, controlChannel: any}>} */
  async function health() {
    const { status, data } = await http('/api/health');
    if (status !== 200 || !data) throw new EnvError(`${base}/api/health answered HTTP ${status}`);
    return data;
  }

  /** @type {{tools: any[], gmActionsEnabled: boolean} | null} */
  let toolsCache = null;
  async function tools(refresh = false) {
    if (toolsCache && !refresh) return toolsCache;
    const { status, data } = await http('/api/tools');
    if (status !== 200 || !data) throw new EnvError(`${base}/api/tools answered HTTP ${status}`);
    toolsCache = data;
    return data;
  }

  /**
   * Calls a bridge tool. Non-read tools get `confirm: true`; destructive ones also
   * `confirmDestructive: true`. Explicit `flags` win. Returns `result`.
   * @param {string} name
   * @param {object} [args]
   * @param {{confirm?: boolean, confirmDestructive?: boolean}} [flags]
   */
  async function tool(name, args = {}, flags = {}) {
    const auto = {
      ...(isReadTool(name) ? {} : { confirm: true }),
      ...(DESTRUCTIVE.has(name) ? { confirmDestructive: true } : {}),
    };
    const { status, data } = await http('/api/tool', {
      method: 'POST',
      body: { name, args, ...auto, ...flags },
      timeoutMs: 70000,
    });
    if (status === 403 && data && data.code === 'gm-required') {
      throw new EnvError('the dashboard needs the GM token (set COGM_TOKEN)');
    }
    if (!data || data.ok !== true) {
      throw new KitToolError({
        kind: (data && (data.kind || data.code)) || 'http',
        status,
        error: (data && (data.error || data.code)) || `HTTP ${status}`,
        name,
        reply: data,
      });
    }
    const result = data.result;
    if (typeof result === 'string' && /^(Parameter error|Error)\b/i.test(result.trim())) {
      throw new KitToolError({
        kind: 'tool-error',
        status,
        error: result.trim(),
        name,
        reply: result,
      });
    }
    return result;
  }

  async function getGmActions() {
    const { gmActionsEnabled } = await tools(true);
    return Boolean(gmActionsEnabled);
  }

  /** @param {boolean} value */
  async function setGmActions(value) {
    const { status, data } = await http('/api/control', {
      method: 'POST',
      body: { action: 'set-gm-actions', value },
    });
    if (status !== 200) {
      throw new Error(`/api/control answered HTTP ${status}`);
    }
    toolsCache = null;
    return data;
  }

  /**
   * A plan tool, then apply-planned-change (both confirmations for a destructive plan).
   * @param {string} planTool
   * @param {object} args
   * @returns {Promise<{planId: string, changeId: string, plan: any}>}
   */
  async function planApply(planTool, args) {
    const plan = await tool(planTool, args);
    if (!plan || !plan.planId) {
      throw new KitToolError({
        kind: 'no-plan',
        error: `no plan: ${brief(plan)}`,
        name: planTool,
        reply: plan,
      });
    }
    const change = await tool(
      'apply-planned-change',
      { planId: plan.planId },
      { confirm: true, ...(plan.risk === 'destructive' ? { confirmDestructive: true } : {}) }
    );
    if (!change || !change.changeId) {
      throw new KitToolError({
        kind: 'not-applied',
        error: `not applied: ${brief(change)}`,
        name: 'apply-planned-change',
        reply: change,
      });
    }
    return { planId: plan.planId, changeId: change.changeId, plan };
  }

  /** @param {string} changeId */
  async function undo(changeId) {
    return tool('undo-change', { changeId }, { confirm: true, confirmDestructive: true });
  }

  return { base, http, health, tools, tool, getGmActions, setGmActions, planApply, undo };
}

/** Short text for messages. @param {unknown} value @param {number} [max] */
export function brief(value, max = 120) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const s = text === undefined ? 'undefined' : text;
  return s.length > max ? `${s.slice(0, max)}...` : s;
}
