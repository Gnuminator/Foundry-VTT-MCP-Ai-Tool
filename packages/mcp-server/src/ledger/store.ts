/**
 * Who knows what (secret ledger), bridge vault side.
 *
 * A GM-only ledger of who has heard which secret: a private backstory, a whisper the GM sent, a
 * rumour only one character holds. It lives in the bridge vault (`gm/ledger.json`), the same GM-only
 * folder as the omens and the handout seen log, and nothing reads it for a player: the dashboard
 * serves it to the GM role only, the player connector has no tool for it, and no player or TV
 * route touches the file.
 *
 * - An entry says what the secret is (a short line the GM wrote, not book text), who knows it
 *   (Foundry users, with the name they had when it was written) and optionally the journal page
 *   it belongs to (`pageId`). A page entry makes a chip on every GM surface that shows the page:
 *   "Only Jorr knows this", or "Nobody knows this yet" when `knownBy` is empty.
 * - Entries are written directly (they change nothing in Foundry and nothing players see, like the
 *   handout queue), by the GM in the dashboard or by the whisper desk. Claude only reads.
 */
import { newDocumentId } from '../tarokka/service.js';
import type { VaultStore } from '../vault/store.js';
import type { WorldIdResolver } from '../vault/world-id.js';

const LEDGER_FILE = 'ledger.json';
/** A Foundry document id (users, pages). */
const DOCUMENT_ID = /^[A-Za-z0-9]{16}$/;
const MAX_LEDGER_TEXT = 600;
const MAX_LEDGER_ENTRIES = 300;
const MAX_NAME = 80;
const MAX_KNOWERS = 12;

type LedgerKind = 'secret' | 'backstory' | 'whisper';
type LedgerSource = 'gm' | 'whisper-desk';

interface Knower {
  userId: string;
  name: string;
}

interface LedgerEntry {
  kind: LedgerKind;
  text: string;
  /** Who knows it; empty means nobody at the table yet (the GM only). */
  knownBy: Knower[];
  /** The journal page this is about, when it is about one (the chip shows on that page). */
  pageId?: string;
  /** What the page is called, kept so the ledger reads without the world. */
  pageName?: string;
  source: LedgerSource;
  at: string;
}

interface LedgerFile {
  entries?: Record<string, LedgerEntry>;
}

export interface LedgerView extends LedgerEntry {
  id: string;
}

interface AddEntryInput {
  kind?: unknown;
  text: unknown;
  knownBy?: unknown;
  pageId?: unknown;
  pageName?: unknown;
  source?: LedgerSource;
}

interface LedgerStoreOptions {
  store: VaultStore;
  worldIds: Pick<WorldIdResolver, 'current'>;
  now?: () => number;
  newId?: () => string;
}

function cleanText(text: unknown): string {
  if (typeof text !== 'string') throw new Error('text must be a string');
  const trimmed = text.trim();
  if (!trimmed) throw new Error('text must not be empty');
  if (trimmed.length > MAX_LEDGER_TEXT) {
    throw new Error(`text is too long (${trimmed.length} characters, up to ${MAX_LEDGER_TEXT})`);
  }
  return trimmed;
}

function cleanKnowers(value: unknown): Knower[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_KNOWERS) {
    throw new Error('knownBy must be a short list of players');
  }
  const seen = new Set<string>();
  const out: Knower[] = [];
  for (const item of value) {
    const rec = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const userId = rec.userId;
    const name = rec.name;
    if (typeof userId !== 'string' || !DOCUMENT_ID.test(userId)) {
      throw new Error('each player needs a Foundry user id');
    }
    if (seen.has(userId)) continue;
    seen.add(userId);
    out.push({
      userId,
      name: typeof name === 'string' && name.trim() ? name.trim().slice(0, MAX_NAME) : userId,
    });
  }
  return out;
}

/** The words a chip shows: "Only Jorr knows this", "Jorr and Mia know this", or nobody. */
export function knownByLine(knownBy: readonly Knower[]): string {
  const names = knownBy.map(k => k.name);
  if (names.length === 0) return 'Nobody knows this yet';
  if (names.length === 1) return `Only ${names[0]} knows this`;
  const head = names.slice(0, -1).join(', ');
  return `${head} and ${names[names.length - 1]} know this`;
}

export class LedgerStore {
  private readonly store: VaultStore;
  private readonly worldIds: LedgerStoreOptions['worldIds'];
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(options: LedgerStoreOptions) {
    this.store = options.store;
    this.worldIds = options.worldIds;
    this.now = options.now ?? ((): number => Date.now());
    this.newId = options.newId ?? newDocumentId;
  }

  /** Every entry, newest first. */
  async list(): Promise<LedgerView[]> {
    const worldId = await this.worldIds.current();
    const file = (await this.store.read<LedgerFile>(worldId, 'gm', LEDGER_FILE))?.data ?? {};
    return Object.entries(file.entries ?? {})
      .map(([id, entry]) => ({ id, ...entry }))
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }

  /**
   * The chip text per page id: who knows what the page holds. A page with several entries shows
   * the people who know all of them (the strictest reading), or nobody when any entry has none.
   */
  async pageChips(): Promise<Record<string, { line: string; knownBy: Knower[] }>> {
    const byPage = new Map<string, Knower[]>();
    for (const entry of await this.list()) {
      if (!entry.pageId) continue;
      const prev = byPage.get(entry.pageId);
      byPage.set(
        entry.pageId,
        prev === undefined
          ? entry.knownBy
          : prev.filter(k => entry.knownBy.some(o => o.userId === k.userId))
      );
    }
    const out: Record<string, { line: string; knownBy: Knower[] }> = {};
    for (const [pageId, knownBy] of byPage) out[pageId] = { line: knownByLine(knownBy), knownBy };
    return out;
  }

  async add(input: AddEntryInput): Promise<LedgerView> {
    const kind = input.kind ?? 'secret';
    if (kind !== 'secret' && kind !== 'backstory' && kind !== 'whisper') {
      throw new Error('kind must be secret, backstory or whisper');
    }
    const text = cleanText(input.text);
    const knownBy = cleanKnowers(input.knownBy);
    let pageId: string | undefined;
    if (input.pageId !== undefined && input.pageId !== null && input.pageId !== '') {
      if (typeof input.pageId !== 'string' || !DOCUMENT_ID.test(input.pageId)) {
        throw new Error('pageId must be a journal page id');
      }
      pageId = input.pageId;
    }
    const pageName =
      pageId && typeof input.pageName === 'string' && input.pageName.trim()
        ? input.pageName.trim().slice(0, 120)
        : undefined;
    const worldId = await this.worldIds.current();
    let result: LedgerView | null = null;
    await this.store.update<LedgerFile>(worldId, 'gm', LEDGER_FILE, 1, current => {
      const entries = { ...(current?.data?.entries ?? {}) };
      if (Object.keys(entries).length >= MAX_LEDGER_ENTRIES) {
        throw new Error(
          `The ledger is full (${MAX_LEDGER_ENTRIES} entries); remove old ones first`
        );
      }
      const id = this.newId();
      const entry: LedgerEntry = {
        kind,
        text,
        knownBy,
        ...(pageId ? { pageId } : {}),
        ...(pageName ? { pageName } : {}),
        source: input.source ?? 'gm',
        at: new Date(this.now()).toISOString(),
      };
      entries[id] = entry;
      result = { id, ...entry };
      return { entries };
    });
    return result!;
  }

  /** Change who knows an entry (the GM told another player). */
  async setKnownBy(id: string, knownBy: unknown): Promise<LedgerView> {
    const knowers = cleanKnowers(knownBy);
    const worldId = await this.worldIds.current();
    let result: LedgerView | null = null;
    await this.store.update<LedgerFile>(worldId, 'gm', LEDGER_FILE, 1, current => {
      const entries = { ...(current?.data?.entries ?? {}) };
      const entry = entries[id];
      if (!entry) throw new Error(`No ledger entry ${id}`);
      entries[id] = { ...entry, knownBy: knowers };
      result = { id, ...entries[id] };
      return { entries };
    });
    return result!;
  }

  async remove(id: string): Promise<void> {
    const worldId = await this.worldIds.current();
    await this.store.update<LedgerFile>(worldId, 'gm', LEDGER_FILE, 1, current => {
      const entries = { ...(current?.data?.entries ?? {}) };
      if (!entries[id]) throw new Error(`No ledger entry ${id}`);
      delete entries[id];
      return { entries };
    });
  }

  /**
   * What the read tool answers: entries filtered by a player name or id (who knows what), a page
   * id, or a word in the text. Newest first, at most `limit`.
   */
  async query(filter: {
    who?: string;
    pageId?: string;
    text?: string;
    limit?: number;
  }): Promise<LedgerView[]> {
    const who = filter.who?.trim().toLowerCase();
    const text = filter.text?.trim().toLowerCase();
    const limit = Math.min(Math.max(filter.limit ?? 40, 1), 100);
    return (await this.list())
      .filter(e => {
        if (who && !e.knownBy.some(k => k.name.toLowerCase().includes(who) || k.userId === who)) {
          return false;
        }
        if (filter.pageId && e.pageId !== filter.pageId) return false;
        if (text && !e.text.toLowerCase().includes(text)) return false;
        return true;
      })
      .slice(0, limit);
  }
}

/** The `ledger` control method (dashboard only; not a tool, never listed to Claude). */
export async function handleLedgerControl(store: LedgerStore, params: unknown): Promise<unknown> {
  const p = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>;
  const id = typeof p.id === 'string' ? p.id : '';
  switch (p.action) {
    case 'list':
      return { entries: await store.list(), chips: await store.pageChips() };
    case 'chips':
      return { chips: await store.pageChips() };
    case 'add':
      return {
        entry: await store.add({
          kind: p.kind,
          text: p.text,
          knownBy: p.knownBy,
          pageId: p.pageId,
          pageName: p.pageName,
          source: 'gm',
        }),
      };
    case 'set-known-by':
      return { entry: await store.setKnownBy(id, p.knownBy) };
    case 'remove':
      await store.remove(id);
      return { ok: true };
    default:
      throw new Error('Unknown ledger action');
  }
}
