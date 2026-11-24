/**
 * Draft tray (I-069), bridge vault side.
 *
 * Claude drafts a text meant for players (read-aloud, NPC line, letter, recap) with
 * `draft-player-text`. It lands here, GM only, and nothing reaches a player until the GM
 * publishes it from the dashboard. Publishing posts it to Foundry chat (everyone, or a whisper to
 * one named player) through the existing chat bridge query.
 *
 * - `gm/drafts.json`: the drafts, keyed by id. A tool can add, edit and remove drafts. Publish and
 *   discard are control methods (`drafts` in backend.ts, reached only by the dashboard), never
 *   tools, so Claude cannot publish its own draft.
 * - The secret-terms check (the same service the whisper guard uses) runs when a draft is added or
 *   edited and again at publish time; a flagged draft needs an explicit confirm to publish.
 * - Publishing claims the draft first (`publishing`), so a crash between the post and its record
 *   never posts twice; a stuck `publishing` shows to the GM, who can reopen it.
 */
import type { SecretTermsService } from '../secret-terms.js';
import { newDocumentId } from '../tarokka/service.js';
import type { VaultStore } from '../vault/store.js';
import type { WorldIdResolver } from '../vault/world-id.js';

const DRAFTS_FILE = 'drafts.json';
export const MAX_DRAFT_TEXT = 4000;
const MAX_DRAFTS = 60;
const MAX_LABEL = 80;

export const DRAFT_KINDS = ['read-aloud', 'npc-line', 'letter', 'recap'] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

export type DraftStatus = 'draft' | 'publishing' | 'published' | 'discarded';

export interface Draft {
  kind: DraftKind;
  text: string;
  /** NPC line: who speaks. Letter: who it is from. Optional for the others. */
  speaker?: string;
  /** A Foundry user name to whisper to; without it the text is posted to everyone. */
  whisperTo?: string;
  status: DraftStatus;
  createdAt: string;
  decidedAt?: string;
  /** Secret terms found when drafted or edited (Tarokka cards and so on). */
  secretTerms?: string[];
  lastError?: string;
}

interface DraftsFile {
  drafts?: Record<string, Draft>;
}

/** What the store hands the chat sender; the backend wires this to the chat bridge query. */
export interface DraftPost {
  message: string;
  speakerActorName?: string;
  whisperTargets?: string[];
}

interface DraftsStoreOptions {
  store: VaultStore;
  worldIds: Pick<WorldIdResolver, 'current'>;
  findSecretTerms?: (worldId: string, text: string) => Promise<readonly string[]>;
  /** Posts to Foundry chat; throws when the post fails. Tests pass a stub. */
  post?: (post: DraftPost) => Promise<void>;
  now?: () => number;
  newId: () => string;
}

function cleanText(text: unknown): string {
  if (typeof text !== 'string') throw new Error('text must be a string');
  const trimmed = text.trim();
  if (!trimmed) throw new Error('text must not be empty');
  if (trimmed.length > MAX_DRAFT_TEXT) {
    throw new Error(`text is too long (${trimmed.length} characters, up to ${MAX_DRAFT_TEXT})`);
  }
  return trimmed;
}

function cleanLabel(value: unknown, what: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`${what} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > MAX_LABEL) throw new Error(`${what} is too long (up to ${MAX_LABEL})`);
  return trimmed || undefined;
}

function cleanKind(kind: unknown): DraftKind {
  if (!DRAFT_KINDS.includes(kind as DraftKind)) {
    throw new Error(`kind must be one of ${DRAFT_KINDS.join(', ')}`);
  }
  return kind as DraftKind;
}

/** The chat text for a draft: a letter shows who it is from; an NPC line speaks as the NPC. */
export function draftChatPost(draft: Draft): DraftPost {
  const base: DraftPost = {
    message:
      draft.kind === 'letter' && draft.speaker ? `${draft.text}\n\n${draft.speaker}` : draft.text,
  };
  if (draft.kind === 'npc-line' && draft.speaker) base.speakerActorName = draft.speaker;
  if (draft.whisperTo) base.whisperTargets = [draft.whisperTo];
  return base;
}

export class DraftsStore {
  private readonly store: VaultStore;
  private readonly worldIds: DraftsStoreOptions['worldIds'];
  private readonly findSecretTerms: DraftsStoreOptions['findSecretTerms'];
  private readonly post: DraftsStoreOptions['post'];
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(options: DraftsStoreOptions) {
    this.store = options.store;
    this.worldIds = options.worldIds;
    this.findSecretTerms = options.findSecretTerms;
    this.post = options.post;
    this.now = options.now ?? ((): number => Date.now());
    this.newId = options.newId;
  }

  private stamp(): string {
    return new Date(this.now()).toISOString();
  }

  private async terms(
    worldId: string,
    ...texts: Array<string | undefined>
  ): Promise<string[] | undefined> {
    if (!this.findSecretTerms) return undefined;
    const found: string[] = [];
    for (const text of texts) {
      if (text) found.push(...(await this.findSecretTerms(worldId, text)));
    }
    return found.length > 0 ? [...new Set(found)] : undefined;
  }

  /** Every draft, oldest first. Published and discarded ones stay for the GM's record. */
  async list(): Promise<{ drafts: Array<{ id: string } & Draft> }> {
    const worldId = await this.worldIds.current();
    const file = (await this.store.read<DraftsFile>(worldId, 'gm', DRAFTS_FILE))?.data ?? {};
    const drafts = Object.entries(file.drafts ?? {})
      .map(([id, draft]) => ({ id, ...draft }))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    return { drafts };
  }

  async add(input: {
    kind?: unknown;
    text?: unknown;
    speaker?: unknown;
    whisperTo?: unknown;
  }): Promise<{ id: string; draft: Draft }> {
    const kind = cleanKind(input.kind);
    const text = cleanText(input.text);
    const speaker = cleanLabel(input.speaker, 'speaker');
    const whisperTo = cleanLabel(input.whisperTo, 'whisperTo');
    const worldId = await this.worldIds.current();
    const secretTerms = await this.terms(worldId, text, speaker);
    let result: { id: string; draft: Draft } | null = null;
    await this.store.update<DraftsFile>(worldId, 'gm', DRAFTS_FILE, 1, current => {
      const drafts = { ...(current?.data?.drafts ?? {}) };
      const open = Object.values(drafts).filter(d => d.status === 'draft').length;
      if (Object.keys(drafts).length >= MAX_DRAFTS) {
        for (const [oldId, old] of Object.entries(drafts)) {
          if (old.status === 'published' || old.status === 'discarded') delete drafts[oldId];
          if (Object.keys(drafts).length < MAX_DRAFTS) break;
        }
      }
      if (Object.keys(drafts).length >= MAX_DRAFTS) {
        throw new Error(`The draft tray is full (${open} open); discard some first`);
      }
      const id = this.newId();
      const draft: Draft = {
        kind,
        text,
        ...(speaker ? { speaker } : {}),
        ...(whisperTo ? { whisperTo } : {}),
        status: 'draft',
        createdAt: this.stamp(),
        ...(secretTerms ? { secretTerms } : {}),
      };
      drafts[id] = draft;
      result = { id, draft };
      return { drafts };
    });
    return result!;
  }

  /** Change an open draft's text (and optionally its speaker or whisper target). */
  async edit(
    id: string,
    input: { text?: unknown; speaker?: unknown; whisperTo?: unknown }
  ): Promise<Draft> {
    const worldId = await this.worldIds.current();
    const text = input.text === undefined ? undefined : cleanText(input.text);
    const speaker =
      input.speaker === undefined ? undefined : (cleanLabel(input.speaker, 'speaker') ?? '');
    const whisperTo =
      input.whisperTo === undefined ? undefined : (cleanLabel(input.whisperTo, 'whisperTo') ?? '');
    const existing = await this.draftOf(worldId, id);
    if (!existing) throw new Error(`No draft ${id}`);
    const nextText = text ?? existing.text;
    const nextSpeaker = speaker ?? existing.speaker;
    const secretTerms = await this.terms(worldId, nextText, nextSpeaker);
    return this.change(worldId, id, draft => {
      if (draft.status !== 'draft') {
        throw new Error(`Draft ${id} is ${draft.status} and cannot be edited`);
      }
      const next: Draft = {
        kind: draft.kind,
        text: nextText,
        status: 'draft',
        createdAt: draft.createdAt,
      };
      if (nextSpeaker) next.speaker = nextSpeaker;
      const nextWhisper = whisperTo ?? draft.whisperTo;
      if (nextWhisper) next.whisperTo = nextWhisper;
      if (secretTerms) next.secretTerms = secretTerms;
      return next;
    });
  }

  /** Throw an open draft away (the GM, or Claude for its own draft). It stays listed as discarded. */
  async discard(id: string): Promise<Draft> {
    const worldId = await this.worldIds.current();
    return this.change(worldId, id, draft => {
      if (draft.status === 'published' || draft.status === 'publishing') {
        throw new Error(`Draft ${id} is already ${draft.status}`);
      }
      return { ...draft, status: 'discarded', decidedAt: this.stamp() };
    });
  }

  /** Remove a draft from the tray for good (Claude may remove open drafts and discarded ones). */
  async remove(id: string): Promise<void> {
    const worldId = await this.worldIds.current();
    await this.store.update<DraftsFile>(worldId, 'gm', DRAFTS_FILE, 1, current => {
      const drafts = { ...(current?.data?.drafts ?? {}) };
      const draft = drafts[id];
      if (!draft) throw new Error(`No draft ${id}`);
      if (draft.status === 'publishing' || draft.status === 'published') {
        throw new Error(`Draft ${id} is ${draft.status}; it cannot be removed`);
      }
      delete drafts[id];
      return { drafts };
    });
  }

  /** Back to an open draft: a discarded one, or a `publishing` one stuck after a crash. */
  async reopen(id: string, confirmUnsure = false): Promise<Draft> {
    const worldId = await this.worldIds.current();
    return this.change(worldId, id, draft => {
      if (draft.status === 'published') throw new Error('A published draft cannot be reopened');
      if (draft.status === 'publishing' && !confirmUnsure) {
        throw new Error(
          `Draft ${id} may already be in chat; check the chat log before reopening it`
        );
      }
      const { lastError: _e, decidedAt: _d, ...rest } = draft;
      return { ...rest, status: 'draft' };
    });
  }

  /**
   * Publish (dashboard only): claim, post to chat, record. The secret terms are checked again
   * now; a flagged draft needs `confirmFlagged`. A failed post puts the draft back with the reason.
   */
  async publish(id: string, confirmFlagged = false): Promise<Draft> {
    if (!this.post) throw new Error('Publishing needs a Foundry connection');
    const worldId = await this.worldIds.current();
    let claimed: Draft | null = null;
    const fresh = await this.draftOf(worldId, id);
    if (!fresh) throw new Error(`No draft ${id}`);
    const secretTerms = await this.terms(worldId, fresh.text, fresh.speaker);
    if (secretTerms && !confirmFlagged) {
      await this.change(worldId, id, draft => ({ ...draft, secretTerms }));
      throw new Error(
        `Draft ${id} names ${secretTerms.join(', ')}; read it again and confirm to publish`
      );
    }
    await this.change(worldId, id, draft => {
      if (draft.status !== 'draft') throw new Error(`Draft ${id} is ${draft.status}`);
      claimed = draft;
      return { ...draft, status: 'publishing' };
    });
    try {
      await this.post(draftChatPost(claimed!));
    } catch (e: unknown) {
      const lastError = (e instanceof Error ? e.message : 'the post failed').slice(0, 200);
      await this.change(worldId, id, draft => ({ ...draft, status: 'draft', lastError }));
      throw new Error(`Could not post to chat: ${lastError}`, { cause: e });
    }
    return this.change(worldId, id, draft => {
      const { lastError: _e, ...rest } = draft;
      return { ...rest, status: 'published', decidedAt: this.stamp() };
    });
  }

  private async draftOf(worldId: string, id: string): Promise<Draft | undefined> {
    return (await this.store.read<DraftsFile>(worldId, 'gm', DRAFTS_FILE))?.data?.drafts?.[id];
  }

  private async change(worldId: string, id: string, fn: (draft: Draft) => Draft): Promise<Draft> {
    let result: Draft | null = null;
    await this.store.update<DraftsFile>(worldId, 'gm', DRAFTS_FILE, 1, current => {
      const drafts = { ...(current?.data?.drafts ?? {}) };
      const draft = drafts[id];
      if (!draft) throw new Error(`No draft ${id}`);
      result = fn(draft);
      drafts[id] = result;
      return { drafts };
    });
    return result!;
  }
}

/** The `drafts` control method (dashboard only; not a tool, never listed to Claude). */
export async function handleDraftsControl(store: DraftsStore, params: unknown): Promise<unknown> {
  const p = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>;
  const id = typeof p.id === 'string' ? p.id : '';
  switch (p.action) {
    case 'list':
      return store.list();
    case 'edit':
      return {
        draft: await store.edit(id, { text: p.text, speaker: p.speaker, whisperTo: p.whisperTo }),
      };
    case 'discard':
      return { draft: await store.discard(id) };
    case 'reopen':
      return { draft: await store.reopen(id, p.confirmUnsure === true) };
    case 'publish':
      return { draft: await store.publish(id, p.confirmFlagged === true) };
    default:
      throw new Error('Unknown drafts action');
  }
}

/** The answer line for the `drafts` control method: a result, or the error text (never throws). */
export async function draftsControlReply(
  store: DraftsStore,
  id: unknown,
  params: unknown
): Promise<{ id: unknown; result: unknown } | { id: unknown; error: { message: string } }> {
  try {
    return { id, result: await handleDraftsControl(store, params) };
  } catch (e: unknown) {
    return { id, error: { message: e instanceof Error ? e.message : 'Bad request' } };
  }
}

/** The store as the bridge builds it: ids like Foundry's, secret terms from the service. */
export function createDraftsStore(
  store: VaultStore,
  worldIds: Pick<WorldIdResolver, 'current'>,
  secretTerms: Pick<SecretTermsService, 'findSecretTerms'>,
  post: (post: DraftPost) => Promise<void>
): DraftsStore {
  return new DraftsStore({
    store,
    worldIds,
    post,
    newId: newDocumentId,
    findSecretTerms: async (worldId, text): Promise<string[]> =>
      (await secretTerms.findSecretTerms(worldId, text)).matches.map(m => m.term),
  });
}
