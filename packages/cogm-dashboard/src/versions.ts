/**
 * Version tracker (I-127): installed against newest for Foundry, dnd5e and each module, plus the
 * last test-kit result. GM only, behind the `versionTracker` pref (off by default, D-098).
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
      /** Lookups that failed in the last online check (the rows show "unknown" for those). */
      lookupErrors: number;
      kit: KitResult | null;
    };

/** Numeric per dot segment; anything from the first - or + is ignored. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string): number[] =>
    v
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
      manifest: isHttpUrl(o.manifest) ? o.manifest : null,
    });
  }
  return out;
}

export interface NewestVersions {
  foundry: string | null;
  byId: Record<string, string>;
  errors: number;
}

export function buildRows(
  installed: InstalledPackage[],
  newest: NewestVersions | null
): VersionRow[] {
  const rank: Record<VersionKind, number> = { core: 0, system: 1, module: 2 };
  const rows = installed.map((p): VersionRow => {
    const latest = newest
      ? p.kind === 'core'
        ? newest.foundry
        : (newest.byId[p.id] ?? null)
      : null;
    let status: VersionStatus = 'unknown';
    if (latest) status = compareVersions(p.version, latest) < 0 ? 'behind' : 'ok';
    return {
      id: p.id,
      kind: p.kind,
      title: p.title,
      installed: p.version,
      newest: latest,
      status,
      active: p.active,
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
  init: { headers?: Record<string, string>; redirect: 'follow'; signal: AbortSignal }
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

async function fetchText(
  fetchImpl: FetchLike,
  url: string,
  headers?: Record<string, string>
): Promise<string> {
  const res = await fetchImpl(url, {
    ...(headers ? { headers } : {}),
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const length = Number(res.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_BODY) throw new Error('response too large');
  const body = await res.text();
  if (body.length > MAX_BODY) throw new Error('response too large');
  return body;
}

function versionOf(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const v = (json as Record<string, unknown>).version;
  return typeof v === 'string' && /^[0-9A-Za-z.+_-]{1,40}$/.test(v) ? v : null;
}

/** The online check. Every lookup that fails counts in `errors`; the others still fill in. */
export async function fetchNewest(
  installed: InstalledPackage[],
  fetchImpl: FetchLike
): Promise<NewestVersions> {
  const result: NewestVersions = { foundry: null, byId: {}, errors: 0 };
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
        result.byId[p.id] = v;
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
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  constructor(private readonly options: VersionTrackerOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
  }

  async view(force = false): Promise<VersionsView> {
    if (!this.options.enabled()) return { enabled: false };
    let installed: InstalledPackage[] | null;
    try {
      installed = parseInstalled(await this.options.getModules());
    } catch {
      installed = null;
    }
    if (installed) {
      const due =
        this.checkedAt === null || force || this.now() - this.checkedAt >= VERSIONS_REFRESH_MS;
      if (due) await this.refresh(installed);
    }
    return {
      enabled: true,
      rows: installed ? buildRows(installed, this.newest) : null,
      checkedAt: this.checkedAt === null ? null : new Date(this.checkedAt).toISOString(),
      lookupErrors: this.newest?.errors ?? 0,
      kit: readKitResult(this.options.kitFile ?? null),
    };
  }

  private refresh(installed: InstalledPackage[]): Promise<void> {
    this.inFlight ??= fetchNewest(installed, this.fetchImpl)
      .then(found => {
        this.newest = found;
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
