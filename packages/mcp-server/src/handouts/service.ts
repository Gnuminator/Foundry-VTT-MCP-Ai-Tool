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
 * `playerHandouts()` returns raw GM HTML: it is consumed only by the dashboard
 * server, which sanitizes it before any player sees it. Nothing here ever
 * copies page content into a plan summary or a log line (a page title is
 * fine).
 */
import type { GuardedOp, OpSnapshot, PageForPlayers } from '@gnuminator/shared';

import type { FoundryClient } from '../foundry-client.js';
import type { GuardedWriteService, PlanView, VaultOp } from '../guarded-write/service.js';
import { REVEALS_FILE } from '../tarokka/service.js';
import type { VaultStore } from '../vault/store.js';
import type { WorldIdResolver } from '../vault/world-id.js';

export const HANDOUTS_FEATURE = 'handouts';
/** Foundry's OBSERVER ownership level: players can read the page. */
const OBSERVER = 2;
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
}

interface RevealsFile {
  pages?: Record<string, RevealedPageEntry>;
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
}

/** One row of `get-player-handouts`: GM data, sanitized by the dashboard server. */
export interface PlayerHandout {
  id: string;
  uuid: string;
  title: string;
  html: string;
  revealedAt: string;
}

export interface PlayerHandoutsView {
  handouts: PlayerHandout[];
  /** Every allowlisted uuid, for the dashboard sanitizer's link filtering. */
  revealedUuids: string[];
}

export interface HandoutsServiceOptions {
  guardedWrites: Pick<GuardedWriteService, 'createPlan'>;
  store: VaultStore;
  worldIds: Pick<WorldIdResolver, 'current'>;
  foundryClient: Pick<FoundryClient, 'query'>;
  now?: () => number;
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

function assertPageUuid(value: unknown): string {
  if (typeof value !== 'string' || !PAGE_UUID.test(value)) {
    throw new Error(
      'pageUuid must be a journal page uuid: JournalEntry.<id>.JournalEntryPage.<id>'
    );
  }
  return value;
}

function assertAction(value: unknown): 'reveal' | 'hide' {
  if (value !== 'reveal' && value !== 'hide') {
    throw new Error('action must be "reveal" or "hide"');
  }
  return value;
}

export class HandoutsService {
  private readonly guardedWrites: HandoutsServiceOptions['guardedWrites'];
  private readonly store: VaultStore;
  private readonly worldIds: HandoutsServiceOptions['worldIds'];
  private readonly foundry: HandoutsServiceOptions['foundryClient'];
  private readonly now: () => number;

  constructor(options: HandoutsServiceOptions) {
    this.guardedWrites = options.guardedWrites;
    this.store = options.store;
    this.worldIds = options.worldIds;
    this.foundry = options.foundryClient;
    this.now = options.now ?? ((): number => Date.now());
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
    const pages = await this.pagesFor(entries.map(([, entry]) => entry.uuid));
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
      };
    });
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
      });
    }
    return { handouts, revealedUuids };
  }

  // -------------------------------------------------------------------------
  // Plans
  // -------------------------------------------------------------------------

  /**
   * Plan revealing a page to players (allowlist + optionally raise its
   * ownership to Observer) or hiding one (remove from the allowlist +
   * optionally restore its previous ownership).
   */
  async planPageReveal(args: {
    pageUuid: string;
    action: string;
    setOwnership?: boolean;
  }): Promise<PlanView & { pageUuid: string }> {
    const pageUuid = assertPageUuid(args.pageUuid);
    const action = assertAction(args.action);
    const setOwnership = args.setOwnership ?? true;
    const worldId = await this.worldIds.current();
    const file = await this.load(worldId);
    const pageId = pageIdOf(pageUuid);
    const allowlisted = file.pages?.[pageId];

    const pages = await this.pagesFor([pageUuid]);
    const page: PageForPlayers = pages.get(pageUuid) ?? {
      uuid: pageUuid,
      exists: false,
      name: null,
      observable: false,
      journalObservable: false,
      html: null,
    };
    const title = page.name ?? pageId;

    if (action === 'reveal') {
      if (!page.exists) throw new Error('That journal page does not exist in Foundry');
      return this.planReveal(pageUuid, pageId, title, page, allowlisted, setOwnership);
    }
    // Hide always drops the stale allowlist entry, even for a page deleted since it was
    // revealed; only the ownership restore (below) needs the page to still exist.
    return this.planHide(pageUuid, pageId, title, page, allowlisted, setOwnership);
  }

  private async planReveal(
    pageUuid: string,
    pageId: string,
    title: string,
    page: PageForPlayers,
    allowlisted: RevealedPageEntry | undefined,
    setOwnership: boolean
  ): Promise<PlanView & { pageUuid: string }> {
    if (allowlisted && (page.observable || !setOwnership)) {
      throw new Error('That page is already revealed to players');
    }
    // Raising the page's ownership cannot help while its journal is hidden from
    // the players: Foundry 14 neither lists that journal for them nor opens its
    // pages. Raising the journal would expose every page that inherits from it,
    // so that stays the GM's call. (`false` only: a module without the field
    // leaves the decision to `observable`.)
    if (setOwnership && !page.observable && page.journalObservable === false) {
      throw new Error(
        `Players cannot open the journal that holds "${title}" in Foundry (its ownership is ` +
          'below Observer for every player), so raising the page alone would not reveal it. ' +
          'Move or copy the page into a journal players can observe, or raise that journal to ' +
          'Observer after setting its other pages to None; then reveal again.'
      );
    }
    const ops: GuardedOp[] = [];
    let previousOwnership: number | undefined;
    if (setOwnership && !page.observable) {
      const probe: GuardedOp = {
        kind: 'update',
        uuid: pageUuid,
        changes: { 'ownership.default': OBSERVER },
      };
      const snapshots = unwrap<OpSnapshot[]>(
        await this.foundry.query('foundry-mcp-bridge.snapshotGuardedOps', { ops: [probe] }),
        'Snapshot refused'
      );
      const before = snapshots[0]?.values?.find(v => v.path === 'ownership.default');
      previousOwnership = before?.present && typeof before.value === 'number' ? before.value : 0;
      ops.push(probe);
    }
    const vaultOps: VaultOp[] = [
      {
        kind: 'vault-set',
        file: REVEALS_FILE,
        path: `pages.${pageId}`,
        value: {
          uuid: pageUuid,
          feature: HANDOUTS_FEATURE,
          at: new Date(this.now()).toISOString(),
          ...(previousOwnership !== undefined ? { previousOwnership } : {}),
        },
      },
    ];
    const plan = await this.guardedWrites.createPlan({
      feature: HANDOUTS_FEATURE,
      summary: `Reveal page "${title}" to players`,
      ...(ops.length > 0 ? { ops } : {}),
      vaultOps,
      risk: 'destructive',
    });
    return { ...plan, pageUuid };
  }

  private async planHide(
    pageUuid: string,
    pageId: string,
    title: string,
    page: PageForPlayers,
    allowlisted: RevealedPageEntry | undefined,
    setOwnership: boolean
  ): Promise<PlanView & { pageUuid: string }> {
    if (!allowlisted) throw new Error('That page is not revealed to players');
    const ops: GuardedOp[] = [];
    if (setOwnership && page.exists && allowlisted.previousOwnership !== undefined) {
      ops.push({
        kind: 'update',
        uuid: pageUuid,
        changes: { 'ownership.default': allowlisted.previousOwnership },
      });
    }
    const vaultOps: VaultOp[] = [
      { kind: 'vault-delete', file: REVEALS_FILE, path: `pages.${pageId}` },
    ];
    const plan = await this.guardedWrites.createPlan({
      feature: HANDOUTS_FEATURE,
      summary: `Hide page "${title}" from players`,
      ...(ops.length > 0 ? { ops } : {}),
      vaultOps,
    });
    return { ...plan, pageUuid };
  }

  // -------------------------------------------------------------------------

  private async load(worldId: string): Promise<RevealsFile> {
    const stored = await this.store.read<RevealsFile>(worldId, 'gm', REVEALS_FILE);
    return stored?.data ?? {};
  }

  private async pagesFor(uuids: string[]): Promise<Map<string, PageForPlayers>> {
    const result = unwrap<{ pages?: PageForPlayers[] }>(
      await this.foundry.query('foundry-mcp-bridge.getPagesForPlayers', { uuids }),
      'Page lookup refused'
    );
    const map = new Map<string, PageForPlayers>();
    for (const page of result.pages ?? []) map.set(page.uuid, page);
    return map;
  }
}
