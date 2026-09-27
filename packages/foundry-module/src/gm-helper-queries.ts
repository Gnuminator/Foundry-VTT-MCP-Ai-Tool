/**
 * GM-to-GM helper queries: the only entries this module registers in Foundry's
 * `CONFIG.queries`.
 *
 * Foundry relays a query from any user holding "Query Users" (Player role by
 * default) to any other user, with no allowlist of query names. So every helper
 * here checks the sender Foundry passes to the handler (14.352+,
 * foundryvtt#13418) and rejects anything that is not a known GM. A missing
 * sender is a rejection: the argument is not in the official API docs yet, and
 * on v13 it does not exist (the helpers are then not registered at all).
 *
 * Use: the bridge client (on the Orange Pi, a headless Assistant GM) asks the
 * human GM's own Foundry client to do something on their screen, such as
 * opening a journal page, without storing anything secret in world data.
 */
import { MODULE_ID } from './constants.js';
import { coreSupportsQuerySender } from './systems/core.js';

/** Prefix of the helper query names (distinct from the bridge methods). */
export const GM_HELPER_PREFIX = `${MODULE_ID}.gm.`;

export const GM_HELPER_QUERIES = {
  openDocument: `${GM_HELPER_PREFIX}openDocument`,
} as const;

/** Query timeout for helper calls to another client. */
const HELPER_TIMEOUT_MS = 10_000;

/**
 * Document UUIDs we accept: world documents (`Actor.<id>`, embedded
 * `JournalEntry.<id>.JournalEntryPage.<id>`) and compendium documents
 * (`Compendium.<package>.<pack>.<Type>.<id>`).
 */
const UUID_PATTERN =
  /^(?:Compendium\.[\w-]+\.[\w-]+\.)?[A-Z][A-Za-z]+\.[A-Za-z0-9]{16}(?:\.[A-Z][A-Za-z]+\.[A-Za-z0-9]{16})*$/;

/**
 * The GM who sent a helper query, or an error. Accepts the sender as a User
 * document (identity-checked against `game.users`) or as a user id.
 */
export function requireGmSender(context: FoundryQueryContext | undefined): User {
  const sender: unknown = context?.user;
  if (sender === undefined || sender === null) {
    throw new Error('Rejected: the query carries no sender (Foundry 14.352+ is required)');
  }
  const senderId = typeof sender === 'string' ? sender : (sender as { id?: unknown }).id;
  const known = typeof senderId === 'string' ? game.users.get(senderId) : undefined;
  if (!known || (typeof sender !== 'string' && known !== sender)) {
    throw new Error('Rejected: the sender is not a user of this world');
  }
  if (!known.isGM) {
    throw new Error('Rejected: helper queries are GM-only');
  }
  return known;
}

/** Validate a `{uuid}` payload. */
export function parseUuidPayload(data: unknown): string {
  const uuid = (data as { uuid?: unknown } | null | undefined)?.uuid;
  if (typeof uuid !== 'string' || uuid.length > 300 || !UUID_PATTERN.test(uuid)) {
    throw new Error('Invalid payload: expected {uuid} with a Foundry document UUID');
  }
  return uuid;
}

/** Open a document on this client: sheet, journal page, or scene view. */
export async function openDocumentLocally(
  uuid: string
): Promise<{ opened: true; documentName: string; name: string | null }> {
  const doc = await fromUuid(uuid);
  if (!doc) throw new Error(`Document not found: ${uuid}`);
  const named = doc as FoundryDocument & { name?: string };
  if (doc.documentName === 'JournalEntryPage' && doc.parent) {
    doc.parent.sheet?.render(true, { pageId: doc.id });
  } else if (doc.documentName === 'Scene') {
    await (doc as Scene).view();
  } else if (doc.sheet) {
    doc.sheet.render(true);
  } else {
    throw new Error(`${doc.documentName} documents have no sheet to open`);
  }
  return { opened: true, documentName: doc.documentName, name: named.name ?? null };
}

/** `CONFIG.queries` handler: open a document on this (GM) client for a GM sender. */
async function openDocumentQuery(
  data: unknown,
  context?: FoundryQueryContext
): Promise<{ opened: true; documentName: string; name: string | null }> {
  requireGmSender(context);
  if (!game.user.isGM) throw new Error('Rejected: this client is not a GM');
  return openDocumentLocally(parseUuidPayload(data));
}

/**
 * Register the helper queries. Only on cores that pass the sender (14.352+);
 * on older cores nothing is registered, so nothing can be relayed.
 */
export function registerGmHelperQueries(): boolean {
  if (!coreSupportsQuerySender()) return false;
  CONFIG.queries[GM_HELPER_QUERIES.openDocument] = openDocumentQuery;
  return true;
}

export function unregisterGmHelperQueries(): void {
  for (const name of Object.values(GM_HELPER_QUERIES)) {
    delete CONFIG.queries[name];
  }
}

/**
 * Pick the GM client that should open a document for "the GM": the given
 * user, else the one other active GM (a full GM before an Assistant), else this
 * client when it is the only GM.
 */
export function resolveGmTarget(userId?: string): User {
  if (userId) {
    const user = game.users.get(userId);
    if (!user) throw new Error(`No user with id ${userId}`);
    if (!user.isGM) throw new Error(`${user.name} is not a GM`);
    if (!user.active) throw new Error(`${user.name} is not logged in`);
    return user;
  }
  const others = game.users.filter(u => u.isGM && u.active && u.id !== game.user.id);
  if (others.length === 0) {
    if (game.user.isGM) return game.user;
    throw new Error('No GM is logged in');
  }
  const fullGms = others.filter(u => u.role >= CONST.USER_ROLES.GAMEMASTER);
  const pool = fullGms.length > 0 ? fullGms : others;
  if (pool.length > 1) {
    throw new Error(
      `Several GMs are logged in (${pool.map(u => `${u.name} [${u.id}]`).join(', ')}); pass userId`
    );
  }
  return pool[0];
}

/**
 * Bridge handler body: open `uuid` on the chosen GM's screen. Runs on the
 * bridge client; uses a helper query when the target is another client.
 */
export async function openDocumentForGm(data: {
  uuid?: unknown;
  userId?: unknown;
}): Promise<{ opened: true; documentName: string; name: string | null; userId: string }> {
  const uuid = parseUuidPayload(data);
  const userId = typeof data.userId === 'string' && data.userId ? data.userId : undefined;
  const target = resolveGmTarget(userId);
  if (target.id === game.user.id) {
    return { ...(await openDocumentLocally(uuid)), userId: target.id };
  }
  if (!coreSupportsQuerySender()) {
    throw new Error('Opening a document on another GM client needs Foundry 14.352 or newer');
  }
  const result = (await target.query(
    GM_HELPER_QUERIES.openDocument,
    { uuid },
    { timeout: HELPER_TIMEOUT_MS }
  )) as { opened: true; documentName: string; name: string | null };
  return { ...result, userId: target.id };
}
