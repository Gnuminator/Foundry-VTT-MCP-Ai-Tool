/**
 * Client versions (item `client-updates`, layer 2): which client pieces connect to this dashboard
 * with which version, and the route the GM page reads. The Pi's own version (TOOL_VERSION) is
 * what every piece is compared with. Names and version numbers only; nothing here carries
 * campaign content or a secret.
 */
import type { NextFunction, Express, Request, Response } from 'express';
import {
  CLIENT_HEADER,
  INSTALL_HEADER,
  CLIENT_NOTICE_INTERVAL_MS,
  TOOL_VERSION,
  clientDownloadUrl,
  cleanClientVersion,
  isClientBehind,
  parseClientHeader,
  type ClientPiece,
  type ClientSeen,
  type ClientVersionsView,
} from '@gnuminator/shared';

/** Most entries kept, so a flood of made-up names cannot grow memory. */
const CLIENT_REGISTRY_MAX = 200;

interface Entry {
  piece: ClientPiece;
  who: string;
  version: string | null;
  lastSeen: number;
}

export class ClientRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly notified = new Map<string, number>();

  constructor(
    private readonly current: string = TOOL_VERSION,
    private readonly max: number = CLIENT_REGISTRY_MAX
  ) {}

  private static key(piece: ClientPiece, who: string): string {
    return `${piece}\u0000${who}`;
  }

  /**
   * Remember the last version seen for this piece and person. `who` is the stable key (a Foundry
   * user id for a player, "GM" for the GM's pieces); `label` is what the GM list shows (the
   * player's name), defaulting to `who`.
   */
  record(
    piece: ClientPiece,
    who: string,
    version: string | null,
    now: number,
    label: string = who
  ): void {
    const key = ClientRegistry.key(piece, who.slice(0, 80));
    // Re-insert so the Map order is oldest-seen first.
    this.entries.delete(key);
    this.entries.set(key, { piece, who: label.slice(0, 80), version, lastSeen: now });
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /** The last seen entry for this piece and person, with its behind flag, or null. */
  get(piece: ClientPiece, who: string): ClientSeen | null {
    const e = this.entries.get(ClientRegistry.key(piece, who.slice(0, 80)));
    return e ? this.toSeen(e) : null;
  }

  list(): ClientSeen[] {
    return [...this.entries.values()].map(e => this.toSeen(e));
  }

  /** True at most once per key per {@link CLIENT_NOTICE_INTERVAL_MS}. */
  shouldNotify(key: string, now: number): boolean {
    const last = this.notified.get(key);
    if (last !== undefined && now - last < CLIENT_NOTICE_INTERVAL_MS) return false;
    this.notified.delete(key);
    this.notified.set(key, now);
    while (this.notified.size > this.max) {
      const oldest = this.notified.keys().next().value;
      if (oldest === undefined) break;
      this.notified.delete(oldest);
    }
    return true;
  }

  private toSeen(e: Entry): ClientSeen {
    return {
      piece: e.piece,
      who: e.who,
      version: e.version,
      behind: isClientBehind(e.version, this.current),
      lastSeen: new Date(e.lastSeen).toISOString(),
    };
  }
}

/**
 * Middleware for requests that pass the GM check: the Obsidian plugin sends
 * `x-foundry-client: obsidian/<version>`. Records it; never rejects a request.
 */
export function obsidianClientRecorder(
  registry: ClientRegistry,
  isGmRequest: (req: Request) => boolean,
  now: () => number = Date.now,
  /** Hands the sighting to the bridge's client file (D-146); best effort. */
  forward?: (entry: Record<string, unknown>) => void
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, _res, next) => {
    try {
      const raw = req.headers[CLIENT_HEADER];
      const parsed = parseClientHeader(Array.isArray(raw) ? raw[0] : raw);
      if (parsed && isGmRequest(req)) {
        registry.record('obsidian', 'GM', parsed.version, now());
        const rawInstall = req.headers[INSTALL_HEADER];
        const install = Array.isArray(rawInstall) ? rawInstall[0] : rawInstall;
        forward?.({
          piece: 'obsidian',
          who: 'gm',
          install: typeof install === 'string' && /^[0-9a-f]{12}$/.test(install) ? install : '',
          version: parsed.version,
        });
      }
    } catch {
      // Recording is best effort.
    }
    next();
  };
}

interface WrapperRow {
  version: string | null;
  build: string | null;
  sets: string;
}

/** The backend's `wrapper_status` answer, parsed defensively; null when it is not usable. */
export function parseWrapperStatus(raw: unknown): { wrappers: WrapperRow[] } | null {
  if (raw === null || typeof raw !== 'object') return null;
  const list = (raw as { wrappers?: unknown }).wrappers;
  if (!Array.isArray(list)) return null;
  const wrappers: WrapperRow[] = [];
  for (const w of list.slice(0, 50) as unknown[]) {
    if (w === null || typeof w !== 'object') continue;
    const r = w as { version?: unknown; build?: unknown; sets?: unknown };
    wrappers.push({
      version: cleanClientVersion(r.version),
      build: typeof r.build === 'string' ? r.build.slice(0, 40) : null,
      sets: typeof r.sets === 'string' ? r.sets.slice(0, 40) : '',
    });
  }
  return { wrappers };
}

interface ClientVersionsRouteOptions {
  requireGm: (req: Request, res: Response, next: () => void) => void;
  registry: ClientRegistry;
  /** The control client's `wrapperStatus`; absent on fakes. An old backend rejects. */
  wrapperStatus?: (() => Promise<unknown>) | undefined;
  current?: string;
  now?: () => number;
}

/** `GET /api/client-versions` (GM only): every piece seen, plus the connected connector wrappers. */
export function mountClientVersionsRoute(app: Express, options: ClientVersionsRouteOptions): void {
  const current = options.current ?? TOOL_VERSION;
  const now = options.now ?? Date.now;
  app.get('/api/client-versions', options.requireGm, (_req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    const respond = (wrappers: WrapperRow[]): void => {
      const at = new Date(now()).toISOString();
      const connectors: ClientSeen[] = wrappers.map(w => ({
        piece: 'connectors',
        who: 'GM',
        version: w.version,
        behind: w.version === null || isClientBehind(w.version, current),
        lastSeen: at,
      }));
      const view: ClientVersionsView = {
        current,
        downloads: {
          connectors: clientDownloadUrl('connectors', current),
          obsidian: clientDownloadUrl('obsidian', current),
        },
        seen: [...options.registry.list(), ...connectors],
      };
      res.json(view);
    };
    if (typeof options.wrapperStatus !== 'function') {
      respond([]);
      return;
    }
    options
      .wrapperStatus()
      .then(raw => respond(parseWrapperStatus(raw)?.wrappers ?? []))
      .catch(() => respond([]));
  });
}
