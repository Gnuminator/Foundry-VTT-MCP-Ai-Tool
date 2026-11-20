/**
 * Omens by post (I-181), bridge vault side.
 *
 * Claude drafts one short private text per player (`draft-omens`); the GM approves each one in
 * the dashboard; the Discord bot then sends only approved texts as a private message to the
 * player's own Discord account. Nothing here talks to Foundry or Discord.
 *
 * - `gm/omens.json`: the omens, keyed by id. A tool can add, edit (drafts only) and remove
 *   (drafts and rejected ones). Approving, rejecting and the send steps are control methods
 *   (`omens` in backend.ts, reached only by the dashboard), never tools, so Claude cannot approve
 *   its own draft.
 * - `gm/omens-players.json`: Foundry user id to Discord user id. Private, never in the repo.
 * - Editing a text puts the omen back to draft, so approved text is exactly the text that is sent.
 * - Sending claims the omen first (`sending`), so a crash between the send and its record never
 *   sends twice; a stuck `sending` shows to the GM, who can reopen it.
 */
import type { SecretTermsService } from '../secret-terms.js';
import { newDocumentId } from '../tarokka/service.js';
import type { VaultStore } from '../vault/store.js';
import type { WorldIdResolver } from '../vault/world-id.js';

const OMENS_FILE = 'omens.json';
const OMEN_PLAYERS_FILE = 'omens-players.json';
/** A Foundry user id. */
const USER_ID = /^[A-Za-z0-9]{16}$/;
/** A Discord user id (a snowflake). */
const DISCORD_ID = /^\d{15,25}$/;
/** Discord allows 2000 characters in a message; leave room for the heading. */
export const MAX_OMEN_TEXT = 1500;
const MAX_OMENS = 60;

type OmenStatus = 'draft' | 'approved' | 'rejected' | 'sending' | 'sent' | 'failed';

/** After this many failed sends an omen stops retrying and shows the error to the GM. */
const MAX_SEND_ATTEMPTS = 3;

interface Omen {
  userId: string;
  text: string;
  status: OmenStatus;
  createdAt: string;
  decidedAt?: string;
  sentAt?: string;
  /** Failed send attempts so far, and why the last one failed. */
  attempts?: number;
  lastError?: string;
  /** Secret terms found in the text when it was drafted or edited (Tarokka cards and so on). */
  secretTerms?: string[];
}

interface OmensFile {
  omens?: Record<string, Omen>;
}

interface PlayersFile {
  players?: Record<string, string>;
}

interface OutboxItem {
  id: string;
  userId: string;
  discordId: string;
  text: string;
}

interface OmensStoreOptions {
  store: VaultStore;
  worldIds: Pick<WorldIdResolver, 'current'>;
  /** Terms the text must not carry (secret-terms service); tests may leave it out. */
  findSecretTerms?: (worldId: string, text: string) => Promise<readonly string[]>;
  now?: () => number;
  newId: () => string;
}

function cleanText(text: unknown): string {
  if (typeof text !== 'string') throw new Error('text must be a string');
  const trimmed = text.trim();
  if (!trimmed) throw new Error('text must not be empty');
  if (trimmed.length > MAX_OMEN_TEXT) {
    throw new Error(`text is too long (${trimmed.length} characters, up to ${MAX_OMEN_TEXT})`);
  }
  return trimmed;
}

function assertUserId(value: unknown): string {
  if (typeof value !== 'string' || !USER_ID.test(value)) {
    throw new Error('userId must be a Foundry user id');
  }
  return value;
}

export class OmensStore {
  private readonly store: VaultStore;
  private readonly worldIds: OmensStoreOptions['worldIds'];
  private readonly findSecretTerms: OmensStoreOptions['findSecretTerms'];
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(options: OmensStoreOptions) {
    this.store = options.store;
    this.worldIds = options.worldIds;
    this.findSecretTerms = options.findSecretTerms;
    this.now = options.now ?? ((): number => Date.now());
    this.newId = options.newId;
  }

  private stamp(): string {
    return new Date(this.now()).toISOString();
  }

  private async terms(worldId: string, text: string): Promise<string[] | undefined> {
    const found = this.findSecretTerms ? [...(await this.findSecretTerms(worldId, text))] : [];
    return found.length > 0 ? [...new Set(found)] : undefined;
  }

  /** Every omen, oldest first, and who can be reached. */
  async list(): Promise<{
    omens: Array<{ id: string } & Omen>;
    players: Record<string, string>;
  }> {
    const worldId = await this.worldIds.current();
    const file = (await this.store.read<OmensFile>(worldId, 'gm', OMENS_FILE))?.data ?? {};
    const omens = Object.entries(file.omens ?? {})
      .map(([id, omen]) => ({ id, ...omen }))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    return { omens, players: await this.players(worldId) };
  }

  private async players(worldId: string): Promise<Record<string, string>> {
    return (
      (await this.store.read<PlayersFile>(worldId, 'gm', OMEN_PLAYERS_FILE))?.data?.players ?? {}
    );
  }

  /** Link a Foundry user to a Discord user id (the GM's, or the owner's, one-time setup). */
  async setPlayer(userId: unknown, discordId: unknown): Promise<void> {
    const uid = assertUserId(userId);
    const worldId = await this.worldIds.current();
    await this.store.update<PlayersFile>(worldId, 'gm', OMEN_PLAYERS_FILE, 1, current => {
      const players = { ...(current?.data?.players ?? {}) };
      if (discordId === null || discordId === '') {
        delete players[uid];
      } else {
        if (typeof discordId !== 'string' || !DISCORD_ID.test(discordId)) {
          throw new Error('discordId must be a Discord user id (digits only)');
        }
        players[uid] = discordId;
      }
      return { players };
    });
  }

  async add(userId: unknown, text: unknown): Promise<{ id: string; omen: Omen }> {
    const uid = assertUserId(userId);
    const clean = cleanText(text);
    const worldId = await this.worldIds.current();
    const secretTerms = await this.terms(worldId, clean);
    let result: { id: string; omen: Omen } | null = null;
    await this.store.update<OmensFile>(worldId, 'gm', OMENS_FILE, 1, current => {
      const omens = { ...(current?.data?.omens ?? {}) };
      if (Object.keys(omens).length >= MAX_OMENS) {
        throw new Error(`The omens list is full (${MAX_OMENS}); remove old ones first`);
      }
      const id = this.newId();
      const omen: Omen = {
        userId: uid,
        text: clean,
        status: 'draft',
        createdAt: this.stamp(),
        ...(secretTerms ? { secretTerms } : {}),
      };
      omens[id] = omen;
      result = { id, omen };
      return { omens };
    });
    return result!;
  }

  /** Change a draft's (or a rejected omen's) text; it goes back to draft. */
  async edit(id: string, text: unknown): Promise<Omen> {
    const clean = cleanText(text);
    const worldId = await this.worldIds.current();
    const secretTerms = await this.terms(worldId, clean);
    return this.change(worldId, id, omen => {
      if (
        omen.status !== 'draft' &&
        omen.status !== 'rejected' &&
        omen.status !== 'approved' &&
        omen.status !== 'failed'
      ) {
        throw new Error(`Omen ${id} is ${omen.status} and cannot be edited`);
      }
      const next: Omen = {
        userId: omen.userId,
        text: clean,
        status: 'draft',
        createdAt: omen.createdAt,
      };
      if (secretTerms) next.secretTerms = secretTerms;
      return next;
    });
  }

  /** Remove a draft, rejected or sent omen. */
  async remove(id: string): Promise<void> {
    const worldId = await this.worldIds.current();
    await this.store.update<OmensFile>(worldId, 'gm', OMENS_FILE, 1, current => {
      const omens = { ...(current?.data?.omens ?? {}) };
      const omen = omens[id];
      if (!omen) throw new Error(`No omen ${id}`);
      if (omen.status === 'approved' || omen.status === 'sending') {
        throw new Error(`Omen ${id} is ${omen.status}; the GM must reopen it first`);
      }
      delete omens[id];
      return { omens };
    });
  }

  /** GM decision (dashboard only): approve, reject, or reopen back to draft. */
  async decide(
    id: string,
    decision: 'approve' | 'reject' | 'reopen',
    confirmFlagged = false,
    confirmUnsure = false
  ): Promise<Omen> {
    const worldId = await this.worldIds.current();
    return this.change(worldId, id, omen => {
      if (decision === 'reopen') {
        if (omen.status === 'sent') throw new Error('A sent omen cannot be reopened');
        if (omen.status === 'sending' && !confirmUnsure) {
          throw new Error(
            `Omen ${id} may already have reached the player; check their Discord before reopening it`
          );
        }
        const { attempts: _a, lastError: _e, ...rest } = omen;
        return { ...rest, status: 'draft' };
      }
      if (omen.status === 'sent' || omen.status === 'sending') {
        throw new Error(`Omen ${id} is already ${omen.status}`);
      }
      if (decision === 'reject') {
        return { ...omen, status: 'rejected', decidedAt: this.stamp() };
      }
      if (omen.secretTerms && !confirmFlagged) {
        throw new Error(
          `Omen ${id} names ${omen.secretTerms.join(', ')}; read it again and confirm to approve`
        );
      }
      const { attempts: _a, lastError: _e, ...rest } = omen;
      return { ...rest, status: 'approved', decidedAt: this.stamp() };
    });
  }

  /** Approved omens whose player has a Discord id (what the bot may send). */
  async outbox(): Promise<OutboxItem[]> {
    const { omens, players } = await this.list();
    const items: OutboxItem[] = [];
    for (const omen of omens) {
      const discordId = players[omen.userId];
      if (omen.status === 'approved' && discordId) {
        items.push({ id: omen.id, userId: omen.userId, discordId, text: omen.text });
      }
    }
    return items;
  }

  /**
   * The bot takes an approved omen before it sends it (approved to sending). Returns what to
   * send, or null when it is no longer approved. The recipient is read here, from the player
   * link, not from the bot's request.
   */
  async claim(id: string): Promise<OutboxItem | null> {
    const worldId = await this.worldIds.current();
    const discordId = (await this.players(worldId))[(await this.omenOf(worldId, id))?.userId ?? ''];
    if (!discordId) return null;
    let claimed: OutboxItem | null = null;
    await this.store.update<OmensFile>(worldId, 'gm', OMENS_FILE, 1, current => {
      const omens = { ...(current?.data?.omens ?? {}) };
      const omen = omens[id];
      if (omen?.status !== 'approved') return { omens };
      omens[id] = { ...omen, status: 'sending' };
      claimed = { id, userId: omen.userId, discordId, text: omen.text };
      return { omens };
    });
    return claimed;
  }

  /**
   * The bot's result. Sent: the omen is sent, whatever the GM did meanwhile (the message went out).
   * Failed: back to approved for the next round, and after MAX_SEND_ATTEMPTS to failed with the
   * reason, so the GM sees it and the bot stops retrying.
   */
  async finish(id: string, ok: boolean, error?: string): Promise<Omen> {
    const worldId = await this.worldIds.current();
    return this.change(worldId, id, omen => {
      if (ok) {
        if (omen.status === 'sent') return omen;
        const { attempts: _a, lastError: _e, ...rest } = omen;
        return { ...rest, status: 'sent', sentAt: this.stamp() };
      }
      if (omen.status !== 'sending') return omen;
      const attempts = (omen.attempts ?? 0) + 1;
      const lastError = (error ?? 'the message could not be sent').slice(0, 200);
      return {
        ...omen,
        status: attempts >= MAX_SEND_ATTEMPTS ? 'failed' : 'approved',
        attempts,
        lastError,
      };
    });
  }

  private async omenOf(worldId: string, id: string): Promise<Omen | undefined> {
    return (await this.store.read<OmensFile>(worldId, 'gm', OMENS_FILE))?.data?.omens?.[id];
  }

  private async change(worldId: string, id: string, fn: (omen: Omen) => Omen): Promise<Omen> {
    let result: Omen | null = null;
    await this.store.update<OmensFile>(worldId, 'gm', OMENS_FILE, 1, current => {
      const omens = { ...(current?.data?.omens ?? {}) };
      const omen = omens[id];
      if (!omen) throw new Error(`No omen ${id}`);
      result = fn(omen);
      omens[id] = result;
      return { omens };
    });
    return result!;
  }
}

/** The `omens` control method (dashboard only; not a tool, never listed to Claude). */
export async function handleOmensControl(store: OmensStore, params: unknown): Promise<unknown> {
  const p = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>;
  const id = typeof p.id === 'string' ? p.id : '';
  switch (p.action) {
    case 'list':
      return store.list();
    case 'decide':
      if (p.decision !== 'approve' && p.decision !== 'reject' && p.decision !== 'reopen') {
        throw new Error('decision must be approve, reject or reopen');
      }
      return {
        omen: await store.decide(
          id,
          p.decision,
          p.confirmFlagged === true,
          p.confirmUnsure === true
        ),
      };
    case 'outbox':
      return { items: await store.outbox() };
    case 'claim':
      return { item: await store.claim(id) };
    case 'finish':
      return {
        omen: await store.finish(
          id,
          p.ok === true,
          typeof p.error === 'string' ? p.error : undefined
        ),
      };
    case 'set-player':
      await store.setPlayer(p.userId, p.discordId ?? null);
      return { ok: true };
    default:
      throw new Error('Unknown omens action');
  }
}

/** The answer line for the `omens` control method: a result, or the error text (never throws). */
export async function omensControlReply(
  store: OmensStore,
  id: unknown,
  params: unknown
): Promise<{ id: unknown; result: unknown } | { id: unknown; error: { message: string } }> {
  try {
    return { id, result: await handleOmensControl(store, params) };
  } catch (e: unknown) {
    return { id, error: { message: e instanceof Error ? e.message : 'Bad request' } };
  }
}

/** The store as the bridge builds it: ids like Foundry's, secret terms from the service. */
export function createOmensStore(
  store: VaultStore,
  worldIds: Pick<WorldIdResolver, 'current'>,
  secretTerms: Pick<SecretTermsService, 'findSecretTerms'>
): OmensStore {
  return new OmensStore({
    store,
    worldIds,
    newId: newDocumentId,
    findSecretTerms: async (worldId, text): Promise<string[]> =>
      (await secretTerms.findSecretTerms(worldId, text)).matches.map(m => m.term),
  });
}
