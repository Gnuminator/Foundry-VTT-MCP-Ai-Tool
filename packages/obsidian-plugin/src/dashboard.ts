/**
 * The plugin's only connection: the co-GM dashboard (never Foundry or the bridge directly,
 * OBSIDIAN-PLAN section 10, P1). Its routes:
 *
 * - `POST /api/open` (O4 design 6.3): opens a document on the GM's Foundry screen. Needs the
 *   `X-CoGM-Request: open` header; a 409 `choose-gm` lists the GMs when several are logged in.
 * - `POST /api/tool`: read tools (`list-revealed-pages`, `plan-page-reveal`). The plugin never
 *   calls `apply-planned-change`: a reveal plan is confirmed in the dashboard (D-067), which the
 *   plugin opens at `/?plan=<planId>`.
 * - `GET /api/theme` and `POST /api/control` `set-theme` (I-099): the world's theme, shared by the
 *   dashboard and the plugin's Obsidian theme.
 *
 * The HTTP call is injected (Obsidian's `requestUrl` in the plugin, a stub in tests), so this file
 * does not import `obsidian`. `requestUrl` runs outside the browser: it sends no Origin and needs
 * no CORS allowance from the dashboard.
 */

import { themeFromPayload, type ThemeId } from './theme.js';

/** GM token header (the dashboard also accepts it on every GM route). */
export const TOKEN_HEADER = 'X-CoGM-Token';
/** Required on `POST /api/open` (mirror of the shared `OPEN_REQUEST_HEADER` / `_VALUE`). */
export const OPEN_REQUEST_HEADER = 'X-CoGM-Request';
export const OPEN_REQUEST_VALUE = 'open';

export interface HttpRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  /** The parsed JSON body, or null when the body is not JSON. */
  json: unknown;
}

export type HttpClient = (request: HttpRequest) => Promise<HttpResponse>;

export interface GmChoice {
  id: string;
  name: string;
}

export type OpenOutcome =
  | { kind: 'opened'; documentName: string; name: string | null }
  | { kind: 'choose-gm'; gms: GmChoice[] }
  | { kind: 'error'; message: string };

/** One revealed page (`list-revealed-pages` `pages`). */
export interface RevealedPage {
  uuid: string;
  title: string | null;
  observable: boolean;
  copiedFrom?: string;
  players?: string[];
  seenBy?: Array<{ name?: string }>;
}

/** One staged page (`list-revealed-pages` `queue`). */
export interface QueuedPage {
  uuid: string;
  title: string | null;
  sceneId: string | null;
}

export interface RevealState {
  pages: RevealedPage[];
  queue: QueuedPage[];
}

export type RevealAction = 'reveal' | 'hide' | 'queue' | 'unqueue';

/** A dashboard error with the HTTP status (0 when the dashboard could not be reached). */
export class DashboardError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'DashboardError';
  }
}

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec | null {
  return value !== null && typeof value === 'object' ? (value as Rec) : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** `http://localhost:3000/` and ` http://x ` become `http://localhost:3000` and `http://x`. */
export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

const PLAN_ID = /^plan-[a-z0-9-]{1,80}$/;

/** The dashboard address that shows a plan's confirm window, or null for a malformed plan id. */
export function planLink(baseUrl: string, planId: string): string | null {
  if (!PLAN_ID.test(planId)) return null;
  return `${normalizeBaseUrl(baseUrl)}/?plan=${encodeURIComponent(planId)}`;
}

export class DashboardClient {
  constructor(
    private readonly http: HttpClient,
    private readonly baseUrl: () => string,
    private readonly token: () => string | null
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extra };
    const token = this.token();
    if (token) headers[TOKEN_HEADER] = token;
    return headers;
  }

  private post(path: string, body: unknown, extra?: Record<string, string>): Promise<HttpResponse> {
    return this.send('POST', path, body, extra);
  }

  private async send(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    extra?: Record<string, string>
  ): Promise<HttpResponse> {
    const base = normalizeBaseUrl(this.baseUrl());
    if (!/^https?:\/\//i.test(base)) {
      throw new DashboardError(
        'Set the dashboard address in the plugin settings (for example http://localhost:3000).',
        0
      );
    }
    try {
      return await this.http({
        url: `${base}${path}`,
        method,
        headers: this.headers(extra),
        ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new DashboardError(
        `The dashboard at ${base} did not answer (${reason}). Is the bridge running?`,
        0
      );
    }
  }

  /** Opens a document on the GM's Foundry screen (`userId` picks the GM when several are on). */
  async openInFoundry(uuid: string, userId?: string): Promise<OpenOutcome> {
    const response = await this.post('/api/open', userId ? { uuid, userId } : { uuid }, {
      [OPEN_REQUEST_HEADER]: OPEN_REQUEST_VALUE,
    });
    const body = rec(response.json);
    if (response.status === 200 && body) {
      return {
        kind: 'opened',
        documentName: str(body.documentName) ?? '',
        name: str(body.name),
      };
    }
    if (response.status === 409 && body?.code === 'choose-gm' && Array.isArray(body.gms)) {
      const gms = body.gms
        .map(rec)
        .filter((g): g is Rec => g !== null && typeof g.id === 'string')
        .map(g => ({ id: String(g.id), name: str(g.name) ?? String(g.id) }));
      return { kind: 'choose-gm', gms };
    }
    return { kind: 'error', message: errorText(response) };
  }

  /** The world's theme as the dashboard has it (any logged-in role may read it). */
  async theme(): Promise<ThemeId> {
    const response = await this.send('GET', '/api/theme');
    const theme = response.status === 200 ? themeFromPayload(response.json) : null;
    if (theme) return theme;
    throw new DashboardError(errorText(response), response.status);
  }

  /** Sets the world's theme in the dashboard (GM only); resolves to the theme it now has. */
  async setTheme(theme: ThemeId): Promise<ThemeId> {
    const response = await this.post('/api/control', { action: 'set-theme', value: theme });
    const now = response.status === 200 ? themeFromPayload(response.json) : null;
    if (now) return now;
    throw new DashboardError(errorText(response), response.status);
  }

  /** Runs a read tool through the dashboard's GM proxy. */
  async readTool(name: string, args: Rec): Promise<unknown> {
    const response = await this.post('/api/tool', { name, args });
    const body = rec(response.json);
    if (response.status === 200 && body?.ok === true) return body.result;
    throw new DashboardError(errorText(response), response.status);
  }

  async revealState(): Promise<RevealState> {
    const result = rec(await this.readTool('list-revealed-pages', {}));
    const pages = (Array.isArray(result?.pages) ? result.pages : [])
      .map(rec)
      .filter((p): p is Rec => p !== null && typeof p.uuid === 'string')
      .map(p => {
        const page: RevealedPage = {
          uuid: String(p.uuid),
          title: str(p.title),
          observable: p.observable === true,
        };
        const copiedFrom = str(p.copiedFrom);
        if (copiedFrom) page.copiedFrom = copiedFrom;
        if (Array.isArray(p.players))
          page.players = p.players.filter((x): x is string => typeof x === 'string');
        if (Array.isArray(p.seenBy))
          page.seenBy = p.seenBy.map(s => ({ name: str(rec(s)?.name) ?? '' }));
        return page;
      });
    const queue = (Array.isArray(result?.queue) ? result.queue : [])
      .map(rec)
      .filter((q): q is Rec => q !== null && typeof q.uuid === 'string')
      .map(q => ({ uuid: String(q.uuid), title: str(q.title), sceneId: str(q.sceneId) }));
    return { pages, queue };
  }

  /**
   * `plan-page-reveal` for one page. `reveal` and `hide` return a planId to confirm in the
   * dashboard; `queue` and `unqueue` change only the GM's reveal queue (no plan) and return a note.
   */
  async planReveal(
    uuid: string,
    action: RevealAction
  ): Promise<{ planId: string | null; note: string }> {
    const result = rec(await this.readTool('plan-page-reveal', { pageUuid: uuid, action }));
    const planId = str(result?.planId);
    const note = str(result?.note) ?? str(result?.summary) ?? '';
    return { planId, note };
  }
}

function errorText(response: HttpResponse): string {
  const body = rec(response.json);
  const message = str(body?.error) ?? str(body?.message);
  if (response.status === 401 || response.status === 403) {
    if (body?.code === 'cross-site') return message ?? 'The dashboard refused the request.';
    return `${message ?? 'Not allowed.'} Check the GM token in the plugin settings.`;
  }
  if (message) return message.replace(/^Error: /, '');
  return `The dashboard answered HTTP ${response.status}.`;
}
