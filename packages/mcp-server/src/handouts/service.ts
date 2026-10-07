/**
 * Spoiler-safe handouts, backend side (plan feature 2, M2).
 *
 * A page is a "handout" a player can see only when it is BOTH allowlisted in
 * the bridge vault (`gm/reveals.json` `pages.<pageId>`, the same allowlist
 * Tarokka reveals write to) AND observable by a non-GM user per Foundry
 * ownership (the module's `getPagesForPlayers`). Revealing or hiding a page is
 * a guarded plan (feature `handouts`, off by default in the module settings);
 * `apply-planned-change` applies it after the GM confirms.
 *
 * Reveal copies a handout (2026-09-29): Foundry 14 hides every page of a
 * journal no player can observe, and imported adventures keep their handouts
 * inside GM-only chapter journals. So a reveal of such a page (or any page with
 * `copy: true`) copies it into the player journal "Handouts" instead: one mixed
 * plan creates the journal on first use (ownership Observer, remembered as
 * `handoutsJournal` in `gm/reveals.json`; created again when it was deleted),
 * then a page with the source's name, type and content (text without secret
 * blocks and embeds, links to GM documents as plain text, or an image's source
 * and caption), flagged
 * `flags.foundry-mcp-bridge.copiedFrom`. The copy is the allowlisted page
 * (`pages.<copyId>.copiedFrom`). Revealing the source again updates the copy;
 * hiding deletes it (the journal stays). The source page and its journal are
 * never changed.
 *
 * Every plan that creates a copy also sets `handoutsJournal.lastCopy` (the
 * vault anchor): undoing an earlier copy plan, whose inverse may delete the
 * whole journal it created, then reports a conflict while a later copy is in
 * the journal, and two pending copy plans cannot both apply (no duplicates).
 *
 * `playerHandouts()` returns raw GM HTML: it is consumed only by the dashboard
 * server, which sanitizes it before any player sees it. Nothing here ever
 * copies page content into a plan summary or a log line (a page title is
 * fine).
 */
import {
  MODULE_ID,
  type GuardedOp,
  type GuardedUpdateOp,
  type OpSnapshot,
  type PageForPlayers,
  type PathValue,
} from '@gnuminator/shared';

import type { FoundryClient } from '../foundry-client.js';
import type { GuardedWriteService, PlanView, VaultOp } from '../guarded-write/service.js';
import { samePathValue } from '../guarded-write/values.js';
import { REVEALS_FILE, newDocumentId } from '../tarokka/service.js';
import type { VaultStore } from '../vault/store.js';
import type { WorldIdResolver } from '../vault/world-id.js';

import {
  HandoutQueue,
  QUEUE_FILE,
  assertPlayers,
  orderedQueue,
  type QueueEntry,
  type SeenEntry,
} from './queue.js';
import { prepareCopyHtml } from './strip-secrets.js';

export const HANDOUTS_FEATURE = 'handouts';
/** The player journal reveal copies go into. */
export const HANDOUTS_JOURNAL_NAME = 'Handouts';
/** The flag on a copy naming its source page: `flags.foundry-mcp-bridge.copiedFrom`. */
export const COPIED_FROM_FLAG = 'copiedFrom';
/** Foundry's OBSERVER ownership level: players can read the page. */
const OBSERVER = 2;
/** Foundry's NONE ownership level. */
const NONE = 0;
/** Foundry's INHERIT ownership level: an embedded page follows its journal. */
const INHERIT = -1;
/** `CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML`: a copied text page is stored as HTML. */
const TEXT_FORMAT_HTML = 1;
/** A JournalEntryPage uuid: `JournalEntry.<16>.JournalEntryPage.<16>`. */
const PAGE_UUID = /^JournalEntry\.[A-Za-z0-9]{16}\.JournalEntryPage\.[A-Za-z0-9]{16}$/;

/** One allowlisted page as stored in `gm/reveals.json` `pages.<pageId>`. */
export interface RevealedPageEntry {
  uuid: string;
  feature: string;
  position?: string;
  readingId?: string;
  at: string;
  /** The page's `ownership.default` before a handouts reveal changed it. */
  previousOwnership?: number;
  /** A reveal copy in "Handouts": the uuid of the page it copies. */
  copiedFrom?: string;
  /** Revealed only to these users (Foundry user ids, I-039); absent: every player. */
  players?: string[];
  /**
   * A reveal to chosen players: each user's `ownership.<id>` before the reveal
   * raised it (null: the key was not set), restored by a hide.
   */
  previousUserOwnership?: Record<string, number | null>;
}

interface RevealsFile {
  pages?: Record<string, RevealedPageEntry>;
  /**
   * The player journal "Handouts" reveal copies go into (created on first use).
   * `lastCopy`: the page id of the newest copy created in it (the undo anchor).
   */
  handoutsJournal?: { uuid: string; lastCopy?: string };
}

/** One row of `list-revealed-pages`: no page content, a title is fine. */
export interface RevealedPageView {
  pageId: string;
  uuid: string;
  title: string | null;
  exists: boolean;
  observable: boolean;
  feature: string;
  revealedAt: string;
  /** A reveal copy in "Handouts": the page it copies. */
  copiedFrom?: string;
  /** Revealed only to these users (Foundry user ids); absent: every player. */
  players?: string[];
  /** Who opened it on /player, first time each (their picked name). */
  seenBy: SeenEntry[];
}

/** One staged page of the reveal queue (`list-revealed-pages` `queue`). */
export interface QueuedPageView {
  entryId: string;
  uuid: string;
  title: string | null;
  exists: boolean;
  sceneId: string | null;
  players?: string[];
  addedAt: string;
}

/** What `plan-page-reveal` returns for `queue` and `unqueue` (no plan: the queue is GM prep). */
export interface QueueChangeView {
  queued: boolean;
  pageUuid: string;
  note: string;
}

/** One row of `get-player-handouts`: GM data, sanitized by the dashboard server. */
export interface PlayerHandout {
  id: string;
  uuid: string;
  title: string;
  html: string;
  revealedAt: string;
  /** Only these users may see it (Foundry user ids); absent: every player. */
  players?: string[];
}

export interface PlayerHandoutsView {
  handouts: PlayerHandout[];
  /** Every allowlisted uuid, for the dashboard sanitizer's link filtering. */
  revealedUuids: string[];
}

/** What a reveal copy plan does to the copy, for the GM's UI ("Copied into Handouts"). */
export interface HandoutCopyView {
  /** `create`: a new copy; `update`: the existing copy gets the source's current content. */
  action: 'create' | 'update';
  /** The copy players open. */
  pageUuid: string;
  /** The page it copies (never changed). */
  sourceUuid: string;
  journalUuid: string;
  journalName: string;
  /** This plan also creates the journal (first use, or the remembered one was deleted). */
  journalCreated: boolean;
  /** Secret blocks left out of the copy (text pages). */
  secretsRemoved: number;
  /** `@Embed[...]` enrichers left out of the copy (text pages). */
  embedsRemoved: number;
  /** Links to documents players cannot open, turned into plain text (text pages). */
  linksUnlinked: number;
}

/** What `plan-page-reveal` returns. */
export type PageRevealPlan = PlanView & {
  pageUuid: string;
  /** Set when the reveal copies the page into "Handouts". */
  copy?: HandoutCopyView;
  /** Hide: the copies in "Handouts" this plan deletes. */
  copiesDeleted?: string[];
  /** A sentence for the GM, e.g. where the copy goes. */
  note?: string;
};

export interface HandoutsServiceOptions {
  guardedWrites: Pick<GuardedWriteService, 'createPlan'>;
  store: VaultStore;
  worldIds: Pick<WorldIdResolver, 'current'>;
  foundryClient: Pick<FoundryClient, 'query'>;
  now?: () => number;
  /** The reveal queue and seen log (default: one on the same store). */
  queue?: HandoutQueue;
}

/** The content a copy gets: create data and the same values as update paths. */
interface CopyContent {
  type: 'text' | 'image';
  /** Create data besides `_id`, `name`, `type` and `flags`. */
  fields: Record<string, unknown>;
  /** name, text or image paths as the copy should have them (absent: unset). */
  values: PathValue[];
  secretsRemoved: number;
  embedsRemoved: number;
  linksUnlinked: number;
}

function unwrap<T>(response: unknown, what: string): T {
  const r = response as { success?: unknown; error?: unknown } | null | undefined;
  if (r && typeof r === 'object' && r.success === false) {
    throw new Error(`${what}: ${typeof r.error === 'string' ? r.error : 'refused by Foundry'}`);
  }
  return response as T;
}

/** The page id (stable) from a JournalEntryPage uuid: its last id segment. */
function pageIdOf(uuid: string): string {
  return uuid.split('.').pop()!;
}

/** The journal uuid from a JournalEntryPage uuid. */
function journalOf(pageUuid: string): string {
  return pageUuid.split('.JournalEntryPage.')[0];
}

function assertPageUuid(value: unknown): string {
  if (typeof value !== 'string' || !PAGE_UUID.test(value)) {
    throw new Error(
      'pageUuid must be a journal page uuid: JournalEntry.<id>.JournalEntryPage.<id>'
    );
  }
  return value;
}

const ACTIONS = ['reveal', 'hide', 'queue', 'unqueue', 'reveal-next'] as const;
type RevealAction = (typeof ACTIONS)[number];

function assertAction(value: unknown): RevealAction {
  if (typeof value !== 'string' || !(ACTIONS as readonly string[]).includes(value)) {
    throw new Error('action must be "reveal", "hide", "queue", "unqueue" or "reveal-next"');
  }
  return value as RevealAction;
}

function assertSceneId(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9]{16}$/.test(value)) {
    throw new Error('sceneId must be a Foundry scene id');
  }
  return value;
}

/**
 * "Show it now" (I-110): the plan option that pops the page up on the players' screens after the
 * reveal, for the players it is revealed to (every player when `players` is not set).
 */
function showPlayers(
  showNow: boolean,
  uuid: string,
  players: string[] | undefined
): { showToPlayers?: { uuid: string; users: string[] } } {
  return showNow ? { showToPlayers: { uuid, users: players ?? [] } } : {};
}

/** A player-facing sentence: "to every player" or "to 2 chosen players". */
function audience(players: string[] | undefined): string {
  if (!players) return 'players';
  return players.length === 1 ? '1 chosen player' : `${players.length} chosen players`;
}

function missingPage(uuid: string): PageForPlayers {
  return {
    uuid,
    exists: false,
    name: null,
    observable: false,
    journalObservable: false,
    html: null,
  };
}

/** The page's type; a module without `type` reports html only for text pages. */
function pageTypeOf(page: PageForPlayers): string | undefined {
  if (typeof page.type === 'string' && page.type) return page.type;
  return page.html !== null ? 'text' : undefined;
}

/**
 * What a copy of `page` holds; refuses page types a reveal cannot copy.
 * `revealedUuids`: the allowlisted pages, the only link targets a copy keeps.
 */
function copyContentOf(
  page: PageForPlayers,
  name: string,
  title: string,
  revealedUuids: ReadonlySet<string>
): CopyContent {
  const type = pageTypeOf(page);
  if (type === 'text') {
    const { html, secretsRemoved, embedsRemoved, linksUnlinked } = prepareCopyHtml(
      page.html ?? '',
      revealedUuids
    );
    return {
      type,
      fields: { text: { content: html, format: TEXT_FORMAT_HTML } },
      values: [
        { path: 'name', present: true, value: name },
        { path: 'text.content', present: true, value: html },
        { path: 'text.format', present: true, value: TEXT_FORMAT_HTML },
      ],
      secretsRemoved,
      embedsRemoved,
      linksUnlinked,
    };
  }
  if (type === 'image') {
    const src = typeof page.src === 'string' && page.src ? page.src : null;
    if (!src) throw new Error(`The image page "${title}" has no image to copy`);
    const caption = typeof page.caption === 'string' && page.caption ? page.caption : null;
    return {
      type,
      fields: { src, ...(caption ? { image: { caption } } : {}) },
      values: [
        { path: 'name', present: true, value: name },
        { path: 'src', present: true, value: src },
        caption
          ? { path: 'image.caption', present: true, value: caption }
          : { path: 'image.caption', present: false },
      ],
      secretsRemoved: 0,
      embedsRemoved: 0,
      linksUnlinked: 0,
    };
  }
  if (type === undefined) {
    throw new Error(
      `Cannot copy "${title}": the Foundry module does not report page types. Update the ` +
        'module, then reveal again.'
    );
  }
  throw new Error(
    `Cannot copy "${title}": it is a "${type}" page, and a reveal copies only text and image ` +
      'pages. Move the page into a journal players can observe (Observer), then reveal it with ' +
      'copy: false.'
  );
}

/** An update op that sets the present values and unsets the absent ones. */
function updateOpFor(uuid: string, values: PathValue[]): GuardedUpdateOp {
  const changes: Record<string, unknown> = {};
  const unset: string[] = [];
  for (const value of values) {
    if (value.present) changes[value.path] = value.value;
    else unset.push(value.path);
  }
  return { kind: 'update', uuid, changes, ...(unset.length > 0 ? { unset } : {}) };
}

/** A copy's ownership for chosen players: none by default, Observer for each of them. */
function chosenOwnership(players: string[]): Record<string, number> {
  const ownership: Record<string, number> = { default: NONE };
  for (const id of players) ownership[id] = OBSERVER;
  return ownership;
}

/**
 * The ownership values a copy should end with when it is revealed again:
 * chosen players (none by default, Observer each), or every player (inherit
 * from the "Handouts" journal); users no longer chosen lose their key. Empty
 * when both reveals are for every player (nothing to change).
 */
function copyOwnershipValues(
  before: string[] | undefined,
  after: string[] | undefined
): PathValue[] {
  if (!before && !after) return [];
  const values: PathValue[] = [
    { path: 'ownership.default', present: true, value: after ? NONE : INHERIT },
  ];
  for (const id of after ?? [])
    values.push({ path: `ownership.${id}`, present: true, value: OBSERVER });
  for (const id of before ?? []) {
    if (!after?.includes(id)) values.push({ path: `ownership.${id}`, present: false });
  }
  return values;
}

function copyNote(title: string, copy: HandoutCopyView, warning?: string): string {
  const where =
    copy.action === 'update'
      ? `its copy in the player journal "${copy.journalName}" gets the current content`
      : `players get a copy of "${title}" in the player journal "${copy.journalName}"${
          copy.journalCreated ? ' (created by this change)' : ''
        }`;
  const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
  const secrets =
    copy.secretsRemoved > 0
      ? ` ${plural(copy.secretsRemoved, 'secret block', 'secret blocks')} left out.`
      : '';
  const embeds =
    copy.embedsRemoved > 0
      ? ` ${plural(copy.embedsRemoved, 'embedded document', 'embedded documents')} left out.`
      : '';
  const links =
    copy.linksUnlinked > 0
      ? ` ${plural(copy.linksUnlinked, 'link', 'links')} to documents players cannot open ` +
        `turned into plain text.`
      : '';
  return (
    `Copied into ${copy.journalName}: when applied, ${where}; the source page and its journal ` +
    `are not changed.${secrets}${embeds}${links}${warning ? ` ${warning}` : ''}`
  );
}

/** Called after the reveal queue changed (a page queued or taken off), whoever asked. */
export type QueueChangedListener = () => void | Promise<void>;

export class HandoutsService {
  private readonly queueListeners: QueueChangedListener[] = [];
  private readonly guardedWrites: HandoutsServiceOptions['guardedWrites'];
  private readonly store: VaultStore;
  private readonly worldIds: HandoutsServiceOptions['worldIds'];
  private readonly foundry: HandoutsServiceOptions['foundryClient'];
  private readonly now: () => number;
  readonly queue: HandoutQueue;

  constructor(options: HandoutsServiceOptions) {
    this.guardedWrites = options.guardedWrites;
    this.store = options.store;
    this.worldIds = options.worldIds;
    this.foundry = options.foundryClient;
    this.now = options.now ?? ((): number => Date.now());
    this.queue =
      options.queue ??
      new HandoutQueue({
        store: options.store,
        worldIds: options.worldIds,
        now: this.now,
        newId: newDocumentId,
      });
  }

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  /** Every allowlisted page, whether it still exists and is currently observable. */
  async listRevealed(): Promise<RevealedPageView[]> {
    const worldId = await this.worldIds.current();
    const file = await this.load(worldId);
    const entries = Object.entries(file.pages ?? {});
    if (entries.length === 0) return [];
    const [pages, seen] = await Promise.all([
      this.pagesFor(entries.map(([, entry]) => entry.uuid)),
      this.queue.seen(worldId),
    ]);
    return entries.map(([pageId, entry]) => {
      const page = pages.get(entry.uuid);
      return {
        pageId,
        uuid: entry.uuid,
        title: page?.name ?? null,
        exists: page?.exists ?? false,
        observable: page?.observable ?? false,
        feature: entry.feature,
        revealedAt: entry.at,
        ...(entry.copiedFrom ? { copiedFrom: entry.copiedFrom } : {}),
        ...(entry.players ? { players: entry.players } : {}),
        seenBy: seen[pageId] ?? [],
      };
    });
  }

  /** The reveal queue, oldest first, with titles (no page content). */
  async listQueue(): Promise<QueuedPageView[]> {
    const worldId = await this.worldIds.current();
    const entries = orderedQueue(await this.queue.load(worldId));
    if (entries.length === 0) return [];
    const pages = await this.pagesFor(entries.map(([, e]) => e.uuid));
    return entries.map(([entryId, e]) => {
      const page = pages.get(e.uuid);
      return {
        entryId,
        uuid: e.uuid,
        title: page?.name ?? null,
        exists: page?.exists ?? false,
        sceneId: e.sceneId,
        ...(e.players ? { players: e.players } : {}),
        addedAt: e.addedAt,
      };
    });
  }

  /**
   * A player opened a handout on /player: remember the first time (I-039).
   * Only pages on the reveal allowlist count, and only for a player the page
   * is revealed to.
   */
  async recordSeen(pageId: string, userId: string, name: string): Promise<{ recorded: boolean }> {
    const worldId = await this.worldIds.current();
    const entry = (await this.load(worldId)).pages?.[pageId];
    if (!entry) return { recorded: false };
    if (entry.players && !entry.players.includes(userId)) return { recorded: false };
    return this.queue.markSeen(pageId, userId, name);
  }

  /** Allowlisted pages that exist and are currently observable, with raw HTML. */
  async playerHandouts(): Promise<PlayerHandoutsView> {
    const worldId = await this.worldIds.current();
    const file = await this.load(worldId);
    const entries = Object.entries(file.pages ?? {});
    const revealedUuids = entries.map(([, entry]) => entry.uuid);
    if (entries.length === 0) return { handouts: [], revealedUuids: [] };
    const pages = await this.pagesFor(revealedUuids);
    const handouts: PlayerHandout[] = [];
    for (const [pageId, entry] of entries) {
      const page = pages.get(entry.uuid);
      if (!page || !page.exists || !page.observable) continue;
      handouts.push({
        id: pageId,
        uuid: entry.uuid,
        title: page.name ?? 'Untitled',
        html: page.html ?? '',
        revealedAt: entry.at,
        ...(entry.players ? { players: entry.players } : {}),
      });
    }
    return { handouts, revealedUuids };
  }

  // -------------------------------------------------------------------------
  // Plans
  // -------------------------------------------------------------------------

  /**
   * Plan revealing a page to players or hiding one.
   *
   * Reveal: `copy` omitted copies the page into "Handouts" exactly when its
   * journal is hidden from every player and ownership may be set (the case
   * where raising the page alone cannot reveal it); `true` always copies;
   * `false` allowlists the page and optionally raises its ownership to
   * Observer (refused while its journal is hidden).
   * Hide: removes the page from the allowlist (restoring the ownership a reveal
   * changed), and deletes the page's copies in "Handouts" (or the page itself
   * when it is a copy).
   */
  async planPageReveal(args: {
    pageUuid?: unknown;
    action: string;
    setOwnership?: boolean;
    copy?: boolean;
    players?: unknown;
    sceneId?: unknown;
    /** Also pop the page up on the players' screens after the reveal (Foundry's Show Players). */
    showNow?: boolean;
  }): Promise<PageRevealPlan> {
    const action = assertAction(args.action);
    if (action === 'queue' || action === 'unqueue') {
      throw new Error(`Use queuePage or unqueuePage for action "${action}"`);
    }
    if (args.copy !== undefined && typeof args.copy !== 'boolean') {
      throw new Error('copy must be true or false');
    }
    if (args.showNow !== undefined && typeof args.showNow !== 'boolean') {
      throw new Error('showNow must be true or false');
    }
    if (args.showNow === true && action === 'hide') {
      throw new Error('showNow only goes with a reveal: hiding a page never shows it');
    }
    const players = assertPlayers(args.players);
    const sceneId = assertSceneId(args.sceneId);
    if (action === 'reveal-next') return this.planRevealNext(sceneId, args);
    const pageUuid = assertPageUuid(args.pageUuid);
    return this.planRevealOrHide(pageUuid, action, {
      setOwnership: args.setOwnership ?? true,
      ...(args.copy !== undefined ? { copy: args.copy } : {}),
      ...(args.showNow ? { showNow: true } : {}),
      ...(players ? { players } : {}),
      extraVaultOps: [],
    });
  }

  /**
   * Also call `listener` after every successful `queuePage` and `unqueuePage` (from Claude, the
   * dashboard or a module request). Queue changes record no audit entry, so this is how an open
   * Handouts window in Foundry learns of them. The listener is not awaited and its errors (sync or
   * async) are swallowed: it must never fail the queue change.
   */
  addQueueChangedListener(listener: QueueChangedListener): void {
    this.queueListeners.push(listener);
  }

  private notifyQueueChanged(): void {
    for (const listener of this.queueListeners) {
      try {
        const result = listener();
        if (result) result.catch(() => undefined);
      } catch {
        // A listener must never fail the queue change.
      }
    }
  }

  /** Stage a page for a later one-click reveal (I-039). Changes nothing in Foundry. */
  async queuePage(args: {
    pageUuid?: unknown;
    sceneId?: unknown;
    players?: unknown;
  }): Promise<QueueChangeView> {
    const pageUuid = assertPageUuid(args.pageUuid);
    const sceneId = assertSceneId(args.sceneId);
    const players = assertPlayers(args.players);
    const [page] = [...(await this.pagesFor([pageUuid])).values()];
    if (!page?.exists) throw new Error('That journal page does not exist in Foundry');
    const { replaced } = await this.queue.add(pageUuid, sceneId, players);
    this.notifyQueueChanged();
    const title = page.name ?? pageIdOf(pageUuid);
    const who = players
      ? ` for ${players.length === 1 ? '1 player' : `${players.length} players`}`
      : '';
    return {
      queued: true,
      pageUuid,
      note: replaced
        ? `"${title}" was already queued; its scene and players are updated${who}.`
        : `"${title}" is queued${who}. Reveal it with action "reveal-next" when the moment comes.`,
    };
  }

  async unqueuePage(args: { pageUuid?: unknown }): Promise<QueueChangeView> {
    const pageUuid = assertPageUuid(args.pageUuid);
    const removed = await this.queue.remove(pageUuid);
    if (!removed) throw new Error('That page is not in the reveal queue');
    this.notifyQueueChanged();
    return { queued: false, pageUuid, note: 'Removed from the reveal queue.' };
  }

  /**
   * Plan revealing the next queued page: the oldest entry for `sceneId` (or
   * with no scene); without `sceneId`, the oldest entry. The plan also removes
   * the entry, so undoing the reveal puts it back in the queue.
   */
  private async planRevealNext(
    sceneId: string | null,
    args: { setOwnership?: boolean; copy?: boolean; showNow?: boolean }
  ): Promise<PageRevealPlan> {
    const entries = orderedQueue(await this.queue.load());
    const next = entries.find(
      ([, e]) => sceneId === null || e.sceneId === null || e.sceneId === sceneId
    );
    if (!next) {
      throw new Error(sceneId ? 'No page is queued for this scene' : 'The reveal queue is empty');
    }
    const [entryId, entry]: [string, QueueEntry] = next;
    try {
      return await this.planRevealOrHide(entry.uuid, 'reveal', {
        setOwnership: args.setOwnership ?? true,
        ...(args.copy !== undefined ? { copy: args.copy } : {}),
        ...(args.showNow ? { showNow: true } : {}),
        ...(entry.players ? { players: entry.players } : {}),
        extraVaultOps: [{ kind: 'vault-delete', file: QUEUE_FILE, path: `entries.${entryId}` }],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${message} (the next queued page is ${entry.uuid}; remove it with action "unqueue" to go on)`
      );
    }
  }

  private async planRevealOrHide(
    pageUuid: string,
    action: 'reveal' | 'hide',
    opts: {
      setOwnership: boolean;
      copy?: boolean;
      players?: string[];
      showNow?: boolean;
      extraVaultOps: VaultOp[];
    }
  ): Promise<PageRevealPlan> {
    const { setOwnership, players, extraVaultOps } = opts;
    const showNow = opts.showNow === true;
    const worldId = await this.worldIds.current();
    const file = await this.load(worldId);
    const pageId = pageIdOf(pageUuid);
    const allowlisted = file.pages?.[pageId];
    const copies = Object.entries(file.pages ?? {}).filter(
      ([id, entry]) => id !== pageId && entry.copiedFrom === pageUuid
    );

    const pages = await this.pagesFor([pageUuid, ...copies.map(([, entry]) => entry.uuid)]);
    const page = pages.get(pageUuid) ?? missingPage(pageUuid);
    const title = page.name ?? pageId;

    if (action === 'reveal') {
      if (!page.exists) throw new Error('That journal page does not exist in Foundry');
      // A source with a live copy keeps using it: revealing it directly as well
      // would give players the same page twice.
      const liveCopy = copies.some(([, entry]) => pages.get(entry.uuid)?.exists === true);
      if (opts.copy === false && liveCopy) {
        throw new Error(
          `"${title}" already has a copy in the player journal "${HANDOUTS_JOURNAL_NAME}". ` +
            'Reveal it without copy: false to update that copy, or hide it first, then reveal ' +
            'with copy: false.'
        );
      }
      const copy = opts.copy ?? (liveCopy || (setOwnership && page.journalObservable === false));
      if (copy) {
        if (allowlisted?.copiedFrom) {
          throw new Error(
            `"${title}" is already a copy in ${HANDOUTS_JOURNAL_NAME}; reveal its source page ` +
              `(${allowlisted.copiedFrom}) to update the copy`
          );
        }
        return this.planCopyReveal(
          file,
          pageUuid,
          title,
          page,
          copies,
          pages,
          players,
          extraVaultOps,
          showNow
        );
      }
      return this.planReveal(
        pageUuid,
        pageId,
        title,
        page,
        allowlisted,
        setOwnership,
        players,
        extraVaultOps,
        showNow
      );
    }
    // Hide always drops the stale allowlist entry, even for a page deleted since it was
    // revealed; only the ownership restore (below) needs the page to still exist.
    return this.planHide(pageUuid, pageId, title, page, allowlisted, copies, pages, setOwnership);
  }

  private async planReveal(
    pageUuid: string,
    pageId: string,
    title: string,
    page: PageForPlayers,
    allowlisted: RevealedPageEntry | undefined,
    setOwnership: boolean,
    players: string[] | undefined,
    extraVaultOps: VaultOp[],
    showNow: boolean
  ): Promise<PageRevealPlan> {
    if (allowlisted && (page.observable || !setOwnership)) {
      throw new Error('That page is already revealed to players');
    }
    // Raising the page's ownership cannot help while its journal is hidden from
    // the players: Foundry 14 neither lists that journal for them nor opens its
    // pages. Raising the journal would expose every page that inherits from it,
    // so that stays the GM's call; a copy into "Handouts" is the tool's way
    // around it. (`false` only: a module without the field leaves the decision
    // to `observable`.)
    if (setOwnership && !page.observable && page.journalObservable === false) {
      throw new Error(
        `Players cannot open the journal that holds "${title}" in Foundry (its ownership is ` +
          'below Observer for every player), so raising the page alone would not reveal it. ' +
          `Reveal with copy: true to copy it into the player journal "${HANDOUTS_JOURNAL_NAME}" ` +
          '(secret blocks left out, the source unchanged), or move the page into a journal ' +
          'players can observe, or raise that journal to Observer after setting its other ' +
          'pages to None; then reveal again.'
      );
    }
    const ops: GuardedOp[] = [];
    let previousOwnership: number | undefined;
    let previousUserOwnership: Record<string, number | null> | undefined;
    if (setOwnership && !page.observable && players) {
      // Reveal to chosen players (I-039): raise each user's own level, never the default.
      const changes: Record<string, unknown> = {};
      for (const id of players) changes[`ownership.${id}`] = OBSERVER;
      const probe: GuardedOp = { kind: 'update', uuid: pageUuid, changes };
      const [snapshot] = await this.snapshot([probe]);
      previousUserOwnership = {};
      for (const id of players) {
        const before = snapshot?.values?.find(v => v.path === `ownership.${id}`);
        previousUserOwnership[id] =
          before?.present && typeof before.value === 'number' ? before.value : null;
      }
      ops.push(probe);
    } else if (setOwnership && !page.observable) {
      const probe: GuardedOp = {
        kind: 'update',
        uuid: pageUuid,
        changes: { 'ownership.default': OBSERVER },
      };
      const snapshots = await this.snapshot([probe]);
      const before = snapshots[0]?.values?.find(v => v.path === 'ownership.default');
      previousOwnership = before?.present && typeof before.value === 'number' ? before.value : 0;
      ops.push(probe);
    }
    const vaultOps: VaultOp[] = [
      ...extraVaultOps,
      {
        kind: 'vault-set',
        file: REVEALS_FILE,
        path: `pages.${pageId}`,
        value: {
          uuid: pageUuid,
          feature: HANDOUTS_FEATURE,
          at: new Date(this.now()).toISOString(),
          ...(previousOwnership !== undefined ? { previousOwnership } : {}),
          ...(players ? { players } : {}),
          ...(previousUserOwnership ? { previousUserOwnership } : {}),
        },
      },
    ];
    const plan = await this.guardedWrites.createPlan({
      feature: HANDOUTS_FEATURE,
      summary: `Reveal page "${title}" to ${audience(players)}`,
      ...(ops.length > 0 ? { ops } : {}),
      vaultOps,
      risk: 'destructive',
      ...showPlayers(showNow, pageUuid, players),
    });
    return { ...plan, pageUuid };
  }

  /** Reveal as a copy in "Handouts": update the existing copy, else create one. */
  private async planCopyReveal(
    file: RevealsFile,
    sourceUuid: string,
    title: string,
    source: PageForPlayers,
    copies: Array<[string, RevealedPageEntry]>,
    pages: Map<string, PageForPlayers>,
    players: string[] | undefined,
    extraVaultOps: VaultOp[],
    showNow: boolean
  ): Promise<PageRevealPlan> {
    const name = source.name ?? 'Handout';
    const revealed = new Set(Object.values(file.pages ?? {}).map(entry => entry.uuid));
    const content = copyContentOf(source, name, title, revealed);
    const existing = copies.find(([, entry]) => pages.get(entry.uuid)?.exists === true);
    if (existing) {
      const copyPage = pages.get(existing[1].uuid) ?? missingPage(existing[1].uuid);
      return this.planCopyUpdate(
        sourceUuid,
        title,
        existing,
        copyPage,
        content,
        players,
        extraVaultOps,
        showNow
      );
    }
    return this.planCopyCreate(
      file,
      sourceUuid,
      title,
      name,
      copies,
      content,
      players,
      extraVaultOps,
      showNow
    );
  }

  /** Revealing the source again: the copy gets its current content (one plan, no duplicate). */
  private async planCopyUpdate(
    sourceUuid: string,
    title: string,
    [copyId, entry]: [string, RevealedPageEntry],
    copyPage: PageForPlayers,
    content: CopyContent,
    players: string[] | undefined,
    extraVaultOps: VaultOp[],
    showNow: boolean
  ): Promise<PageRevealPlan> {
    const copyType = pageTypeOf(copyPage);
    if (copyType !== undefined && copyType !== content.type) {
      throw new Error(
        `The copy of "${title}" in ${HANDOUTS_JOURNAL_NAME} is a "${copyType}" page, but the ` +
          `source is a "${content.type}" page now: hide the handout, then reveal it again`
      );
    }
    const wanted = [...content.values, ...copyOwnershipValues(entry.players, players)];
    const [current] = await this.snapshot([updateOpFor(entry.uuid, wanted)]);
    const changed = wanted.filter(want => {
      const have = current?.values?.find(v => v.path === want.path) ?? {
        path: want.path,
        present: false,
      };
      return !samePathValue(want, have);
    });
    if (changed.length === 0) {
      throw new Error(
        `That page is already revealed to players: its copy in ${HANDOUTS_JOURNAL_NAME} is up to date`
      );
    }
    const copy: HandoutCopyView = {
      action: 'update',
      pageUuid: entry.uuid,
      sourceUuid,
      journalUuid: journalOf(entry.uuid),
      journalName: HANDOUTS_JOURNAL_NAME,
      journalCreated: false,
      secretsRemoved: content.secretsRemoved,
      embedsRemoved: content.embedsRemoved,
      linksUnlinked: content.linksUnlinked,
    };
    const samePlayers = JSON.stringify(entry.players ?? null) === JSON.stringify(players ?? null);
    const { players: _oldPlayers, ...rest } = entry;
    const vaultOps: VaultOp[] = [
      ...extraVaultOps,
      ...(samePlayers
        ? []
        : [
            {
              kind: 'vault-set' as const,
              file: REVEALS_FILE,
              path: `pages.${copyId}`,
              value: { ...rest, ...(players ? { players } : {}) },
            },
          ]),
    ];
    const plan = await this.guardedWrites.createPlan({
      feature: HANDOUTS_FEATURE,
      summary: `Reveal page "${title}" to ${audience(players)} again (updates its copy in ${HANDOUTS_JOURNAL_NAME})`,
      ops: [updateOpFor(entry.uuid, changed)],
      ...(vaultOps.length > 0 ? { vaultOps } : {}),
      risk: 'destructive',
      ...showPlayers(showNow, entry.uuid, players),
    });
    return { ...plan, pageUuid: sourceUuid, copy, note: copyNote(title, copy) };
  }

  /**
   * A new copy: a page in the remembered "Handouts" journal, or, on first use or
   * when that journal was deleted, a new "Handouts" journal (Observer) holding it.
   */
  private async planCopyCreate(
    file: RevealsFile,
    sourceUuid: string,
    title: string,
    name: string,
    copies: Array<[string, RevealedPageEntry]>,
    content: CopyContent,
    players: string[] | undefined,
    extraVaultOps: VaultOp[],
    showNow: boolean
  ): Promise<PageRevealPlan> {
    const remembered = file.handoutsJournal?.uuid;
    let journalExists = false;
    if (remembered) {
      const [probe] = await this.snapshot([
        { kind: 'create', documentName: 'JournalEntryPage', parentUuid: remembered, data: {} },
      ]);
      journalExists = probe?.exists === true;
    }
    const copyId = newDocumentId();
    const pageData: Record<string, unknown> = {
      _id: copyId,
      name,
      type: content.type,
      ...content.fields,
      // Chosen players (I-039): the copy is hidden from the rest of the table.
      ...(players ? { ownership: chosenOwnership(players) } : {}),
      flags: { [MODULE_ID]: { [COPIED_FROM_FLAG]: sourceUuid } },
    };
    const ops: GuardedOp[] = [];
    const vaultOps: VaultOp[] = [...extraVaultOps];
    let journalUuid: string;
    if (remembered && journalExists) {
      journalUuid = remembered;
      ops.push({
        kind: 'create',
        documentName: 'JournalEntryPage',
        parentUuid: journalUuid,
        data: pageData,
        keepId: true,
      });
    } else {
      const journalId = newDocumentId();
      journalUuid = `JournalEntry.${journalId}`;
      ops.push({
        kind: 'create',
        documentName: 'JournalEntry',
        data: {
          _id: journalId,
          name: HANDOUTS_JOURNAL_NAME,
          ownership: { default: OBSERVER },
          pages: [pageData],
        },
        keepId: true,
      });
    }
    // The undo anchor: set by every copy plan, so undoing an earlier one (which
    // may delete the whole journal it created) conflicts while this copy is in it.
    vaultOps.push({
      kind: 'vault-set',
      file: REVEALS_FILE,
      path: 'handoutsJournal',
      value: { uuid: journalUuid, lastCopy: copyId },
    });
    const copyUuid = `${journalUuid}.JournalEntryPage.${copyId}`;
    // Entries of earlier copies that are gone from Foundry (deleted by hand, or
    // with a deleted "Handouts" journal): the new copy replaces them.
    for (const [staleId] of copies) {
      vaultOps.push({ kind: 'vault-delete', file: REVEALS_FILE, path: `pages.${staleId}` });
    }
    vaultOps.push({
      kind: 'vault-set',
      file: REVEALS_FILE,
      path: `pages.${copyId}`,
      value: {
        uuid: copyUuid,
        feature: HANDOUTS_FEATURE,
        at: new Date(this.now()).toISOString(),
        copiedFrom: sourceUuid,
        ...(players ? { players } : {}),
      },
    });
    const copy: HandoutCopyView = {
      action: 'create',
      pageUuid: copyUuid,
      sourceUuid,
      journalUuid,
      journalName: HANDOUTS_JOURNAL_NAME,
      journalCreated: !(remembered && journalExists),
      secretsRemoved: content.secretsRemoved,
      embedsRemoved: content.embedsRemoved,
      linksUnlinked: content.linksUnlinked,
    };
    const warning = copy.journalCreated ? await this.sameNameWarning() : undefined;
    const plan = await this.guardedWrites.createPlan({
      feature: HANDOUTS_FEATURE,
      summary: `Reveal page "${title}" to ${audience(players)} (copied into ${HANDOUTS_JOURNAL_NAME})`,
      ops,
      vaultOps,
      risk: 'destructive',
      ...showPlayers(showNow, copyUuid, players),
    });
    return { ...plan, pageUuid: sourceUuid, copy, note: copyNote(title, copy, warning) };
  }

  private async planHide(
    pageUuid: string,
    pageId: string,
    title: string,
    page: PageForPlayers,
    allowlisted: RevealedPageEntry | undefined,
    copies: Array<[string, RevealedPageEntry]>,
    pages: Map<string, PageForPlayers>,
    setOwnership: boolean
  ): Promise<PageRevealPlan> {
    if (!allowlisted && copies.length === 0)
      throw new Error('That page is not revealed to players');
    const ops: GuardedOp[] = [];
    const vaultOps: VaultOp[] = [];
    const copiesDeleted: string[] = [];
    // A copy goes with its entry; one already gone from Foundry only loses the entry.
    const dropCopy = (entryId: string, entry: RevealedPageEntry): void => {
      if (pages.get(entry.uuid)?.exists === true) {
        ops.push({ kind: 'delete', uuid: entry.uuid });
        copiesDeleted.push(entry.uuid);
      }
      vaultOps.push({ kind: 'vault-delete', file: REVEALS_FILE, path: `pages.${entryId}` });
    };
    if (allowlisted?.copiedFrom) {
      dropCopy(pageId, allowlisted);
    } else if (allowlisted) {
      if (setOwnership && page.exists && allowlisted.previousOwnership !== undefined) {
        ops.push({
          kind: 'update',
          uuid: pageUuid,
          changes: { 'ownership.default': allowlisted.previousOwnership },
        });
      }
      const users = allowlisted.previousUserOwnership;
      if (setOwnership && page.exists && users && Object.keys(users).length > 0) {
        const changes: Record<string, unknown> = {};
        const unset: string[] = [];
        for (const [id, level] of Object.entries(users)) {
          if (level === null) unset.push(`ownership.${id}`);
          else changes[`ownership.${id}`] = level;
        }
        ops.push({
          kind: 'update',
          uuid: pageUuid,
          changes,
          ...(unset.length > 0 ? { unset } : {}),
        });
      }
      vaultOps.push({ kind: 'vault-delete', file: REVEALS_FILE, path: `pages.${pageId}` });
    }
    for (const [entryId, entry] of copies) dropCopy(entryId, entry);

    const which = allowlisted?.copiedFrom ? 'the' : 'its';
    const plan = await this.guardedWrites.createPlan({
      feature: HANDOUTS_FEATURE,
      summary:
        copiesDeleted.length > 0
          ? `Hide page "${title}" from players (deletes ${which} copy in ${HANDOUTS_JOURNAL_NAME})`
          : `Hide page "${title}" from players`,
      ...(ops.length > 0 ? { ops } : {}),
      vaultOps,
    });
    if (copiesDeleted.length === 0) return { ...plan, pageUuid };
    return {
      ...plan,
      pageUuid,
      copiesDeleted,
      note:
        `Deletes the copy in the player journal "${HANDOUTS_JOURNAL_NAME}"; the journal stays ` +
        'and the source page is not changed.',
    };
  }

  // -------------------------------------------------------------------------

  /**
   * A warning when the world already has a journal called "Handouts" (imported
   * adventures often ship a GM-only one): the new one is open to every player.
   * A failed lookup gives no warning; it never blocks the reveal.
   */
  private async sameNameWarning(): Promise<string | undefined> {
    try {
      const result = (await this.foundry.query('foundry-mcp-bridge.listJournals', {})) as unknown;
      const journals = Array.isArray(result) ? (result as Array<{ name?: unknown }>) : [];
      const target = HANDOUTS_JOURNAL_NAME.toLowerCase();
      const same = journals.filter(
        j => typeof j?.name === 'string' && j.name.trim().toLowerCase() === target
      ).length;
      if (same === 0) return undefined;
      return (
        `The world already has ${same === 1 ? 'a journal' : `${same} journals`} called ` +
        `"${HANDOUTS_JOURNAL_NAME}"; the new one is the player journal (every player can read ` +
        'every page in it), so keep GM prep out of it.'
      );
    } catch {
      return undefined;
    }
  }

  private async load(worldId: string): Promise<RevealsFile> {
    const stored = await this.store.read<RevealsFile>(worldId, 'gm', REVEALS_FILE);
    return stored?.data ?? {};
  }

  private async snapshot(ops: GuardedOp[]): Promise<OpSnapshot[]> {
    const result = unwrap<OpSnapshot[]>(
      await this.foundry.query('foundry-mcp-bridge.snapshotGuardedOps', { ops }),
      'Snapshot refused'
    );
    return Array.isArray(result) ? result : [];
  }

  private async pagesFor(uuids: string[]): Promise<Map<string, PageForPlayers>> {
    const result = unwrap<{ pages?: PageForPlayers[] }>(
      await this.foundry.query('foundry-mcp-bridge.getPagesForPlayers', {
        uuids: [...new Set(uuids)],
      }),
      'Page lookup refused'
    );
    const map = new Map<string, PageForPlayers>();
    for (const page of result.pages ?? []) map.set(page.uuid, page);
    return map;
  }
}

/**
 * The control method `record_handout_seen` (`{pageId, userId, name}` to
 * `{recorded}`): the dashboard reports that a player opened a handout.
 */
export async function handleRecordHandoutSeen(
  handouts: Pick<HandoutsService, 'recordSeen'>,
  params: unknown
): Promise<{ recorded: boolean }> {
  const p =
    params !== null && typeof params === 'object' ? (params as Record<string, unknown>) : {};
  const pageId = typeof p.pageId === 'string' ? p.pageId : '';
  const userId = typeof p.userId === 'string' ? p.userId : '';
  const name = typeof p.name === 'string' ? p.name : '';
  if (!pageId || !userId) throw new Error('record_handout_seen needs pageId and userId');
  return handouts.recordSeen(pageId, userId, name);
}
