import { authHeaders } from './auth';

/** A failed dashboard route: the server's own message when it sent one, else `HTTP <status>`. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Calls a dashboard route with the GM token and returns its JSON body. Errors carry the server's
 * `error` text, as the old page shows them.
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...authHeaders() };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { ...init, headers: { ...headers, ...init.headers } });
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `HTTP ${res.status}`;
    throw new ApiError(message, res.status);
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
 * (an ApiError with the HTTP status when the route refused it).
 */
export async function callTool<T>(
  name: string,
  args: Record<string, unknown>,
  confirm: ToolConfirm = {}
): Promise<T> {
  const data = await api<{ ok?: boolean; result?: T; error?: string }>('/api/tool', {
    method: 'POST',
    body: JSON.stringify({ name, args, ...confirm }),
  });
  if (!data.ok) throw new Error(data.error ?? 'The tool did not answer.');
  return data.result as T;
}

/** The message of anything thrown, for a toast or an inline error. */
export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
