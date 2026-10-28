/**
 * Version tracker (I-127): installed against newest for Foundry, dnd5e and each module, plus the
 * last test-kit result. GM only, behind the `versionTracker` pref (on by default, I-127).
 *
 * Installed versions come from the bridge (`get-modules`: Foundry, the system and every module
 * with its manifest url). The newest ones are looked up online at most every six hours and kept in
 * memory: Foundry's release page, the dnd5e GitHub release, and each module's own manifest url
 * (the same sources as the Control Center's versions table, which lives outside this repo and
 * only runs on the PC). The kit result is the kit's `last-run.json`, when this host has one.
 * Nothing here reads campaign content; names and version numbers only.
 */
import { readFileSync } from 'fs';
import * as path from 'path';

import type { Express, Request, Response } from 'express';

export const VERSIONS_REFRESH_MS = 6 * 3600 * 1000;
export const VERSIONS_RETRY_MS = 10 * 60 * 1000;
const VERSIONS_FORCE_MIN_MS = 60 * 1000;
const FIRST_WAIT_MS = 12_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY = 1024 * 1024;
const MAX_IN_FLIGHT = 6;
const MAX_MODULES = 300;
const RELEASES_URL = 'https://foundryvtt.com/releases/';
const DND5E_LATEST_URL = 'https://api.github.com/repos/foundryvtt/dnd5e/releases/latest';

export type VersionStatus = 'ok' | 'behind' | 'unknown';
export type VersionKind = 'core' | 'system' | 'module';

export interface VersionRow {
  id: string;
  kind: VersionKind;
  title: string;
  installed: string;
  newest: string | null;
  status: VersionStatus;
  active: boolean;
  /** Set on a behind module whose newest release needs a newer Foundry than the installed one. */
  needsCore: string | null;
}

export interface KitResult {
  /** passed, failed or whatever state the kit last reported */
  state: string;
  at: string | null;
  text: string;
}

export type VersionsView =
  | { enabled: false }
  | {
      enabled: true;
      /** null until the bridge has answered once */
      rows: VersionRow[] | null;
      checkedAt: string | null;
      /** The online check is still running; the page asks again shortly. */
      checking: boolean;
      /** Lookups that failed in the last online check (the rows show "unknown" for those). */
      lookupErrors: number;
      kit: KitResult | null;
    };

/** Numeric per dot segment; anything from the first - or + is ignored. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string): number[] =>
    v
      .replace(/^v/i, '')
      .split(/[-+]/)[0]
      .split('.')
      .map(p => {
        const n = parseInt(p, 10);
        return Number.isNaN(n) ? 0 : n;
      });
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Foundry's release list: the newest version tagged stable. */
export function parseFoundryReleases(html: string): string | null {
  let best: string | null = null;
  for (const chunk of html.split('<li class="article release').slice(1)) {
    const v = /href="\/releases\/(\d+\.\d+)"/.exec(chunk);
    if (!v) continue;
    const tag = /release-tag\s+(stable|testing|development|prototype)\b/i.exec(chunk);
    if (tag?.[1]?.toLowerCase() !== 'stable') continue;
    if (best === null || compareVersions(v[1], best) > 0) best = v[1]!;
  }
  return best;
}

export interface InstalledPackage {
  id: string;
  kind: VersionKind;
  title: string;
  version: string;
  active: boolean;
  manifest: string | null;
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//.test(value);
}

/** The bridge's `get-modules` answer as installed packages; null when it is not one. */
export function parseInstalled(raw: unknown): InstalledPackage[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const out: InstalledPackage[] = [];
  const core = text(r.foundryVersion, 40);
  if (core) {
    out.push({
      id: 'foundry',
      kind: 'core',
      title: 'Foundry VTT',
      version: core,
      active: true,
      manifest: null,
    });
  }
  const sys = r.system;
  if (sys && typeof sys === 'object') {
    const s = sys as Record<string, unknown>;
    const id = text(s.id, 80);
    const version = text(s.version, 40);
    if (id && version) {
      out.push({ id, kind: 'system', title: id, version, active: true, manifest: null });
    }
  }
  if (!Array.isArray(r.modules)) return core || out.length > 0 ? out : null;
  for (const m of r.modules.slice(0, MAX_MODULES) as unknown[]) {
    if (!m || typeof m !== 'object') continue;
    const o = m as Record<string, unknown>;
    const id = text(o.id, 80);
    const version = text(o.version, 40);
    if (!id || !version) continue;
    out.push({
      id,
      kind: 'module',
      title: text(o.title, 120) || id,
      version,
      active: o.active === true,
      manifest: isHttpUrl(o.manifest) ? o.manifest.split('#')[0] : null,
    });
  }
  return out;
}

export interface NewestVersions {
  foundry: string | null;
  byId: Record<string, string>;
  /** The Foundry version a module's newest release declares as its minimum core. */
  minCoreById: Record<string, string>;
  errors: number;
}

export function buildRows(
  installed: InstalledPackage[],
  newest: NewestVersions | null
): VersionRow[] {
  const rank: Record<VersionKind, number> = { core: 0, system: 1, module: 2 };
  const core = installed.find(p => p.kind === 'core')?.version ?? null;
  const rows = installed.map((p): VersionRow => {
    const latest = newest
      ? p.kind === 'core'
        ? newest.foundry
        : (newest.byId[p.id] ?? null)
      : null;
    let status: VersionStatus = 'unknown';
    if (latest) status = compareVersions(p.version, latest) < 0 ? 'behind' : 'ok';
    const minCore = newest?.minCoreById[p.id] ?? null;
    const needsCore =
      status === 'behind' && minCore && core && compareVersions(core, minCore) < 0 ? minCore : null;
    return {
      id: p.id,
      kind: p.kind,
      title: p.title,
      installed: p.version,
      newest: latest,
      status,
      active: p.active,
      needsCore,
    };
  });
  return rows.sort(
    (a, b) =>
      rank[a.kind] - rank[b.kind] ||
      Number(b.active) - Number(a.active) ||
      a.title.localeCompare(b.title)
  );
}

type FetchLike = (
  url: string,
  init: { headers?: Record<string, string>; redirect: 'manual'; signal: AbortSignal }
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body?: {
    getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): unknown };
    cancel?(): unknown;
  } | null;
  text(): Promise<string>;
}>;

const MAX_REDIRECTS = 3;

/**
 * Hosts a module manifest may not point at: this machine and private or link-local networks
 * (the manifest urls come from the Foundry host, and this server may sit next to the live
 * ports). Checked on the name or address literal in the url, and again on every redirect;
 * a name that resolves to a private address is not caught.
 */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '');
  // A name without a dot (and not an address) is a machine on the local network.
  if (!h.includes('.') && !h.includes(':')) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (h === '::1' || h === '::' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) {
    return true;
  }
  if (h.startsWith('::ffff:') || h.startsWith('64:ff9b:')) return true;
  // IPv4 loopback written as ::7f00:1 (the url parser already folds 0:0:0:0:0:0:0:1 into ::1); multicast ff00::/8
  if (/^::7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(h)) return true;
  if (/^ff[0-9a-f]{2}:/.test(h)) return true;
  // Home-network names that do contain a dot.
  if (
    h.endsWith('.lan') ||
    h.endsWith('.home.arpa') ||
    h === 'fritz.box' ||
    h.endsWith('.internal')
  ) {
    return true;
  }
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** Only https, no user or password, no private host. Throws otherwise. */
function checkUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('only https urls are fetched');
  if (url.username || url.password) throw new Error('urls with a login are not fetched');
  if (isPrivateHost(url.hostname)) throw new Error('private hosts are not fetched');
  return url;
}

async function readCapped(res: Awaited<ReturnType<FetchLike>>): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) {
    const whole = await res.text();
    if (whole.length > MAX_BODY) throw new Error('response too large');
    return whole;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    if (size > MAX_BODY) {
      void reader.cancel();
      throw new Error('response too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchText(
  fetchImpl: FetchLike,
  start: string,
  headers?: Record<string, string>
): Promise<string> {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let url = checkUrl(start);
  for (let hop = 0; ; hop += 1) {
    const res = await fetchImpl(url.href, {
      ...(headers ? { headers } : {}),
      redirect: 'manual',
      signal,
    });
    if (res.status >= 300 && res.status < 400) {
      void res.body?.cancel?.();
      const location = res.headers.get('location');
      if (!location || hop >= MAX_REDIRECTS) throw new Error('too many redirects');
      url = checkUrl(new URL(location, url).href);
      continue;
    }
    if (!res.ok) {
      void res.body?.cancel?.();
      throw new Error(`HTTP ${res.status}`);
    }
    const length = Number(res.headers.get('content-length'));
    if (Number.isFinite(length) && length > MAX_BODY) {
      void res.body?.cancel?.();
      throw new Error('response too large');
    }
    return readCapped(res);
  }
}

const VERSION_RE = /^[0-9A-Za-z.+_-]{1,40}$/;

function versionOf(json: unknown): { version: string; minCore: string | null } | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  const v = o.version;
  if (typeof v !== 'string' || !VERSION_RE.test(v)) return null;
  // v11 and later: compatibility.minimum; older manifests: minimumCoreVersion
  const comp = o.compatibility as Record<string, unknown> | undefined;
  const raw = comp?.minimum ?? o.minimumCoreVersion;
  const min = typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '';
  return { version: v, minCore: VERSION_RE.test(min) ? min : null };
}

/** The online check. Every lookup that fails counts in `errors`; the others still fill in. */
export async function fetchNewest(
  installed: InstalledPackage[],
  fetchImpl: FetchLike
): Promise<NewestVersions> {
  const result: NewestVersions = { foundry: null, byId: {}, minCoreById: {}, errors: 0 };
  const tasks: Array<() => Promise<void>> = [];
  tasks.push(async () => {
    try {
      result.foundry = parseFoundryReleases(await fetchText(fetchImpl, RELEASES_URL));
      if (!result.foundry) throw new Error('no stable release found');
    } catch {
      result.errors += 1;
    }
  });
  const system = installed.find(p => p.kind === 'system');
  if (system?.id === 'dnd5e') {
    tasks.push(async () => {
      try {
        const body = JSON.parse(
          await fetchText(fetchImpl, DND5E_LATEST_URL, {
            accept: 'application/vnd.github+json',
            'user-agent': 'foundry-ai-tool-dashboard',
          })
        ) as { tag_name?: unknown };
        const v = text(body.tag_name, 80).replace(/^\D*/, '');
        if (!/^[0-9A-Za-z.+_-]{1,40}$/.test(v)) throw new Error('no version in tag');
        result.byId.dnd5e = v;
      } catch {
        result.errors += 1;
      }
    });
  }
  const seen = new Set<string>();
  for (const p of installed) {
    if (p.kind !== 'module' || !p.manifest || seen.has(p.id)) continue;
    seen.add(p.id);
    const url = p.manifest;
    tasks.push(async () => {
      try {
        const v = versionOf(JSON.parse(await fetchText(fetchImpl, url)));
        if (!v) throw new Error('not a manifest');
        result.byId[p.id] = v.version;
        if (v.minCore) result.minCoreById[p.id] = v.minCore;
      } catch {
        result.errors += 1;
      }
    });
  }
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const task = tasks[next++];
      await task();
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_IN_FLIGHT, tasks.length) }, worker));
  return result;
}

/** The kit's `last-run.json` (scripts/test-kit/kit-run.mjs), reduced; null when absent or odd. */
export function readKitResult(file: string | null): KitResult | null {
  if (!file) return null;
  try {
    const doc = JSON.parse(readFileSync(file, 'utf8')) as {
      lastRun?: Record<string, unknown> | null;
    };
    const run = doc.lastRun;
    if (!run || typeof run !== 'object') return null;
    const at = text(run.finishedAt ?? run.endedAt ?? run.startedAt ?? run.at, 40);
    return {
      state: text(run.state, 20) || 'unknown',
      at: at || null,
      text: text(run.text, 300),
    };
  } catch {
    return null;
  }
}

/** env FOUNDRY_AI_KIT_LAST_RUN, else the PC's kit home (TEST_KIT_HOME); null on other hosts. */
export function defaultKitLastRunFile(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.FOUNDRY_AI_KIT_LAST_RUN) return env.FOUNDRY_AI_KIT_LAST_RUN;
  if (env.TEST_KIT_HOME) return path.join(env.TEST_KIT_HOME, 'last-run.json');
  return process.platform === 'win32' ? 'C:\\FoundryTest\\test-kit\\last-run.json' : null;
}

export interface VersionTrackerOptions {
  /** Whether the GM switched the tracker on for the current world. */
  enabled: () => boolean;
  /** The bridge's `get-modules` answer. */
  getModules: () => Promise<unknown>;
  /** Defaults to the global fetch. */
  fetchImpl?: FetchLike;
  kitFile?: string | null;
  now?: () => number;
}

/** Holds the six-hour cache; `view()` is what the route answers. */
export class VersionTracker {
  private newest: NewestVersions | null = null;
  private checkedAt: number | null = null;
  private inFlight: Promise<void> | null = null;
  /** Checks in a row that had a failed lookup; a manifest that never answers backs the retry off. */
  private failedChecks = 0;

  /** Ten minutes after the first failed check, doubling each time, never past the six hours. */
  private retryAfter(): number {
    return Math.min(
      VERSIONS_RETRY_MS * 2 ** Math.max(0, this.failedChecks - 1),
      VERSIONS_REFRESH_MS
    );
  }
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  constructor(private readonly options: VersionTrackerOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
  }

  /**
   * What the route answers. The online check runs in the background: the first answer waits for
   * it at most FIRST_WAIT_MS (rows then show what is known, `checking` stays true and the page
   * asks again), later answers come straight from the cache. A check is due after six hours, or
   * after ten minutes when a lookup failed or a package has no entry (Pi offline at boot, a module
   * installed since). `force` (the "Check again" button) is ignored within a minute of the last
   * check, so GitHub's anonymous limit is not burnt.
   */
  async view(force = false): Promise<VersionsView> {
    if (!this.options.enabled()) return { enabled: false };
    let installed: InstalledPackage[] | null;
    try {
      installed = parseInstalled(await this.options.getModules());
    } catch {
      installed = null;
    }
    if (installed) {
      const age = this.checkedAt === null ? Infinity : this.now() - this.checkedAt;
      const retry = this.newest !== null && (this.newest.errors > 0 || this.missing(installed));
      const due =
        this.checkedAt === null ||
        age >= (retry ? this.retryAfter() : VERSIONS_REFRESH_MS) ||
        (force && age >= VERSIONS_FORCE_MIN_MS);
      if (due) {
        const started = this.refresh(installed);
        if (this.checkedAt === null) {
          let timer: NodeJS.Timeout | undefined;
          const wait = new Promise<void>(r => {
            timer = setTimeout(r, FIRST_WAIT_MS);
          });
          await Promise.race([started, wait]);
          clearTimeout(timer);
        }
      }
    }
    return {
      enabled: true,
      rows: installed ? buildRows(installed, this.newest) : null,
      checkedAt: this.checkedAt === null ? null : new Date(this.checkedAt).toISOString(),
      checking: this.inFlight !== null,
      lookupErrors: this.newest?.errors ?? 0,
      kit: readKitResult(this.options.kitFile ?? null),
    };
  }

  /** A module with a manifest url but no looked-up version (installed after the last check). */
  private missing(installed: InstalledPackage[]): boolean {
    return installed.some(
      p => p.kind === 'module' && p.manifest !== null && this.newest?.byId[p.id] === undefined
    );
  }

  private refresh(installed: InstalledPackage[]): Promise<void> {
    this.inFlight ??= fetchNewest(installed, this.fetchImpl)
      .then(found => {
        this.newest = found;
        this.failedChecks = found.errors > 0 || this.missing(installed) ? this.failedChecks + 1 : 0;
        this.checkedAt = this.now();
      })
      .catch(() => {
        // fetchNewest counts its own failures; this only keeps a surprise from going unhandled
        this.checkedAt = this.now();
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }
}

export function mountVersionsRoute(
  app: Express,
  options: {
    tracker: VersionTracker;
    requireGm: (req: Request, res: Response, next: () => void) => void;
  }
): void {
  app.get('/api/versions', options.requireGm, (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    options.tracker
      .view(req.query.refresh === '1')
      .then(view => res.json(view))
      .catch(() => res.status(500).json({ error: 'The version check failed.' }));
  });
}
