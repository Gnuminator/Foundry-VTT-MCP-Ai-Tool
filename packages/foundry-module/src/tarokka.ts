/**
 * Tarokka integration, module side (plan feature 1, M1). Read-only: this file
 * never writes world data. The reading is stored by the backend in its vault
 * through the guarded plan/apply flow.
 *
 * Provider: the `tarokka-reading` module (1.x). It keeps the dealt reading in
 * client settings of the dealing GM's browser (`secret`: `{id, cards[5],
 * stages[5]}`, `plan`: `[{cardId, note}] x5`) and optional names in the world
 * setting `cardOverrides`. Those keys are internal (no API), so the provider
 * only runs on 1.x. Positions, in order: tome, symbol, sword, ally, enemy.
 *
 * - `readTarokkaReadingLocal` reads it on this client.
 * - A GM-to-GM helper query lets the bridge client (for example a headless
 *   Assistant GM) fetch it from the dealing GM's client.
 * - On a new deal the dealing GM is asked whether to offer the reading to the
 *   AI Tool; an offer is kept in memory on every active GM client (the bridge
 *   client among them) until the backend imports it with
 *   `plan-tarokka-import`. Nothing is saved without the GM confirming that
 *   plan.
 *
 * Nothing here contains adventure text; names come from the provider module's
 * own localization or the GM's overrides.
 */
import { isFeatureEnabled } from './guarded-features.js';
import { trackUsage } from './usage-recorder.js';

export const TAROKKA_FEATURE_ID = 'tarokka';
export const TAROKKA_READING_MODULE = 'tarokka-reading';

/** Our position names, in the provider's order (tome, symbol, sword, ally, enemy). */
export const TAROKKA_POSITIONS = [
  'tome',
  'holySymbol',
  'sunsword',
  'ally',
  'strahdLocation',
] as const;
export type TarokkaPosition = (typeof TAROKKA_POSITIONS)[number];

const CARD_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const READING_ID = /^[A-Za-z0-9_-]{1,64}$/;
const STAGES = ['hidden', 'placed', 'revealed'] as const;
const MAX_NOTE = 2000;
const MAX_NAME = 120;

export interface TarokkaSlot {
  position: TarokkaPosition;
  cardId: string | null;
  cardName: string | null;
  gmNote: string | null;
  stage: (typeof STAGES)[number];
}

export interface ProviderReading {
  source: 'tarokka-reading';
  providerVersion: string;
  readingId: string;
  /** All five cards dealt. */
  dealt: boolean;
  /** All five cards revealed at the table. */
  complete: boolean;
  slots: TarokkaSlot[];
  capturedAt: string;
}

export interface TarokkaReadingResult {
  available: boolean;
  reason?: string;
  /** `local`, `offer` (offered by a GM client) or `user:<id>`. */
  from?: string;
  reading?: ProviderReading;
}

/** Whether `tarokka-reading` 1.x is installed and active here. */
export function tarokkaReadingProvider(): {
  active: boolean;
  version: string | null;
  reason?: string;
} {
  const mod = game.modules.get(TAROKKA_READING_MODULE) as
    | (FoundryModule & { version?: string })
    | undefined;
  if (!mod) return { active: false, version: null, reason: 'tarokka-reading is not installed' };
  const version = typeof mod.version === 'string' ? mod.version : null;
  if (!mod.active) return { active: false, version, reason: 'tarokka-reading is not active' };
  if (!version || !/^1\./.test(version)) {
    return {
      active: false,
      version,
      reason: `tarokka-reading ${String(version)} is not supported (1.x only; it has no API)`,
    };
  }
  return { active: true, version };
}

function readSetting(key: string): unknown {
  try {
    return game.settings.get(TAROKKA_READING_MODULE, key);
  } catch {
    return undefined;
  }
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function cardIdOf(value: unknown): string | null {
  const id = typeof value === 'string' ? value : (value as { id?: unknown } | null)?.id;
  return typeof id === 'string' && id.length <= 40 && CARD_ID.test(id) ? id : null;
}

/** Display name: the GM's override in tarokka-reading, else its localization. */
function cardNameOf(cardId: string | null, overrides: unknown): string | null {
  if (!cardId) return null;
  const override = (overrides as Record<string, { name?: unknown }> | null | undefined)?.[cardId];
  const custom = text(override?.name, MAX_NAME);
  if (custom) return custom;
  const key = `TAROKKA.Cards.${cardId}`;
  try {
    if (game.i18n.has(key)) return text(game.i18n.localize(key), MAX_NAME);
  } catch {
    // i18n not ready
  }
  return null;
}

/** The reading dealt in this browser, or null (no deal, provider missing). */
export function readTarokkaReadingLocal(): ProviderReading | null {
  const provider = tarokkaReadingProvider();
  if (!provider.active) return null;
  const secret = readSetting('secret') as
    | { id?: unknown; cards?: unknown; stages?: unknown }
    | undefined;
  if (!secret || typeof secret.id !== 'string' || !READING_ID.test(secret.id)) return null;
  const cards = Array.isArray(secret.cards) ? secret.cards : [];
  const stages = Array.isArray(secret.stages) ? secret.stages : [];
  const plan = readSetting('plan');
  const notes = Array.isArray(plan) ? plan : [];
  const overrides = readSetting('cardOverrides');

  const slots: TarokkaSlot[] = TAROKKA_POSITIONS.map((position, i) => {
    const cardId = cardIdOf(cards[i]);
    const stage = (STAGES as readonly unknown[]).includes(stages[i])
      ? (stages[i] as TarokkaSlot['stage'])
      : 'hidden';
    return {
      position,
      cardId,
      cardName: cardNameOf(cardId, overrides),
      gmNote: text((notes[i] as { note?: unknown } | undefined)?.note, MAX_NOTE),
      stage,
    };
  });
  return {
    source: 'tarokka-reading',
    providerVersion: provider.version ?? '',
    readingId: secret.id,
    dealt: slots.every(s => s.cardId !== null),
    complete: slots.every(s => s.stage === 'revealed'),
    slots,
    capturedAt: new Date().toISOString(),
  };
}

/** Validate a reading received from another client (helper query payload). */
export function parseProviderReading(data: unknown): ProviderReading {
  const r = data as Partial<ProviderReading> | null | undefined;
  if (!r || r.source !== 'tarokka-reading' || typeof r.readingId !== 'string') {
    throw new Error('Invalid payload: expected a tarokka-reading reading');
  }
  if (!READING_ID.test(r.readingId)) throw new Error('Invalid payload: bad readingId');
  if (!Array.isArray(r.slots) || r.slots.length !== TAROKKA_POSITIONS.length) {
    throw new Error('Invalid payload: expected five slots');
  }
  const slots = TAROKKA_POSITIONS.map((position, i): TarokkaSlot => {
    const s = (r.slots as unknown[])[i] as Partial<TarokkaSlot> | undefined;
    return {
      position,
      cardId: cardIdOf(s?.cardId),
      cardName: text(s?.cardName, MAX_NAME),
      gmNote: text(s?.gmNote, MAX_NOTE),
      stage: (STAGES as readonly unknown[]).includes(s?.stage)
        ? (s?.stage as TarokkaSlot['stage'])
        : 'hidden',
    };
  });
  return {
    source: 'tarokka-reading',
    providerVersion: text(r.providerVersion, 20) ?? '',
    readingId: r.readingId,
    dealt: slots.every(s => s.cardId !== null),
    complete: slots.every(s => s.stage === 'revealed'),
    slots,
    capturedAt: typeof r.capturedAt === 'string' ? r.capturedAt : new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Offers (kept in memory on GM clients until imported)
// ---------------------------------------------------------------------------

let offered: { reading: ProviderReading; fromUserId: string } | null = null;

export function storeTarokkaOffer(reading: ProviderReading, fromUserId: string): void {
  offered = { reading, fromUserId };
}

export function currentTarokkaOffer(): { reading: ProviderReading; fromUserId: string } | null {
  return offered;
}

/** Test helper. */
export function resetTarokkaStateForTests(): void {
  offered = null;
  askedReadingIds.clear();
}

/**
 * Bridge handler body: the reading from this client, a pending offer, or (with
 * `userId`) the given GM's client via `fetchFromUser`.
 */
export async function getTarokkaReading(
  data: { userId?: unknown } | undefined,
  fetchFromUser: (userId: string) => Promise<ProviderReading | null>
): Promise<TarokkaReadingResult> {
  const userId = typeof data?.userId === 'string' && data.userId ? data.userId : undefined;
  if (userId && userId !== game.user.id) {
    const reading = await fetchFromUser(userId);
    return reading
      ? { available: true, from: `user:${userId}`, reading }
      : { available: false, reason: 'That GM client has no tarokka-reading reading' };
  }
  const local = readTarokkaReadingLocal();
  if (local?.dealt) return { available: true, from: 'local', reading: local };
  if (offered) return { available: true, from: 'offer', reading: offered.reading };
  const provider = tarokkaReadingProvider();
  return {
    available: false,
    reason: provider.active
      ? 'No reading dealt in this browser and none offered by another GM (deal in tarokka-reading, or pass userId of the dealing GM)'
      : `${provider.reason ?? 'tarokka-reading unavailable'}; use source builtin-roll`,
  };
}

// ---------------------------------------------------------------------------
// Deal detection: offer a new reading to the AI Tool (dealing GM's browser)
// ---------------------------------------------------------------------------

const askedReadingIds = new Set<string>();

interface DialogV2Like {
  confirm(options: Record<string, unknown>): Promise<boolean | null>;
}

async function confirmOffer(): Promise<boolean> {
  const api = (foundry.applications as { api?: { DialogV2?: DialogV2Like } }).api;
  if (!api?.DialogV2) return false;
  const answer = await api.DialogV2.confirm({
    window: { title: 'AI Tool: Tarokka reading' },
    content:
      '<p>Offer this reading to the AI Tool? It is then imported into the bridge vault ' +
      '(outside Foundry, GM only) once you confirm the import there.</p>',
    rejectClose: false,
  });
  return answer === true;
}

/**
 * `clientSettingChanged` handler: when a new reading is dealt in this GM's
 * browser and the Tarokka feature is on, ask once whether to offer it, then
 * keep the offer here and send it to the other active GM clients.
 */
export async function onTarokkaSettingChanged(
  key: string,
  sendOffer: (user: User, reading: ProviderReading) => Promise<unknown>,
  ask: () => Promise<boolean> = confirmOffer
): Promise<'ignored' | 'declined' | 'offered'> {
  if (key !== `${TAROKKA_READING_MODULE}.secret`) return 'ignored';
  if (!game.user?.isGM || !isFeatureEnabled(TAROKKA_FEATURE_ID)) return 'ignored';
  const reading = readTarokkaReadingLocal();
  if (!reading?.dealt || askedReadingIds.has(reading.readingId)) return 'ignored';
  askedReadingIds.add(reading.readingId);
  if (!(await ask())) {
    trackUsage('action', 'module.tarokka.offer-decline');
    return 'declined';
  }
  trackUsage('action', 'module.tarokka.offer-confirm');
  storeTarokkaOffer(reading, game.user.id);
  const others = game.users.filter(u => u.isGM && u.active && u.id !== game.user.id);
  await Promise.allSettled(others.map(u => sendOffer(u, reading)));
  ui.notifications.info(
    'Tarokka reading offered to the AI Tool (import it with plan-tarokka-import).'
  );
  return 'offered';
}

// ---------------------------------------------------------------------------
// Link candidates (the GM confirms; no card meanings are known here)
// ---------------------------------------------------------------------------

export interface LinkCandidate {
  uuid: string;
  documentName: 'JournalEntryPage' | 'JournalEntry' | 'Scene' | 'Actor';
  name: string;
  parentName?: string;
}

/** World journal pages, journals, scenes and actors whose name contains `query`. */
export function searchLinkCandidates(data: { query?: unknown; limit?: unknown } | undefined): {
  query: string;
  candidates: LinkCandidate[];
} {
  const query = typeof data?.query === 'string' ? data.query.trim() : '';
  if (query.length < 2 || query.length > 100) {
    throw new Error('query must be 2 to 100 characters');
  }
  const limit = Math.min(Math.max(Number(data?.limit) || 20, 1), 50);
  const needle = query.toLowerCase();
  const matches = (name: unknown): name is string =>
    typeof name === 'string' && name.toLowerCase().includes(needle);
  const out: LinkCandidate[] = [];
  const push = (c: LinkCandidate): boolean => {
    out.push(c);
    return out.length >= limit;
  };

  for (const entry of game.journal.contents) {
    if (
      matches(entry.name) &&
      push({ uuid: entry.uuid, documentName: 'JournalEntry', name: entry.name })
    ) {
      break;
    }
    let full = false;
    for (const page of entry.pages?.contents ?? []) {
      if (!matches(page.name)) continue;
      full = push({
        uuid: page.uuid,
        documentName: 'JournalEntryPage',
        name: page.name ?? '',
        parentName: entry.name,
      });
      if (full) break;
    }
    if (full) break;
  }
  for (const scene of out.length < limit ? game.scenes.contents : []) {
    if (
      matches(scene.name) &&
      push({ uuid: scene.uuid, documentName: 'Scene', name: scene.name })
    ) {
      break;
    }
  }
  for (const actor of out.length < limit ? game.actors.contents : []) {
    if (
      matches(actor.name) &&
      push({ uuid: actor.uuid, documentName: 'Actor', name: actor.name })
    ) {
      break;
    }
  }
  return { query, candidates: out };
}
