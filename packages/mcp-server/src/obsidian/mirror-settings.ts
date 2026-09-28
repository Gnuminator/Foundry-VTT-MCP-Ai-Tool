/**
 * Settings and environment for the Obsidian mirror (docs/OBSIDIAN-O4-DESIGN.md,
 * sections 1.8 and 6.1; chunk C6).
 *
 * The mirror's settings live in the bridge vault (`gm/obsidian-mirror.json`,
 * key `settings`), never in a module setting: they are GM data and change
 * only through a guarded plan (`plan-obsidian-mirror`), so the GM confirms
 * each change and can undo it. Everything read back here is normalized
 * strictly: a value that is not the expected shape falls back to the safe
 * default, so a hand-edited file can never widen what the mirror writes.
 */
import { createHash } from 'crypto';

import { DEFAULT_STORY_ITEM_TYPES } from '@gnuminator/shared';

import type { VaultStore } from '../vault/store.js';

import { MIRROR_KINDS, type MirrorKind, type MirrorSettings } from './mirror-common.js';

/** Bridge vault file (area `gm`) holding `{ settings }`. */
export const MIRROR_SETTINGS_FILE = 'obsidian-mirror.json';
/** Guarded-write feature id; the module registers a switch of the same id (default off). */
export const MIRROR_FEATURE = 'obsidian-mirror';

/** Foundry document ids are 16 alphanumeric characters. */
export const DOCUMENT_ID = /^[A-Za-z0-9]{16}$/;
/** dnd5e item type keys are lowercase camelCase or kebab-case words. */
export const ITEM_TYPE = /^[a-z][a-zA-Z0-9-]{0,40}$/;

export const MAX_IDS = 200;
export const MAX_ITEM_TYPES = 30;

export const DEFAULT_POLL_MS = 10_000;
export const MIN_POLL_MS = 5_000;
/** Default `FOUNDRY_AI_OPEN_BASE`: where the README tells the GM to open the dashboard. */
export const DEFAULT_OPEN_BASE = 'http://localhost:3000';

function freezeSettings(settings: MirrorSettings): MirrorSettings {
  Object.freeze(settings.kinds);
  Object.freeze(settings.text.folderIds);
  Object.freeze(settings.text.journalIds);
  Object.freeze(settings.text);
  Object.freeze(settings.excludeFolderIds);
  Object.freeze(settings.storyItemTypes);
  return Object.freeze(settings);
}

/** The mirror is off, mirrors all five kinds, no page text, no excluded folders. */
export const DEFAULT_MIRROR_SETTINGS: MirrorSettings = freezeSettings({
  schema: 1,
  enabled: false,
  kinds: [...MIRROR_KINDS],
  text: { folderIds: [], journalIds: [] },
  excludeFolderIds: [],
  storyItemTypes: [...DEFAULT_STORY_ITEM_TYPES],
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Valid ids only, deduplicated, sorted, at most `MAX_IDS`. Anything else is dropped. */
function normalizeIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set<string>();
  for (const value of raw) {
    if (typeof value === 'string' && DOCUMENT_ID.test(value)) ids.add(value);
  }
  return [...ids].sort().slice(0, MAX_IDS);
}

function normalizeKinds(raw: unknown): MirrorKind[] {
  if (!Array.isArray(raw)) return [...MIRROR_KINDS];
  // A list is taken as written (an empty one means "mirror nothing"); unknown
  // entries are dropped, the rest come out deduplicated in the fixed order.
  return MIRROR_KINDS.filter(kind => raw.includes(kind));
}

function normalizeItemTypes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_STORY_ITEM_TYPES];
  const types = new Set<string>();
  for (const value of raw) {
    if (typeof value === 'string' && ITEM_TYPE.test(value)) types.add(value);
  }
  return [...types].slice(0, MAX_ITEM_TYPES);
}

/**
 * Strict, total normalization of whatever the vault file (or a plan
 * argument) holds. Never throws. Keys come out in a fixed order, so the
 * canonical JSON (and the hash) depends only on the values.
 */
export function normalizeMirrorSettings(raw: unknown): MirrorSettings {
  try {
    const source = isRecord(raw) ? raw : {};
    const text = isRecord(source.text) ? source.text : {};
    return {
      schema: 1,
      enabled: source.enabled === true,
      kinds: normalizeKinds(source.kinds),
      text: { folderIds: normalizeIds(text.folderIds), journalIds: normalizeIds(text.journalIds) },
      excludeFolderIds: normalizeIds(source.excludeFolderIds),
      storyItemTypes: normalizeItemTypes(source.storyItemTypes),
    };
  } catch {
    // A hostile value (a throwing getter or proxy) reads as nothing: the defaults.
    return {
      schema: 1,
      enabled: false,
      kinds: [...MIRROR_KINDS],
      text: { folderIds: [], journalIds: [] },
      excludeFolderIds: [],
      storyItemTypes: [...DEFAULT_STORY_ITEM_TYPES],
    };
  }
}

/** 16 hex characters of the sha256 of the canonical JSON of normalized settings. */
export function hashMirrorSettings(settings: MirrorSettings): string {
  const canonical = normalizeMirrorSettings(settings);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 16);
}

/**
 * The world's mirror settings and their hash (a change of hash forces the
 * pump to reconcile). A missing file gives the defaults. A file that exists
 * but is not a valid vault envelope throws (the vault store never
 * overwrites a file it cannot parse); callers treat that as "mirror off".
 */
export async function readMirrorSettings(
  store: VaultStore,
  worldId: string
): Promise<{ settings: MirrorSettings; hash: string }> {
  const stored = await store.read<{ settings?: unknown } | null>(
    worldId,
    'gm',
    MIRROR_SETTINGS_FILE
  );
  const data = stored?.data;
  const settings = normalizeMirrorSettings(isRecord(data) ? data.settings : undefined);
  return { settings, hash: hashMirrorSettings(settings) };
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

export interface MirrorEnvSettings {
  /** Incremental cycle interval in milliseconds (at least `MIN_POLL_MS`). */
  pollMs: number;
  /** Validated http(s) origin, no trailing slash: the base of "Open in Foundry" links. */
  openBase: string;
  /** Why a variable was ignored or clamped; never echoes credentials. */
  warnings: string[];
}

function parsePollMs(value: string | undefined, warnings: string[]): number {
  if (value === undefined || value.trim() === '') return DEFAULT_POLL_MS;
  const text = value.trim();
  if (!/^\d{1,9}$/.test(text)) {
    warnings.push(
      `FOUNDRY_AI_MIRROR_POLL_MS must be a whole number of milliseconds; using ${DEFAULT_POLL_MS}`
    );
    return DEFAULT_POLL_MS;
  }
  const ms = Number(text);
  if (ms < MIN_POLL_MS) {
    warnings.push(
      `FOUNDRY_AI_MIRROR_POLL_MS is below the minimum of ${MIN_POLL_MS}; using ${MIN_POLL_MS}`
    );
    return MIN_POLL_MS;
  }
  return ms;
}

/**
 * The origin of a plain http(s) URL: no username or password, no path beyond
 * `/`, no query, no fragment. Anything else is null. Never throws.
 */
function parseOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;
  if (url.search !== '' || url.hash !== '') return null;
  // `new URL('http://host?')` and `http://host#` leave an empty search/hash
  // that the checks above cannot see; reject the raw text as well.
  if (/[?#]/.test(value)) return null;
  return url.origin;
}

function parseOpenBase(value: string | undefined, warnings: string[]): string {
  if (value === undefined || value.trim() === '') return DEFAULT_OPEN_BASE;
  const origin = parseOrigin(value.trim());
  if (origin === null) {
    // Never echo the value: it may hold credentials.
    warnings.push(
      'FOUNDRY_AI_OPEN_BASE must be an http(s) origin such as http://localhost:3000, with no ' +
        `username, password, path, query or fragment; using ${DEFAULT_OPEN_BASE}`
    );
    return DEFAULT_OPEN_BASE;
  }
  return origin;
}

/**
 * `FOUNDRY_AI_MIRROR_POLL_MS` (default 10,000, minimum 5,000) and
 * `FOUNDRY_AI_OPEN_BASE` (default `http://localhost:3000`, the origin the GM
 * opens the dashboard at: the `/open` page reads the GM token from
 * localStorage, which is per origin, so `127.0.0.1` would not do; any other
 * host that passes the checks is accepted, for example a tunnel hostname).
 */
export function mirrorEnvSettings(
  env: Record<string, string | undefined> = process.env
): MirrorEnvSettings {
  const warnings: string[] = [];
  const pollMs = parsePollMs(env.FOUNDRY_AI_MIRROR_POLL_MS, warnings);
  const openBase = parseOpenBase(env.FOUNDRY_AI_OPEN_BASE, warnings);
  return { pollMs, openBase, warnings };
}
