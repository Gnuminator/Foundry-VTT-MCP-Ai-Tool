// A fake /api for the stories. The panels fetch through lib/api.ts (`fetch('/api/...')`), so a story
// that wants a panel in a state (loaded, empty, failed, the bridge down, GM Actions off, still
// loading) says what the dashboard would answer, and the panel runs its own code against it: the
// loading, the retry, the error text and the refetch after a change all behave as in the app.
// Nothing leaves the page: an /api call with no answer here gets a 404 that names it, so a story
// that forgot one fails loudly instead of showing a quiet "Loading…".
//
// A story gives its answers in `parameters.dashboard.api` (see withDashboard.tsx):
//
//   parameters: { dashboard: { api: {
//     routes: { '/api/player-links': reply({ players: [...] }) },       // by path
//     tools: { 'get-party': toolOk(PARTY) },                            // POST /api/tool, by name
//   } } }
//
// A route key is a path ('/api/space'), optionally with a method ('POST /api/session/switches'),
// or a prefix ending in `*` ('/api/help/*'). The handler is a reply or a function of the request.

export interface FakeRequest {
  /** The path without the query. */
  path: string;
  method: string;
  /** The JSON body of a write; for /api/tool the tool call (`name`, `args`, ...). */
  body: unknown;
  /** The tool's name and arguments when this is POST /api/tool. */
  tool?: { name: string; args: Record<string, unknown> };
}

/** What the fake answers: a status with a JSON body, or `'pending'` for an answer that never comes. */
export type Reply = { status?: number; json?: unknown } | 'pending';
export type Handler = Reply | ((request: FakeRequest) => Reply);

export interface FakeApi {
  routes?: Record<string, Handler>;
  /** POST /api/tool, by tool name. The reply is what the route sends, see `toolOk` and `toolFail`. */
  tools?: Record<string, Handler>;
}

/** A 200 with this JSON. */
export const reply = (json: unknown): Reply => ({ json });

/** A tool that worked: `{ ok: true, result }`, as POST /api/tool sends it. */
export const toolOk = (result: unknown): Reply => ({ json: { ok: true, result } });

/** A route that refused: the server's `{ error, kind?, code? }` body with a status. */
export const fail = (
  status: number,
  error: string,
  extra: { kind?: string; code?: string } = {}
): Reply => ({
  status,
  json: { error, ...extra },
});

/** The bridge is not connected (POST /api/tool answers kind `channel`): panels show "bridge down". */
export const bridgeDown: Reply = fail(502, 'The Foundry bridge is not connected.', {
  kind: 'channel',
});

/** GM Actions are off (403 `gm-actions-disabled`): panels show "switched off". */
export const gmActionsOff: Reply = fail(403, 'GM Actions are off.', {
  code: 'gm-actions-disabled',
});

/** No answer, ever: the panel stays in its loading state. */
export const pending: Reply = 'pending';

const NO_BODY = Symbol('no body');

function parseBody(init: RequestInit | undefined): unknown {
  const raw = init?.body;
  if (typeof raw !== 'string') return NO_BODY;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function pick(routes: Record<string, Handler>, method: string, path: string): Handler | undefined {
  const exact = routes[`${method} ${path}`] ?? routes[path];
  if (exact !== undefined) return exact;
  for (const [key, handler] of Object.entries(routes)) {
    const pattern = key.replace(/^[A-Z]+ /, '');
    const keyMethod = /^([A-Z]+) /.exec(key)?.[1];
    if (pattern.endsWith('*') && path.startsWith(pattern.slice(0, -1))) {
      if (keyMethod === undefined || keyMethod === method) return handler;
    }
  }
  return undefined;
}

function respond(reply: Reply, signal: AbortSignal | null | undefined): Promise<Response> {
  if (reply === 'pending') {
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });
  }
  const status = reply.status ?? 200;
  return Promise.resolve(
    status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(reply.json ?? {}), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
  );
}

function run(handler: Handler, request: FakeRequest): Reply {
  return typeof handler === 'function' ? handler(request) : handler;
}

/** The fetch the stories install: /api/* from the fake, everything else from the real fetch. */
export function makeFetch(api: FakeApi, real: typeof fetch): typeof fetch {
  return (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.href);
    if (!url.pathname.startsWith('/api/')) return real(input, init);

    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    const body = parseBody(init);
    const request: FakeRequest = {
      path: url.pathname,
      method,
      body: body === NO_BODY ? undefined : body,
    };

    if (method === 'POST' && url.pathname === '/api/tool' && typeof request.body === 'object') {
      const call = request.body as { name?: unknown; args?: unknown };
      if (typeof call.name === 'string') {
        const args = (call.args ?? {}) as Record<string, unknown>;
        request.tool = { name: call.name, args };
        const handler = api.tools?.[call.name];
        if (handler === undefined) {
          return respond(
            fail(404, `No fake answer for the tool ${call.name} in this story.`),
            init?.signal
          );
        }
        return respond(run(handler, request), init?.signal);
      }
    }

    const handler = api.routes ? pick(api.routes, method, url.pathname) : undefined;
    if (handler === undefined) {
      return respond(
        fail(404, `No fake answer for ${method} ${url.pathname} in this story.`),
        init?.signal
      );
    }
    return respond(run(handler, request), init?.signal);
  };
}
