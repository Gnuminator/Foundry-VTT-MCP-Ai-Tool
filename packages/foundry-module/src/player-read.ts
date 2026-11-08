/**
 * `playerRead` (a player's own Claude): read-only, scoped on this side to ONE Foundry user.
 * The control port has no login, so every permission check here uses the user object looked up
 * from the `userId` in the message, never anything else the caller sends. A player sees their own
 * characters and the rules books they may observe; world journals, world actors, adventure packs,
 * the dnd5e system packs (monster stat blocks), the DMG pack and world-owned packs never.
 */

import { characterSheets } from './character-sheet.js';
import type {
  DocLike,
  IndexRow,
  PackLike,
  RulesSearchHit,
  ScopedSearchParams,
  ScopedSearchResult,
} from './data-access/rules-search.js';
import { plainText } from './data-access/rules-search.js';

/** Query name (a module file imports types only from shared). */
export const PLAYER_READ_QUERY = 'playerRead';

const ACTIONS = ['character', 'levelUp', 'searchBooks', 'findEntries', 'getEntry'] as const;
type PlayerReadAction = (typeof ACTIONS)[number];

const DENIED_ID = 'aitool-content.journals';
const MAX_FIND = 20;
const MAX_DESCRIPTION = 6000;

export interface PlayerReadDeps {
  rulesSearch: {
    searchRulesScoped(params: ScopedSearchParams): Promise<ScopedSearchResult>;
  };
  levelUp: {
    getLevelUpOptions(data: { identifier: string; className?: string }): Promise<unknown>;
  };
}

interface PlayerUser {
  id?: string;
  isGM?: boolean;
  name?: string;
}

interface OwnedActor {
  id: string;
  name?: string;
  type?: string;
  testUserPermission?: (user: unknown, level: string) => boolean;
}

interface GameLike {
  users?: { get?: (id: string) => PlayerUser | undefined };
  actors?: Iterable<OwnedActor>;
  packs?: Iterable<PackLike>;
}

const getGame = (): GameLike | undefined => (globalThis as { game?: GameLike }).game;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A missing or throwing permission function counts as NOT allowed. */
function allowed(
  doc: { testUserPermission?: (user: unknown, level: string) => boolean } | null | undefined,
  user: unknown,
  level: string
): boolean {
  if (!doc || typeof doc.testUserPermission !== 'function') return false;
  try {
    return doc.testUserPermission(user, level) === true;
  } catch {
    return false;
  }
}

function resolveUser(userId: string): PlayerUser {
  const user = userId ? getGame()?.users?.get?.(userId) : undefined;
  if (!user || user.isGM) throw new Error('No such player');
  return user;
}

function packType(pack: PackLike): string | undefined {
  return pack.documentName ?? pack.metadata?.type;
}

/** True for a pack a player's Claude may never read, whatever its permissions say. */
export function isDeniedPack(pack: PackLike): boolean {
  const meta = pack.metadata ?? ({} as PackLike['metadata']);
  const id = str(meta.id ?? pack.collection);
  const pkg = str(meta.packageName) || id.split('.')[0] || '';
  if (packType(pack) === 'Adventure') return true;
  if (id.startsWith('dnd5e.') || pkg === 'dnd5e') return true;
  if (id === DENIED_ID) return true;
  // World packs are NOT denied as a class: the live campaign keeps the kept books in
  // world.player-* packs. Adventure packs (above), the OBSERVER check and the term filter cover
  // the GM-only ones.
  return false;
}

/** The packs this user may read: journals and items, not denied, and OBSERVER on the pack. */
export function playerPacks(user: unknown): PackLike[] {
  const out: PackLike[] = [];
  for (const pack of getGame()?.packs ?? []) {
    const type = packType(pack);
    if (type !== 'JournalEntry' && type !== 'Item') continue;
    if (isDeniedPack(pack)) continue;
    if (!allowed(pack, user, 'OBSERVER')) continue;
    out.push(pack);
  }
  return out;
}

/** A fetch of pack documents that remembers each answer (also a miss) for one request. */
function documentLoader(): (pack: PackLike, id: string) => Promise<DocLike | null> {
  const cache = new Map<string, Promise<DocLike | null>>();
  return (pack, id): Promise<DocLike | null> => {
    const key = `${pack.metadata.id}\u0000${id}`;
    let found = cache.get(key);
    if (!found) {
      found = (async (): Promise<DocLike | null> => {
        if (typeof pack.getDocument !== 'function') return null;
        try {
          return (await pack.getDocument(id)) ?? null;
        } catch {
          return null;
        }
      })();
      cache.set(key, found);
    }
    return found;
  };
}

function findOwnedCharacters(user: unknown): OwnedActor[] {
  return [...(getGame()?.actors ?? [])].filter(
    a => a.type === 'character' && allowed(a, user, 'OWNER')
  );
}

function nameMatches(names: string[], wanted: string): boolean {
  const w = wanted.trim().toLowerCase();
  return names.some(n => n.toLowerCase() === w);
}

async function characterAction(userId: string, name: string): Promise<unknown> {
  const result = await characterSheets({ userId });
  if (!name.trim()) return result;
  const wanted = name.trim().toLowerCase();
  const sheets = result.sheets as Array<{ name?: string }>;
  const exact = sheets.filter(s => String(s.name ?? '').toLowerCase() === wanted);
  const kept =
    exact.length > 0
      ? exact
      : sheets.filter(s =>
          String(s.name ?? '')
            .toLowerCase()
            .includes(wanted)
        );
  if (kept.length === 0) {
    return { sheets: [], note: 'No character of yours matches that name.' };
  }
  return { ...result, sheets: kept };
}

async function levelUpAction(
  user: PlayerUser,
  name: string,
  className: string,
  deps: PlayerReadDeps
): Promise<unknown> {
  const owned = findOwnedCharacters(user);
  let actor: OwnedActor | undefined;
  if (name.trim()) {
    const wanted = name.trim();
    actor =
      owned.find(a => nameMatches([a.name ?? '', a.id], wanted)) ??
      owned.find(a => (a.name ?? '').toLowerCase().includes(wanted.toLowerCase()));
  } else if (owned.length === 1) {
    actor = owned[0];
  } else if (owned.length > 1) {
    throw new Error(
      `You have several characters; say which one: ${owned.map(a => a.name ?? a.id).join(', ')}`
    );
  }
  if (!actor) throw new Error('Character not found among your characters');
  return deps.levelUp.getLevelUpOptions({
    identifier: actor.id,
    ...(className.trim() ? { className: className.trim() } : {}),
  });
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(Math.max(n, min), max);
}

async function searchBooksAction(
  user: PlayerUser,
  body: Record<string, unknown>,
  deps: PlayerReadDeps
): Promise<unknown> {
  const packs = playerPacks(user);
  const byId = new Map(packs.map(p => [p.metadata.id, p]));
  const load = documentLoader();
  const entryAllowed = async (hit: RulesSearchHit): Promise<boolean> => {
    const pack = hit.packId ? byId.get(hit.packId) : undefined;
    if (!pack) return false;
    const doc = await load(pack, hit.documentId);
    if (!allowed(doc, user, 'OBSERVER')) return false;
    if (hit.pageId) {
      const page = [...(doc?.pages ?? [])].find(p => p.id === hit.pageId);
      if (
        page &&
        typeof page.testUserPermission === 'function' &&
        !allowed(page, user, 'OBSERVER')
      ) {
        return false;
      }
    }
    return true;
  };
  // Only these four fields are read from the wire; includeWorld and includeOtherBooks never are.
  return deps.rulesSearch.searchRulesScoped({
    query: str(body.query),
    limit: clamp(body.limit, 5, 1, 10),
    excerptChars: clamp(body.excerptChars, 240, 80, 600),
    packs,
    entryAllowed,
  });
}

async function findEntriesAction(
  user: PlayerUser,
  body: Record<string, unknown>
): Promise<unknown> {
  const query = str(body.query).trim().toLowerCase();
  const type = str(body.type).trim().toLowerCase();
  const limit = clamp(body.limit, 10, 1, MAX_FIND);
  const load = documentLoader();
  const results: Array<{
    packId: string;
    packLabel: string;
    entryId: string;
    name: string;
    type: string;
  }> = [];
  for (const pack of playerPacks(user)) {
    if (results.length >= limit) break;
    const kind = packType(pack) ?? '';
    let rows: IndexRow[];
    try {
      const index =
        typeof pack.getIndex === 'function'
          ? await pack.getIndex({ fields: ['name', 'type'] })
          : pack.index;
      rows = [...(index ?? [])];
    } catch {
      continue;
    }
    for (const row of rows) {
      if (results.length >= limit) break;
      const entryId = str(row._id ?? row.id);
      const name = str(row.name);
      const rowType = kind === 'JournalEntry' ? 'JournalEntry' : str(row.type);
      if (!entryId) continue;
      if (query && !name.toLowerCase().includes(query)) continue;
      if (type && rowType.toLowerCase() !== type) continue;
      const doc = await load(pack, entryId);
      if (!allowed(doc, user, 'OBSERVER')) continue;
      results.push({
        packId: pack.metadata.id,
        packLabel: pack.metadata.label ?? pack.metadata.id,
        entryId,
        name,
        type: rowType,
      });
    }
  }
  return { results };
}

async function getEntryAction(user: PlayerUser, body: Record<string, unknown>): Promise<unknown> {
  const packId = str(body.packId);
  const entryId = str(body.entryId);
  const missing = new Error('Entry not found');
  if (!packId || !entryId) throw missing;
  const pack = playerPacks(user).find(p => p.metadata.id === packId);
  if (!pack) throw missing;
  const doc = await documentLoader()(pack, entryId);
  if (!doc || !allowed(doc, user, 'OBSERVER')) throw missing;

  let description: string;
  let type: string;
  if (packType(pack) === 'JournalEntry') {
    type = 'JournalEntry';
    const parts: string[] = [];
    for (const page of doc.pages ?? []) {
      if (typeof page.testUserPermission === 'function' && !allowed(page, user, 'OBSERVER')) {
        continue;
      }
      const text = plainText(page.text?.content);
      if (text) parts.push(`${page.name ?? ''}: ${text}`);
    }
    description = parts.join('\n\n');
  } else {
    type = doc.type ?? 'Item';
    description = plainText(doc.system?.description?.value);
  }
  const truncated = description.length > MAX_DESCRIPTION;
  return {
    packId,
    entryId,
    name: doc.name ?? '',
    type,
    description: truncated ? description.slice(0, MAX_DESCRIPTION) : description,
    ...(truncated ? { truncated: true } : {}),
  };
}

/** The query handler: `{ userId, action, ... }`. Unknown actions throw. */
export async function playerRead(data: unknown, deps: PlayerReadDeps): Promise<unknown> {
  const body = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const action = str(body.action) as PlayerReadAction;
  if (!ACTIONS.includes(action)) throw new Error('Unknown player read action');
  const userId = str(body.userId);
  const user = resolveUser(userId);
  switch (action) {
    case 'character':
      return characterAction(userId, str(body.name));
    case 'levelUp':
      return levelUpAction(user, str(body.name), str(body.className), deps);
    case 'searchBooks':
      return searchBooksAction(user, body, deps);
    case 'findEntries':
      return findEntriesAction(user, body);
    case 'getEntry':
      return getEntryAction(user, body);
  }
}
