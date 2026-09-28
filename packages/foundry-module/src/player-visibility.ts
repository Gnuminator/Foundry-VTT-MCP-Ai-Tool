/**
 * Player-visibility domain (Curse of Strahd plan, feature 2 "spoiler-safe
 * /player", M2). Computed on the GM client, where the full (unfiltered) world
 * state lives; everything here is a read.
 *
 * The wire contract is owned by `shared/src/player-view.ts`. Its types are
 * imported (type-only imports vanish from the build); its runtime values
 * (`PLAYER_VIEW_QUERIES`, `UNKNOWN_CREATURE`, `UNKNOWN_SCENE`) are mirrored
 * here, because the browser cannot resolve `@gnuminator/shared`.
 * `player-visibility.contract.test.ts` pins the copies to the shared ones.
 */
import type {
  EventVisibility,
  PageForPlayers,
  PlayerVisibility,
  PlayerVisibleToken,
} from '@gnuminator/shared';

/** Query names (mirror of the shared `PLAYER_VIEW_QUERIES`). */
export const PLAYER_VIEW_QUERIES = {
  visibility: 'getPlayerVisibility',
  pages: 'getPagesForPlayers',
} as const;

/** Player-facing name for a creature players cannot name (mirror of the shared constant). */
export const UNKNOWN_CREATURE = 'Unknown creature';
/** Player-facing label for a scene without a navigation name (mirror of the shared constant). */
export const UNKNOWN_SCENE = 'Current scene';

declare global {
  /**
   * Synchronous UUID resolution (verified: `client/utils/helpers.mjs:188`,
   * `fromUuidSync`) for world and embedded documents. Not yet declared in
   * `types/foundry-v14.d.ts` (only the async `fromUuid` is there); this
   * module is the only current caller, so it is declared locally.
   */
  function fromUuidSync(uuid: string, options?: Record<string, unknown>): FoundryDocument | null;
}

// ---------------------------------------------------------------------------
// Local, duck-typed shapes for the parts of Token/Actor not (yet) in the
// module's ambient ` types/foundry-v14.d.ts` (which only covers world-level
// actors and leaves `Scene#tokens` as `FoundryCollection<any>`).
// ---------------------------------------------------------------------------

interface TokenLike {
  readonly id?: string | null;
  readonly name?: string | null;
  readonly hidden?: boolean;
  readonly displayName?: number;
  readonly actorId?: string | null;
  readonly actor?: unknown;
}

interface ActorLike {
  readonly id?: string | null;
  readonly name?: string | null;
  readonly hasPlayerOwner?: boolean;
  /**
   * Set on a synthetic (unlinked-token) actor: real Foundry's `Actor#token`
   * (verified: `client/documents/actor.mjs:177`, `Actor#isToken` at :138)
   * returns the parent TokenDocument when the actor is a token's delta
   * actor, else null. The module's ambient `Actor` type only covers
   * world-level actors, so this is narrowed locally.
   */
  readonly token?: TokenLike | null;
}

/** `CONST.TOKEN_DISPLAY_MODES` (verified: `common/constants.mjs`), not yet in the ambient `FoundryConst`. */
interface TokenDisplayModes {
  readonly NONE: number;
  readonly CONTROL: number;
  readonly OWNER_HOVER: number;
  readonly HOVER: number;
  readonly OWNER: number;
  readonly ALWAYS: number;
}

const DEFAULT_DISPLAY_MODES: TokenDisplayModes = {
  NONE: 0,
  CONTROL: 10,
  OWNER_HOVER: 20,
  HOVER: 30,
  OWNER: 40,
  ALWAYS: 50,
};

// ---------------------------------------------------------------------------
// Small, safe narrowing helpers (never throw, never touch `any`)
// ---------------------------------------------------------------------------

function isTokenLike(value: unknown): value is TokenLike {
  return value !== null && typeof value === 'object';
}

function asActorLike(value: unknown): ActorLike | null {
  return value !== null && typeof value === 'object' ? (value as ActorLike) : null;
}

/** `collection.contents` (Foundry `Collection#contents`) read defensively, without touching `any`. */
function contentsOf(collection: { contents?: unknown } | null | undefined): unknown[] {
  return Array.isArray(collection?.contents) ? (collection.contents as unknown[]) : [];
}

function displayModes(): TokenDisplayModes {
  const fromConst = (CONST as unknown as { TOKEN_DISPLAY_MODES?: Partial<TokenDisplayModes> })
    .TOKEN_DISPLAY_MODES;
  return typeof fromConst?.HOVER === 'number' && typeof fromConst.ALWAYS === 'number'
    ? (fromConst as TokenDisplayModes)
    : DEFAULT_DISPLAY_MODES;
}

/** HOVER and ALWAYS are the only display modes that show a name to a non-owner (verified: `client/canvas/placeables/token.mjs` `_canViewMode`). */
function nameVisibleToNonOwners(displayName: number): boolean {
  const modes = displayModes();
  return displayName === modes.HOVER || displayName === modes.ALWAYS;
}

/** A token's player-facing name: owned by a player, or its display mode reveals it; else `UNKNOWN_CREATURE`. */
function tokenNameForPlayers(token: TokenLike, ownedByPlayer: boolean): string {
  const displayName =
    typeof token.displayName === 'number' ? token.displayName : displayModes().NONE;
  const visible = ownedByPlayer || nameVisibleToNonOwners(displayName);
  return visible && typeof token.name === 'string' ? token.name : UNKNOWN_CREATURE;
}

/** The active scene's player-facing name: `navName` when set, else the generic label (never the true scene name). */
export function playerFacingSceneName(scene: unknown): string {
  const s = scene !== null && typeof scene === 'object' ? (scene as { navName?: unknown }) : null;
  return typeof s?.navName === 'string' && s.navName.length > 0 ? s.navName : UNKNOWN_SCENE;
}

// ---------------------------------------------------------------------------
// getPlayerVisibility
// ---------------------------------------------------------------------------

function toPlayerVisibleToken(token: TokenLike): PlayerVisibleToken {
  const actor = asActorLike(token.actor);
  const ownedByPlayer = actor?.hasPlayerOwner === true;
  return {
    tokenId: token.id ?? '',
    actorId: token.actorId ?? actor?.id ?? null,
    name: tokenNameForPlayers(token, ownedByPlayer),
    pc: ownedByPlayer,
  };
}

/**
 * What the players can see right now, computed on the GM client:
 * player-owned actor ids, the active scene as players know it, and the
 * non-hidden tokens on it named the way a player sees them.
 */
export function computePlayerVisibility(): PlayerVisibility {
  const pcActorIds = game.actors
    .filter((actor): boolean => actor.hasPlayerOwner)
    .map((actor): string => actor.id);

  const activeScene = game.scenes.current ?? null;
  const scene = activeScene
    ? { id: activeScene.id, name: playerFacingSceneName(activeScene) }
    : null;

  const tokens: PlayerVisibleToken[] = activeScene
    ? contentsOf(activeScene.tokens)
        .filter((t): t is TokenLike => isTokenLike(t) && t.hidden !== true)
        .map((t): PlayerVisibleToken => toPlayerVisibleToken(t))
    : [];

  return { schema: 1, computedAt: Date.now(), pcActorIds, scene, tokens };
}

// ---------------------------------------------------------------------------
// eventVisibilityFor
// ---------------------------------------------------------------------------

/**
 * The subject's non-hidden token on the active scene: for a synthetic
 * (unlinked-token) actor, its own token (`actor.token`); for a world actor,
 * any scene token whose `actorId` matches, linked or not.
 */
function findVisibleToken(actor: ActorLike): TokenLike | null {
  if (actor.token) return actor.token.hidden === true ? null : actor.token;
  // Defensive: `eventVisibilityFor` runs from hooks that can fire before the
  // world (and `game.scenes`) is fully set up.
  const scene = game.scenes?.current;
  const id = typeof actor.id === 'string' ? actor.id : null;
  if (!scene || id === null) return null;
  const match = contentsOf(scene.tokens).find(
    (t): t is TokenLike => isTokenLike(t) && t.actorId === id && t.hidden !== true
  );
  return match ?? null;
}

/**
 * The visibility to stamp on a session event for its subject actor: `pc` when
 * a non-GM user owns it, else `npc`; whether it has a non-hidden token on the
 * active scene; and the name players know it by (PC: its own name; NPC with a
 * visible token: that token's player-facing name; else null).
 */
export function eventVisibilityFor(actor: unknown): EventVisibility {
  const a = asActorLike(actor);
  if (!a) return { subject: null, tokenVisible: false, playerName: null };

  const isPc = a.hasPlayerOwner === true;
  const visibleToken = findVisibleToken(a);
  const tokenVisible = visibleToken !== null;

  let playerName: string | null = null;
  if (isPc) {
    playerName = typeof a.name === 'string' ? a.name : null;
  } else if (visibleToken) {
    const name = tokenNameForPlayers(visibleToken, false);
    playerName = name === UNKNOWN_CREATURE ? null : name;
  }

  return { subject: isPc ? 'pc' : 'npc', tokenVisible, playerName };
}

// ---------------------------------------------------------------------------
// getPagesForPlayers
// ---------------------------------------------------------------------------

const PAGE_UUID = /^JournalEntry\.[A-Za-z0-9]+\.JournalEntryPage\.[A-Za-z0-9]+$/;
const MAX_PAGES = 100;

function isJournalEntryPage(doc: FoundryDocument | null): doc is JournalEntryPage {
  return doc !== null && doc.documentName === 'JournalEntryPage';
}

function resolveJournalPage(uuid: string): JournalEntryPage | null {
  try {
    const doc = fromUuidSync(uuid);
    return isJournalEntryPage(doc) ? doc : null;
  } catch {
    return null;
  }
}

/** A document's `testUserPermission`, read defensively (the page's parent journal is untyped here). */
function canObserve(doc: unknown, user: User): boolean {
  const d = doc as { testUserPermission?: (user: User, level: string) => boolean } | null;
  return typeof d?.testUserPermission === 'function' && d.testUserPermission(user, 'OBSERVER');
}

/**
 * Whether some non-GM user can observe the page's journal, and whether some
 * non-GM user can open the page itself. Foundry 14 lists a journal only for
 * users who can observe it (`JournalEntry#visible`, verified:
 * `client/documents/journal-entry.mjs:29`) and treats a page of a journal the
 * user cannot see as invisible (`ClientDocument#visible`,
 * `client/documents/abstract/client-document.mjs:240`); even "Show Players"
 * skips such a journal (`Journal._showEntry`). So page ownership alone does
 * not let a player open it (found live in M2).
 */
function playerAccess(page: JournalEntryPage): { journal: boolean; page: boolean } {
  const journal = (page as unknown as { parent?: unknown }).parent ?? null;
  const players = game.users.filter((user): boolean => !user.isGM);
  return {
    journal: players.some((user): boolean => canObserve(journal, user)),
    page: players.some(
      (user): boolean => canObserve(journal, user) && page.testUserPermission(user, 'OBSERVER')
    ),
  };
}

function resolvePageForPlayers(uuid: string): PageForPlayers {
  const page = resolveJournalPage(uuid);
  if (!page) {
    return {
      uuid,
      exists: false,
      name: null,
      observable: false,
      journalObservable: false,
      html: null,
    };
  }
  const html =
    page.type === 'text' && typeof page.text.content === 'string' ? page.text.content : null;
  const access = playerAccess(page);
  return {
    uuid,
    exists: true,
    name: typeof page.name === 'string' ? page.name : null,
    observable: access.page,
    journalObservable: access.journal,
    html,
  };
}

/**
 * Resolve a batch of JournalEntryPage uuids for the dashboard's handout
 * picker/reveal flow. Invalid entries (not a string, or not shaped like
 * `JournalEntry.<id>.JournalEntryPage.<id>`) are dropped; the list is capped
 * at 100. GM-side data only: the caller sanitizes `html` before any player
 * sees it.
 */
export function pagesForPlayers(uuids: unknown): { pages: PageForPlayers[] } {
  const valid = Array.isArray(uuids)
    ? uuids.filter((u): u is string => typeof u === 'string' && PAGE_UUID.test(u))
    : [];
  return {
    pages: valid.slice(0, MAX_PAGES).map((uuid): PageForPlayers => resolvePageForPlayers(uuid)),
  };
}
