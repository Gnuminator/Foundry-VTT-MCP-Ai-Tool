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

/** The message of anything thrown, for a toast or an inline error. */
export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
