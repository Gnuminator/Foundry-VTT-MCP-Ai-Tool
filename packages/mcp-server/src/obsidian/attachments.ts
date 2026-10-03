/**
 * Images for the mirror and Library (docs/design/OBSIDIAN-O4-DESIGN.md section 13.5): book
 * images in journal pages, image pages, NPC portraits and scene maps are copied into
 * `Campaigns/<world>/AI Tool/Attachments/` and embedded with `![[...]]`.
 *
 * Foundry serves its data files over HTTP at its own base URL (`<base>/<path>` for
 * `ddb-images/...`, `worlds/...`, `modules/...`), with no login, so the bridge fetches them
 * there instead of reading Foundry's data folder: that keeps working when the bridge runs on
 * another machine. The base URL (origin plus any route prefix, no trailing slash) comes from the
 * GM client, sent with the export and Library index, unless `FOUNDRY_AI_FOUNDRY_URL` sets it.
 *
 * The attachment path mirrors the Foundry path (each segment made safe), so one image used by
 * many notes is one file, fetched once. Paths are compared case-folded (NTFS is not case
 * sensitive): when two different Foundry paths would land on the same file, the later one gets
 * a short hash of its Foundry path in the name. The choice is kept in a manifest, so it stays the
 * same across restarts. A file already in the vault is never fetched again; a failed fetch is
 * retried after a pause. Only image types are copied, never past `MAX_ATTACHMENT_BYTES` (the
 * body is streamed and cut off); anything else, and paths that climb out of the data root, stay a
 * text placeholder. External URLs (http(s) on another host) are embedded as remote images.
 *
 * Owners: every embed is made while a note's owner (the Foundry uuid it renders) is open, so the
 * manifest knows which notes use which image. An image no note uses any more is moved to the
 * vault trash after a complete reconcile (`collectGarbage`), never deleted.
 *
 * Licensed content: the folder is gitignored by `LicensedGuard`, which must pass before
 * `enabled` is set.
 */
import { createHash } from 'crypto';
import { promises as fsp } from 'fs';
import * as path from 'path';

import { writeFileAtomic } from './atomic-write.js';
import { ATTACHMENTS_ROOT } from './licensed-guard.js';
import { collapseWhitespace, safeUrl } from './md-escape.js';
import { parseBaseUrl, pathKey } from './mirror-common.js';
import { errorCode, errorMessage } from './note-writer.js';
import { safeFileName } from './render.js';

const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.avif',
  '.bmp',
  '.svg',
]);
/** The largest image copied (a big battle map is 5 to 20 MB). */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const RETRY_AFTER_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 30_000;
/** A fetch needs at least this much of the cycle left to start. */
const MIN_FETCH_MS = 1_000;
const CONCURRENCY = 4;
/** Embedded paths past this many characters are not copied (Windows path limits). */
const MAX_REL_PATH = 200;
/** Every image notes embed, kept so a restart still fetches what is missing (Obsidian ignores dot files). */
const MANIFEST = `${ATTACHMENTS_ROOT}/.ai-tool-attachments.json`;
const MAX_MANIFEST_ENTRIES = 50_000;

export type Fetcher = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

/** Moves one campaign-relative file to the vault trash (the pump's fenced writer). */
export type TrashFile = (relPath: string) => Promise<'trashed' | 'kept' | 'missing'>;

export interface AttachmentStatus {
  /** Files in the vault that notes embed. */
  copied: number;
  /** Waiting to be fetched. */
  pending: number;
  /** Failed fetches (path and reason), newest first, at most 20. */
  failed: Array<{ path: string; error: string }>;
  /** Why no image is copied at all, or null. */
  blocked: string | null;
}

interface Planned {
  /** The Foundry path, as first written in a document (used for the URL). */
  source: string;
  /** The decoded Foundry path (`maps/a b.png`): one planned image per path. */
  key: string;
  /** Campaign-relative vault path. */
  rel: string;
  /** Owner uuids whose notes embed it; null when unknown (never collected). */
  owners: Set<string> | null;
}

/** The decoded segments of a Foundry image path, or null when it is not one. */
interface FoundryPath {
  key: string;
  segments: string[];
  ext: string;
}

function hash8(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 8);
}

/** The error text for a file past the size cap. */
function tooLargeText(max: number): string {
  return max >= 1024 * 1024
    ? `larger than ${Math.round(max / 1024 / 1024)} MB`
    : `larger than ${max} bytes`;
}

/** Reads a response body, aborting once it passes `max` bytes. */
async function readCapped(response: Response, max: number, abort: () => void): Promise<Uint8Array> {
  const tooLarge = (): Error => new Error(tooLargeText(max));
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > max) throw tooLarge();
    return bytes;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      abort();
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** `Campaigns/<world>/AI Tool/Attachments/...`: copies of Foundry images, fetched over HTTP. */
export class AttachmentStore {
  private origin: string | null = null;
  private allowed = false;
  private blockedReason: string | null = 'not started';
  /** Planned images by Foundry path key. */
  private readonly bySource = new Map<string, Planned>();
  /** Planned images by case-folded vault path. */
  private readonly byRel = new Map<string, Planned>();
  /** Owner uuid to the Foundry path keys its notes embed. */
  private readonly ownerRefs = new Map<string, Set<string>>();
  /** Case-folded vault paths of copies that are in the vault. */
  private readonly present = new Set<string>();
  private readonly failedAt = new Map<string, { at: number; error: string; rel: string }>();
  private scope: { owner: string; seen: Set<string> } | null = null;
  private manifestLoaded = false;
  private manifestDirty = false;

  constructor(
    private readonly campaignRoot: string,
    private readonly worldId: string,
    private readonly fixedOrigin: string | null,
    private readonly fetcher: Fetcher = (url, init): Promise<Response> => fetch(url, init),
    private readonly now: () => number = (): number => Date.now(),
    private readonly maxBytes: number = MAX_ATTACHMENT_BYTES
  ) {
    this.origin = fixedOrigin === null ? null : parseBaseUrl(fixedOrigin);
  }

  /** The base URL the GM client reported (ignored when `FOUNDRY_AI_FOUNDRY_URL` is set). */
  setOrigin(origin: string | null | undefined): void {
    if (this.fixedOrigin) return;
    if (typeof origin !== 'string') return;
    const parsed = parseBaseUrl(origin);
    if (parsed !== null) this.origin = parsed;
  }

  /** Whether copies may be written (the git guard passed); a reason when not. */
  setAllowed(allowed: boolean, reason: string | null): void {
    this.allowed = allowed;
    this.blockedReason = allowed ? null : (reason ?? 'blocked');
  }

  get enabled(): boolean {
    return this.allowed;
  }

  /** The decoded Foundry path of an image source, or null when it is not a copyable image. */
  private foundryPath(src: string): FoundryPath | null {
    let text = src.trim();
    if (/^https?:\/\//i.test(text)) {
      if (!this.origin || !text.toLowerCase().startsWith(`${this.origin.toLowerCase()}/`))
        return null;
      text = text.slice(this.origin.length + 1);
    }
    text = text.replace(/[?#].*$/, '').replace(/^\/+/, '');
    if (!text || /^[a-z][\w+.-]*:/i.test(text)) return null;
    let decoded: string;
    try {
      decoded = decodeURIComponent(text);
    } catch {
      decoded = text;
    }
    const segments = decoded.split(/[\\/]+/);
    if (segments.some(segment => segment === '..' || segment === '.' || segment === ''))
      return null;
    const ext = path.posix.extname(segments[segments.length - 1] ?? '').toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) return null;
    return { key: segments.join('/'), segments, ext };
  }

  /** The vault path for a Foundry path, optionally with the hash that tells it apart. */
  private relFor(found: FoundryPath, hashed: boolean): string | null {
    const last = found.segments.length - 1;
    const safe = found.segments.map((segment, i) => {
      if (i < last) return safeFileName(segment);
      const stem = safeFileName(segment.slice(0, segment.length - found.ext.length));
      return `${stem}${hashed ? `-${hash8(found.key)}` : ''}${found.ext}`;
    });
    const rel = `${ATTACHMENTS_ROOT}/${safe.join('/')}`;
    return rel.length <= MAX_REL_PATH ? rel : null;
  }

  /**
   * The campaign-relative vault path a Foundry image path maps to by default (before any
   * collision hash), or null when it is not an image in Foundry's data root (an external URL, a
   * video, a path that climbs out).
   */
  attachmentPath(src: string): string | null {
    const found = this.foundryPath(src);
    return found ? this.relFor(found, false) : null;
  }

  /** The planned image for a source (planning it when new), or null. */
  private plan(source: string, found: FoundryPath, rel?: string): Planned | null {
    const existing = this.bySource.get(found.key);
    if (existing) return existing;
    if (this.bySource.size >= MAX_MANIFEST_ENTRIES) return null;
    const plain = this.relFor(found, false);
    const hashed = this.relFor(found, true);
    const candidates = rel !== undefined && rel === hashed ? [hashed, plain] : [plain, hashed];
    const chosen = candidates.find(
      (candidate): candidate is string => candidate !== null && !this.byRel.has(pathKey(candidate))
    );
    if (chosen === undefined) return null;
    const planned: Planned = { source, key: found.key, rel: chosen, owners: new Set() };
    this.bySource.set(found.key, planned);
    this.byRel.set(pathKey(chosen), planned);
    this.manifestDirty = true;
    return planned;
  }

  /**
   * The Markdown that embeds an image: `![[Campaigns/<world>/AI Tool/Attachments/...]]` for a
   * copy (queued for fetching), `![alt](url)` for an external http(s) image, or null (the
   * caller writes a text placeholder).
   */
  embed(src: string, alt: string, width?: number): string | null {
    const trimmed = src.trim();
    if (!trimmed) return null;
    const found = this.foundryPath(trimmed);
    if (found === null || this.relFor(found, false) === null) {
      const url = /^https?:\/\//i.test(trimmed) ? safeUrl(trimmed) : null;
      if (!url) return null;
      const label = collapseWhitespace(alt, 100).replace(/[[\]\\]/g, '') || 'image';
      return `![${label}](${url})`;
    }
    if (!this.allowed) return null;
    const planned = this.plan(trimmed, found);
    if (planned === null) return null;
    if (this.scope) this.scope.seen.add(planned.key);
    else if (planned.owners !== null) {
      // An embed nobody owns: never collected.
      planned.owners = null;
      this.manifestDirty = true;
    }
    const size = width && Number.isFinite(width) && width > 0 ? `|${Math.round(width)}` : '';
    return `![[Campaigns/${this.worldId}/${planned.rel}${size}]]`;
  }

  /** Start rendering the notes of one owner (a Foundry uuid): its embeds are counted for it. */
  beginOwner(owner: string): void {
    this.scope = { owner, seen: new Set() };
  }

  /**
   * Done rendering one owner. `committed`: its notes were written (or already held this text),
   * so the images it no longer embeds lose it as an owner; otherwise its embeds are only added.
   */
  endOwner(committed: boolean): void {
    const scope = this.scope;
    this.scope = null;
    if (!scope) return;
    const before = this.ownerRefs.get(scope.owner) ?? new Set<string>();
    const after = committed ? scope.seen : new Set([...before, ...scope.seen]);
    for (const key of before) {
      if (after.has(key)) continue;
      this.bySource.get(key)?.owners?.delete(scope.owner);
      this.manifestDirty = true;
    }
    for (const key of after) {
      const owners = this.bySource.get(key)?.owners;
      if (owners && !owners.has(scope.owner)) {
        owners.add(scope.owner);
        this.manifestDirty = true;
      }
    }
    if (after.size > 0) this.ownerRefs.set(scope.owner, after);
    else this.ownerRefs.delete(scope.owner);
  }

  /** An owner's notes are gone (trashed): it no longer uses any image. */
  dropOwner(owner: string): void {
    const refs = this.ownerRefs.get(owner);
    if (!refs) return;
    for (const key of refs) this.bySource.get(key)?.owners?.delete(owner);
    this.ownerRefs.delete(owner);
    this.manifestDirty = true;
  }

  /** Load the manifest of earlier runs (before the first embed of a run, so names stay stable). */
  async load(): Promise<void> {
    await this.loadManifest();
  }

  /**
   * Fetch the planned images that are not in the vault yet, until `deadline` (ms). Returns how
   * many files were written. Never throws; failures are kept for the status.
   */
  async flush(deadline: number): Promise<number> {
    if (!this.allowed) return 0;
    await this.loadManifest();
    await this.saveManifest();
    if (!this.origin) return 0;
    const work: Planned[] = [];
    for (const item of this.bySource.values()) {
      const key = pathKey(item.rel);
      if (this.present.has(key)) continue;
      const failed = this.failedAt.get(key);
      if (failed && this.now() - failed.at < RETRY_AFTER_MS) continue;
      work.push(item);
    }
    let written = 0;
    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const left = deadline - this.now();
        if (left < MIN_FETCH_MS) return;
        const item = work[next++];
        if (!item) return;
        if (await this.copy(item, Math.min(FETCH_TIMEOUT_MS, left))) written += 1;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, work.length) }, worker));
    return written;
  }

  private async copy(item: Planned, timeoutMs: number): Promise<boolean> {
    const key = pathKey(item.rel);
    const full = path.join(this.campaignRoot, ...item.rel.split('/'));
    try {
      const stat = await fsp.lstat(full).catch(error => {
        if (errorCode(error) === 'ENOENT') return null;
        throw error;
      });
      if (stat) {
        if (stat.isFile() && stat.size > 0) {
          this.present.add(key);
          this.failedAt.delete(key);
          return false;
        }
        if (!stat.isFile()) throw new Error('a folder or link is in the way');
      }
      const origin = this.origin;
      if (!origin) return false;
      const url = /^https?:\/\//i.test(item.source)
        ? item.source
        : new URL(item.source.replace(/^\/+/, ''), `${origin}/`).href;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let bytes: Uint8Array;
      try {
        const response = await this.fetcher(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`Foundry answered ${response.status}`);
        const type = response.headers.get('content-type') ?? '';
        if (/text\/html/i.test(type)) {
          throw new Error(
            'Foundry answered with a web page, not an image (a login page? set FOUNDRY_AI_FOUNDRY_URL to an address the bridge can reach)'
          );
        }
        const length = Number(response.headers.get('content-length') ?? '0');
        if (length > this.maxBytes) {
          controller.abort();
          throw new Error(tooLargeText(this.maxBytes));
        }
        bytes = await readCapped(response, this.maxBytes, () => controller.abort());
      } finally {
        clearTimeout(timer);
      }
      if (bytes.byteLength === 0) throw new Error('empty file');
      await writeFileAtomic(full, bytes);
      this.present.add(key);
      this.failedAt.delete(key);
      return true;
    } catch (error) {
      this.failedAt.set(key, { at: this.now(), error: errorMessage(error), rel: item.rel });
      return false;
    }
  }

  /**
   * Move images no note embeds any more to the vault trash (call only after a complete
   * reconcile). Images with an unknown owner are kept. Returns how many were trashed.
   */
  async collectGarbage(deadline: number, trash: TrashFile): Promise<number> {
    if (!this.allowed) return 0;
    await this.loadManifest();
    let trashed = 0;
    for (const item of [...this.bySource.values()]) {
      if (this.now() > deadline) break;
      if (item.owners === null || item.owners.size > 0) continue;
      const result = await trash(item.rel);
      if (result === 'kept') continue;
      const key = pathKey(item.rel);
      this.bySource.delete(item.key);
      this.byRel.delete(key);
      this.present.delete(key);
      this.failedAt.delete(key);
      this.manifestDirty = true;
      if (result === 'trashed') trashed += 1;
    }
    await this.saveManifest();
    return trashed;
  }

  private manifestPath(): string {
    return path.join(this.campaignRoot, ...MANIFEST.split('/'));
  }

  /** The images earlier runs planned (fetched again when missing), their names and owners. */
  private async loadManifest(): Promise<void> {
    if (this.manifestLoaded) return;
    this.manifestLoaded = true;
    let entries: unknown[] = [];
    try {
      const raw: unknown = JSON.parse(await fsp.readFile(this.manifestPath(), 'utf8'));
      const images = (raw as { images?: unknown })?.images;
      entries = Array.isArray(images) ? images : [];
    } catch {
      // Missing or unreadable: rebuilt from the notes rendered from now on.
      return;
    }
    for (const entry of entries.slice(0, MAX_MANIFEST_ENTRIES)) {
      const { source, rel, owners } = (entry ?? {}) as {
        source?: unknown;
        rel?: unknown;
        owners?: unknown;
      };
      if (typeof source !== 'string') continue;
      // Re-derive the path: a hand-edited manifest can never point outside the folder.
      const found = this.foundryPath(source);
      if (!found || this.bySource.has(found.key)) continue;
      const planned = this.plan(source, found, typeof rel === 'string' ? rel : undefined);
      if (!planned) continue;
      if (!Array.isArray(owners)) {
        planned.owners = null;
        continue;
      }
      for (const owner of owners) {
        if (typeof owner !== 'string') continue;
        planned.owners?.add(owner);
        const refs = this.ownerRefs.get(owner) ?? new Set<string>();
        refs.add(planned.key);
        this.ownerRefs.set(owner, refs);
      }
    }
    this.manifestDirty = false;
  }

  private async saveManifest(): Promise<void> {
    if (!this.manifestDirty) return;
    this.manifestDirty = false;
    const images = [...this.bySource.values()]
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map(item => ({
        source: item.source,
        rel: item.rel,
        owners: item.owners === null ? null : [...item.owners].sort(),
      }));
    const text = `${JSON.stringify({ schema: 2, images })}\n`;
    await writeFileAtomic(this.manifestPath(), text).catch(() => {
      this.manifestDirty = true;
    });
  }

  status(): AttachmentStatus {
    const pending = [...this.bySource.values()].filter(
      item => !this.present.has(pathKey(item.rel))
    ).length;
    const failed = [...this.failedAt.values()]
      .sort((a, b) => b.at - a.at)
      .slice(0, 20)
      .map(f => ({ path: f.rel, error: f.error }));
    const blocked = this.allowed
      ? this.origin
        ? null
        : "Foundry's address is not known yet (it comes from the GM client, or set FOUNDRY_AI_FOUNDRY_URL)"
      : this.blockedReason;
    return { copied: this.present.size, pending, failed, blocked };
  }
}
