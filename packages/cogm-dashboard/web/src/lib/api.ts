import { authHeaders } from './auth';
import { toolWords } from './toolWords';

/**
 * A failed dashboard route: the server's own message when it sent one, else a plain sentence for
 * the status (`plainError`, never `HTTP <status>`).
 * `kind` is what failed when POST /api/tool reached the bridge: `tool`, `timeout` or `channel`.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind?: string,
    /** The server's own name for the refusal (`gm-actions-disabled`), when it sends one. */
    readonly code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** A string field of a JSON body, if it has one. */
const field = (body: unknown, key: string): string | undefined => {
  if (!body || typeof body !== 'object') return undefined;
  const value: unknown = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
};

/**
 * The refusal of a route: `{error: "text"}` (most routes) or `{error: {message, code}}` (session
 * notes), with the code of either shape. A body with neither says nothing.
 */
export function refusalOf(body: unknown): { message?: string; code?: string } {
  if (!body || typeof body !== 'object') return {};
  const error: unknown = (body as Record<string, unknown>)['error'];
  if (typeof error === 'string') {
    const code = field(body, 'code');
    return code === undefined ? { message: error } : { message: error, code };
  }
  if (error && typeof error === 'object') {
    const message = field(error, 'message');
    const code = field(error, 'code');
    return {
      ...(message === undefined ? {} : { message }),
      ...(code === undefined ? {} : { code }),
    };
  }
  return {};
}

/** A sentence for a failed route that sent no message of its own; never a code or a status. */
export function plainError(status: number): string {
  if (status === 401 || status === 403) {
    return 'The dashboard did not accept this login. Open your GM link again.';
  }
  if (status === 404) return 'That is not there any more. Reload the page.';
  if (status === 409) return 'It was changed in the meantime. Reload the page and try again.';
  if (status === 408 || status === 504) {
    return 'Foundry took too long to answer. Try again in a moment.';
  }
  if (status >= 500) return 'The dashboard could not finish that. Try again in a moment.';
  return 'That did not work. Try again.';
}

/**
 * Calls a dashboard route with the GM token and returns its JSON body. Errors carry the server's
 * `error` text, as the old page shows them.
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...authHeaders() };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { ...init, headers: { ...headers, ...init.headers } });
  const body: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const refusal = refusalOf(body);
    const kind = field(body, 'kind');
    // The dashboard's own last-resort 500 (kind internal) says nothing a GM can use.
    const message = kind === 'internal' ? undefined : refusal.message;
    throw new ApiError(message ?? plainError(res.status), res.status, kind, refusal.code);
  }
  if (body === undefined) {
    // A 200 whose type is not JSON (HTML) is a sign-in page or a proxy's page standing in for the
    // dashboard (a lost login), not an answer. An empty body is just an empty answer.
    const type = res.headers?.get('content-type') ?? '';
    if (type !== '' && !/json/i.test(type)) {
      throw new ApiError(plainError(401), 401, undefined, 'login-needed');
    }
    return {} as T;
  }
  return body as T;
}

/** The confirm flags POST /api/tool wants for a write (confirm) or a delete (both). */
export interface ToolConfirm {
  confirm?: boolean;
  confirmDestructive?: boolean;
}

/**
 * A dashboard route that runs a bridge tool (POST /api/tool); the result, or the error thrown
 * (an ApiError with the status and kind when the route refused it).
 */
export async function callTool<T>(
  name: string,
  args: Record<string, unknown>,
  confirm: ToolConfirm = {}
): Promise<T> {
  const data = await api<{ ok?: boolean; result?: T; error?: string; kind?: string }>('/api/tool', {
    method: 'POST',
    body: JSON.stringify({ name, args, ...confirm }),
  });
  // The server sends failures with a 4xx or 5xx today; a 200 that still says ok: false keeps its
  // kind, so it is not logged or worded as a network error.
  if (!data.ok) {
    throw new ApiError(data.error ?? 'The tool did not answer.', 200, field(data, 'kind'));
  }
  return data.result as T;
}

/** Sentences the tools write for Claude, not for the GM. */
const CLAUDE_TAILS: [RegExp, string][] = [
  [/\s*Tell the GM and stop here; do not work around it with other tools\.?/g, ''],
  // The plan is gone but the change may have gone in: say that, and where to look.
  [
    /\s*It may have been applied already: check list-recent-changes first\.[^]*?make a new plan\.?/g,
    ' It may have applied; check Recent Changes.',
  ],
  [/\s*Use [a-z][a-z0-9-]* to find the right one, then try again\.?/g, ''],
  // The bridge's own prefix on a failed query (a method name, not a sentence for the GM).
  [/Query foundry-mcp-bridge\.[\w.]+ failed:\s*/g, ''],
];

// A tool name is a verb and lower-case words. A tail with a digit (a plan or change id such as
// plan-m3x9k-1a2b3c4d) is not one, so it stays as it is.
const TOOL_ID =
  /\b(?:apply|undo|plan|get|list|create|update|suggest|request|roll|manage|measure|search|advance|send|dnd5e)(?:-[a-z]+)+(?![\w-])/g;

/**
 * A message for the GM: the tails written for Claude are dropped and a tool id reads as words
 * ("plan-combat-change" as "combat change"), so no id reaches a toast, empty state or tooltip.
 */
export function plainText(message: string): string {
  // The not-connected tail is the one note worth keeping, said to the GM.
  let text = message.replace(
    /Tell the GM that Foundry is not connected \([^)]*\); do not retry\.?/,
    'Foundry is not connected: open the world in a browser with a GM joined.'
  );
  for (const [tail, instead] of CLAUDE_TAILS) text = text.replace(tail, instead);
  text = text.replace(TOOL_ID, id => toolWords(id).toLowerCase());
  return text.trim() || plainError(500);
}

/** The message of anything thrown, in words, for a toast or an inline error. */
export function errorText(err: unknown): string {
  return plainText(err instanceof Error ? err.message : String(err));
}
