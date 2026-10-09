/**
 * Tarokka integration, backend side (plan feature 1, M1).
 *
 * The reading is secret, so it lives only in the bridge vault (GM-only, outside
 * Foundry world data):
 *
 * - `gm/tarokka.json`: `{current?, archive?: {[readingId]: reading}, revealJournal?}`.
 *   A new reading archives the previous one.
 * - `gm/tarokka-config.json`: the GM's link table `links.<position>.<cardId>`
 *   (journal page / scene / actor uuids) and name overrides `cardNames.<cardId>`.
 *   Links are per position and card, so a later reading that deals the same card
 *   in the same position is linked already.
 * - `gm/reveals.json`: `pages.<pageId>` for every player page the tool created
 *   (the reveal allowlist the player view uses in M2).
 *
 * Every change is a guarded plan (feature `tarokka`, off by default in the
 * module settings); `apply-planned-change` applies it after confirmation. A
 * reveal publishes a player-observable journal page with GM-typed text only,
 * and is destructive class because it cannot be taken back at the table.
 *
 * Summaries never contain card names: they end up in the GM feed and the audit
 * list. Card names appear only in plan diffs and reading views (GM-only).
 */
import { randomBytes, randomInt } from 'crypto';

import type { GuardedOp } from '@gnuminator/shared';
import { unwrapBridgeReply } from '@gnuminator/shared';

import type { FoundryClient } from '../foundry-client.js';
import type { GuardedWriteService, PlanView, VaultOp } from '../guarded-write/service.js';
import type { VaultStore } from '../vault/store.js';
import type { WorldIdResolver } from '../vault/world-id.js';

import {
  POSITION_DECK,
  POSITION_LABELS,
  TAROKKA_POSITIONS,
  defaultCardName,
  deckOf,
  isTarokkaPosition,
  rollReading,
  type RandomIndex,
  type TarokkaPosition,
} from './deck.js';

export const TAROKKA_FEATURE = 'tarokka';
export const TAROKKA_FILE = 'tarokka.json';
export const TAROKKA_CONFIG_FILE = 'tarokka-config.json';
export const REVEALS_FILE = 'reveals.json';
/** Foundry's OBSERVER ownership level: players can read the reveal journal. */
const OBSERVER = 2;
const MAX_REVEAL_TEXT = 5000;
const CARD_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID =
  /^(?:Compendium\.[\w-]+\.[\w-]+\.)?[A-Z][A-Za-z]+\.[A-Za-z0-9]{16}(?:\.[A-Z][A-Za-z]+\.[A-Za-z0-9]{16})*$/;

export type TarokkaSource = 'builtin-roll' | 'tarokka-reading';

export interface StoredPosition {
  cardName: string;
  cardId: string;
  gmNote: string | null;
  revealed: boolean;
  revealPageUuid?: string;
}

export interface StoredReading {
  readingId: string;
  source: TarokkaSource;
  readAt: string;
  providerVersion: string | null;
  positions: Record<TarokkaPosition, StoredPosition>;
}

interface TarokkaFile {
  current?: StoredReading;
  archive?: Record<string, StoredReading>;
  revealJournal?: { uuid: string };
}

export interface TarokkaLinks {
  journalPageUuid?: string;
  sceneUuid?: string;
  actorUuid?: string;
}

interface TarokkaConfig {
  cardNames?: Record<string, string>;
  links?: Partial<Record<TarokkaPosition, Record<string, TarokkaLinks>>>;
}

export interface PositionView {
  position: TarokkaPosition;
  label: string;
  deck: 'common' | 'high';
  cardId: string;
  cardName: string;
  gmNote: string | null;
  links: TarokkaLinks;
  linked: boolean;
  revealed: boolean;
  revealPageUuid: string | null;
}

export interface TarokkaView {
  available: boolean;
  reading?: {
    readingId: string;
    source: TarokkaSource;
    readAt: string;
    providerVersion: string | null;
    positions: PositionView[];
  };
  archivedReadings: number;
  revealJournalUuid: string | null;
  note: string;
}

interface ProviderSlot {
  position?: unknown;
  cardId?: unknown;
  cardName?: unknown;
  gmNote?: unknown;
}

interface ProviderResult {
  success?: boolean;
  error?: string;
  available?: boolean;
  reason?: string;
  from?: string;
  reading?: {
    source?: unknown;
    readingId?: unknown;
    providerVersion?: unknown;
    dealt?: unknown;
    slots?: ProviderSlot[];
  };
}

export interface TarokkaServiceOptions {
  guardedWrites: Pick<GuardedWriteService, 'createPlan'>;
  store: VaultStore;
  worldIds: Pick<WorldIdResolver, 'current'>;
  foundryClient: Pick<FoundryClient, 'query'>;
  random?: RandomIndex;
  now?: () => number;
}

/** A Foundry document id: 16 alphanumeric characters (also used by the handouts reveal copy). */
export function newDocumentId(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 16; i++) id += alphabet[randomInt(alphabet.length)];
  return id;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** GM-typed text as journal HTML: blank lines split paragraphs, newlines become breaks. */
export function revealHtml(text: string): string {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map(p => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function unwrap<T extends { success?: boolean; error?: string }>(
  response: unknown,
  what: string
): T {
  const r = (response ?? {}) as T;
  if (r.success === false) throw new Error(`${what}: ${r.error ?? 'refused by Foundry'}`);
  return r;
}

function isCompleteReading(value: unknown): value is StoredReading {
  if (!value || typeof value !== 'object') return false;
  const reading = value as Partial<StoredReading>;
  if (typeof reading.readingId !== 'string' || !reading.positions) return false;
  const positions = reading.positions as Partial<Record<TarokkaPosition, StoredPosition>>;
  return TAROKKA_POSITIONS.every(position => typeof positions[position]?.cardId === 'string');
}

function assertUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length > 300 || !UUID.test(value)) {
    throw new Error(`${field} must be a Foundry document uuid`);
  }
  return value;
}

export class TarokkaService {
  private readonly guardedWrites: TarokkaServiceOptions['guardedWrites'];
  private readonly store: VaultStore;
  private readonly worldIds: TarokkaServiceOptions['worldIds'];
  private readonly foundry: TarokkaServiceOptions['foundryClient'];
  private readonly random: RandomIndex | undefined;
  private readonly now: () => number;

  constructor(options: TarokkaServiceOptions) {
    this.guardedWrites = options.guardedWrites;
    this.store = options.store;
    this.worldIds = options.worldIds;
    this.foundry = options.foundryClient;
    this.random = options.random;
    this.now = options.now ?? ((): number => Date.now());
  }

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  async getReading(): Promise<TarokkaView> {
    const worldId = await this.worldIds.current();
    const { file, config } = await this.load(worldId);
    const note =
      'GM only: the reading is stored in the bridge vault, never in Foundry world data. ' +
      'Players see only pages published with plan-tarokka-reveal.';
    const base = {
      archivedReadings: Object.keys(file.archive ?? {}).length,
      revealJournalUuid: file.revealJournal?.uuid ?? null,
      note,
    };
    const current = file.current;
    if (!current) return { available: false, ...base };
    return {
      available: true,
      reading: {
        readingId: current.readingId,
        source: current.source,
        readAt: current.readAt,
        providerVersion: current.providerVersion ?? null,
        positions: TAROKKA_POSITIONS.map(position => {
          const stored = current.positions[position];
          const links = config.links?.[position]?.[stored.cardId] ?? {};
          return {
            position,
            label: POSITION_LABELS[position],
            deck: POSITION_DECK[position],
            cardId: stored.cardId,
            cardName: config.cardNames?.[stored.cardId] ?? stored.cardName,
            gmNote: stored.gmNote ?? null,
            links,
            linked: Object.keys(links).length > 0,
            revealed: stored.revealed === true,
            revealPageUuid: stored.revealPageUuid ?? null,
          };
        }),
      },
      ...base,
    };
  }

  /** Journal pages, journals, scenes and actors whose name contains `query`. */
  async suggestLinks(query: string, limit?: number): Promise<unknown> {
    return unwrap(
      await this.foundry.query('foundry-mcp-bridge.searchLinkCandidates', {
        query,
        ...(limit !== undefined ? { limit } : {}),
      }),
      'Link search refused'
    );
  }

  // -------------------------------------------------------------------------
  // Plans
  // -------------------------------------------------------------------------

  /**
   * Plan storing a reading: from tarokka-reading when available (`auto`,
   * `tarokka-reading`), else (or with `builtin-roll`) a fresh built-in roll.
   */
  async planImport(args: {
    source?: 'auto' | TarokkaSource;
    userId?: string;
  }): Promise<PlanView & { source: TarokkaSource; providerNote?: string }> {
    const source = args.source ?? 'auto';
    const worldId = await this.worldIds.current();
    const { file, config } = await this.load(worldId);

    let reading: StoredReading | null = null;
    let providerNote: string | undefined;
    if (source === 'auto' || source === 'tarokka-reading') {
      const result = unwrap<ProviderResult>(
        await this.foundry.query(
          'foundry-mcp-bridge.getTarokkaReading',
          args.userId ? { userId: args.userId } : {}
        ),
        'Reading the tarokka-reading reading was refused'
      );
      if (result.available && result.reading) {
        reading = this.fromProvider(result.reading, config);
      } else if (source === 'tarokka-reading') {
        throw new Error(result.reason ?? 'No tarokka-reading reading is available');
      } else {
        providerNote = result.reason;
      }
    }
    reading ??= this.fromRoll(config);

    const previous = file.current;
    if (previous?.readingId === reading.readingId) {
      // Re-import of the same deal: keep what was revealed for unchanged cards.
      for (const position of TAROKKA_POSITIONS) {
        const before = previous.positions[position];
        const after = reading.positions[position];
        if (before?.cardId === after.cardId) {
          after.revealed = before.revealed === true;
          if (before.revealPageUuid) after.revealPageUuid = before.revealPageUuid;
        }
      }
    }

    const vaultOps: VaultOp[] = [];
    if (previous && previous.readingId !== reading.readingId) {
      vaultOps.push({
        kind: 'vault-set',
        file: TAROKKA_FILE,
        path: `archive.${previous.readingId}`,
        value: previous,
      });
    }
    const set = (path: string, value: unknown): void => {
      vaultOps.push({ kind: 'vault-set', file: TAROKKA_FILE, path: `current.${path}`, value });
    };
    set('readingId', reading.readingId);
    set('source', reading.source);
    set('readAt', reading.readAt);
    set('providerVersion', reading.providerVersion);
    for (const position of TAROKKA_POSITIONS) {
      set(`positions.${position}`, reading.positions[position]);
    }

    const label = reading.source === 'builtin-roll' ? 'built-in roll' : 'tarokka-reading';
    const plan = await this.guardedWrites.createPlan({
      feature: TAROKKA_FEATURE,
      summary: `Store a new Tarokka reading (${label})${previous && previous.readingId !== reading.readingId ? ', archiving the previous one' : ''}`,
      vaultOps,
    });
    return { ...plan, source: reading.source, ...(providerNote ? { providerNote } : {}) };
  }

  /** Plan linking a position's card to documents, naming it, or clearing its links. */
  async planLinks(args: {
    position: string;
    cardId?: string;
    journalPageUuid?: string;
    sceneUuid?: string;
    actorUuid?: string;
    cardName?: string;
    clear?: boolean;
  }): Promise<PlanView> {
    if (!isTarokkaPosition(args.position)) {
      throw new Error(`position must be one of ${TAROKKA_POSITIONS.join(', ')}`);
    }
    const position = args.position;
    const worldId = await this.worldIds.current();
    const { file, config } = await this.load(worldId);
    const cardId = args.cardId ?? file.current?.positions[position]?.cardId;
    if (!cardId) throw new Error('No current reading; pass cardId to link a card in advance');
    if (!CARD_ID.test(cardId) || deckOf(cardId) !== POSITION_DECK[position]) {
      throw new Error(`${cardId} is not a ${POSITION_DECK[position]}-deck card id`);
    }

    const vaultOps: VaultOp[] = [];
    const base = `links.${position}.${cardId}`;
    if (args.clear) {
      if (!config.links?.[position]?.[cardId]) throw new Error('This card has no links to clear');
      vaultOps.push({ kind: 'vault-delete', file: TAROKKA_CONFIG_FILE, path: base });
    }
    const fields: Array<[keyof TarokkaLinks, string | undefined]> = [
      ['journalPageUuid', args.journalPageUuid],
      ['sceneUuid', args.sceneUuid],
      ['actorUuid', args.actorUuid],
    ];
    for (const [field, value] of fields) {
      if (value === undefined) continue;
      vaultOps.push({
        kind: 'vault-set',
        file: TAROKKA_CONFIG_FILE,
        path: `${base}.${field}`,
        value: assertUuid(value, field),
      });
    }
    if (args.cardName !== undefined) {
      const name = args.cardName.trim();
      if (!name || name.length > 120) throw new Error('cardName must be 1 to 120 characters');
      vaultOps.push({
        kind: 'vault-set',
        file: TAROKKA_CONFIG_FILE,
        path: `cardNames.${cardId}`,
        value: name,
      });
    }
    if (vaultOps.length === 0) {
      throw new Error('Nothing to change: pass a uuid, cardName, or clear: true');
    }
    return this.guardedWrites.createPlan({
      feature: TAROKKA_FEATURE,
      summary: `Update Tarokka links (${POSITION_LABELS[position]})`,
      vaultOps,
    });
  }

  /**
   * Plan publishing GM-typed text for one position as a page in a
   * player-observable journal, and marking the position revealed.
   */
  async planReveal(args: {
    position: string;
    text: string;
    title?: string;
    journalName?: string;
    /** Also pop the page up on the players' screens after the reveal (Foundry's Show Players). */
    showNow?: boolean;
  }): Promise<PlanView & { pageUuid: string }> {
    if (!isTarokkaPosition(args.position)) {
      throw new Error(`position must be one of ${TAROKKA_POSITIONS.join(', ')}`);
    }
    const position = args.position;
    if (args.showNow !== undefined && typeof args.showNow !== 'boolean') {
      throw new Error('showNow must be true or false');
    }
    const text = typeof args.text === 'string' ? args.text.trim() : '';
    if (!text || text.length > MAX_REVEAL_TEXT) {
      throw new Error(`text must be 1 to ${MAX_REVEAL_TEXT} characters (what the players read)`);
    }
    const index = TAROKKA_POSITIONS.indexOf(position);
    const customTitle = args.title?.trim();
    const title = (customTitle ? customTitle : `Card ${index + 1}`).slice(0, 120);
    const worldId = await this.worldIds.current();
    const { file } = await this.load(worldId);
    const current = file.current;
    if (!current) throw new Error('No current reading; import one with plan-tarokka-import');

    // Which of the recorded journal / page still exist in Foundry?
    const journalUuid = file.revealJournal?.uuid;
    const pageUuid = current.positions[position]?.revealPageUuid;
    const probes: GuardedOp[] = [];
    if (journalUuid) {
      probes.push({
        kind: 'create',
        documentName: 'JournalEntryPage',
        parentUuid: journalUuid,
        data: {},
      });
    }
    if (pageUuid) probes.push({ kind: 'delete', uuid: pageUuid });
    const snapshots =
      probes.length > 0
        ? (unwrapBridgeReply(
            await this.foundry.query('foundry-mcp-bridge.snapshotGuardedOps', { ops: probes }),
            'Snapshot refused'
          ) ?? [])
        : [];
    const journalExists = journalUuid ? snapshots[0]?.exists === true : false;
    const pageExists = pageUuid ? snapshots[journalUuid ? 1 : 0]?.exists === true : false;

    const content = revealHtml(text);
    const ops: GuardedOp[] = [];
    const vaultOps: VaultOp[] = [];
    let targetPageUuid: string;
    if (pageUuid && pageExists) {
      targetPageUuid = pageUuid;
      // Re-reveal: the page keeps its name unless the GM gives a new title.
      ops.push({
        kind: 'update',
        uuid: pageUuid,
        changes: { ...(customTitle ? { name: title } : {}), 'text.content': content },
      });
    } else {
      const pageId = newDocumentId();
      const pageData = {
        _id: pageId,
        name: title,
        type: 'text',
        text: { content, format: 1 },
      };
      if (journalUuid && journalExists) {
        targetPageUuid = `${journalUuid}.JournalEntryPage.${pageId}`;
        ops.push({
          kind: 'create',
          documentName: 'JournalEntryPage',
          parentUuid: journalUuid,
          data: pageData,
          keepId: true,
        });
      } else {
        const journalId = newDocumentId();
        const newJournalUuid = `JournalEntry.${journalId}`;
        targetPageUuid = `${newJournalUuid}.JournalEntryPage.${pageId}`;
        ops.push({
          kind: 'create',
          documentName: 'JournalEntry',
          data: {
            _id: journalId,
            name: (args.journalName?.trim() ? args.journalName.trim() : 'Tarokka reading').slice(
              0,
              120
            ),
            ownership: { default: OBSERVER },
            pages: [pageData],
          },
          keepId: true,
        });
        vaultOps.push({
          kind: 'vault-set',
          file: TAROKKA_FILE,
          path: 'revealJournal',
          value: { uuid: newJournalUuid },
        });
      }
      vaultOps.push({
        kind: 'vault-set',
        file: REVEALS_FILE,
        path: `pages.${pageId}`,
        value: {
          uuid: targetPageUuid,
          feature: TAROKKA_FEATURE,
          position,
          readingId: current.readingId,
          at: new Date(this.now()).toISOString(),
        },
      });
      vaultOps.push({
        kind: 'vault-set',
        file: TAROKKA_FILE,
        path: `current.positions.${position}.revealPageUuid`,
        value: targetPageUuid,
      });
    }
    if (current.positions[position]?.revealed !== true) {
      vaultOps.push({
        kind: 'vault-set',
        file: TAROKKA_FILE,
        path: `current.positions.${position}.revealed`,
        value: true,
      });
    }

    const label = POSITION_LABELS[position].toLowerCase();
    const plan = await this.guardedWrites.createPlan({
      feature: TAROKKA_FEATURE,
      summary:
        pageUuid && pageExists
          ? `Update the revealed Tarokka ${label} page${customTitle ? ` (now "${title}")` : ''}`
          : `Reveal Tarokka ${label} to players (page "${title}")`,
      ops,
      ...(vaultOps.length > 0 ? { vaultOps } : {}),
      risk: 'destructive',
      ...(args.showNow ? { showToPlayers: { uuid: targetPageUuid, users: [] } } : {}),
    });
    return { ...plan, pageUuid: targetPageUuid };
  }

  // -------------------------------------------------------------------------

  private async load(worldId: string): Promise<{ file: TarokkaFile; config: TarokkaConfig }> {
    const [stored, config] = await Promise.all([
      this.store.read<TarokkaFile>(worldId, 'gm', TAROKKA_FILE),
      this.store.read<TarokkaConfig>(worldId, 'gm', TAROKKA_CONFIG_FILE),
    ]);
    const file = { ...(stored?.data ?? {}) };
    // Undoing the first import unsets each field and leaves `{positions: {}}`:
    // anything short of a whole reading counts as no reading.
    if (!isCompleteReading(file.current)) delete file.current;
    return { file, config: config?.data ?? {} };
  }

  private nameFor(cardId: string, config: TarokkaConfig, providerName?: unknown): string {
    const override = config.cardNames?.[cardId];
    if (override) return override;
    if (typeof providerName === 'string' && providerName.trim()) return providerName.trim();
    return defaultCardName(cardId);
  }

  private fromRoll(config: TarokkaConfig): StoredReading {
    const cards = rollReading(this.random);
    const readAt = new Date(this.now()).toISOString();
    const positions = {} as Record<TarokkaPosition, StoredPosition>;
    for (const position of TAROKKA_POSITIONS) {
      const cardId = cards[position];
      positions[position] = {
        cardName: this.nameFor(cardId, config),
        cardId,
        gmNote: null,
        revealed: false,
      };
    }
    return {
      readingId: `roll-${this.now().toString(36)}-${randomBytes(3).toString('hex')}`,
      source: 'builtin-roll',
      readAt,
      providerVersion: null,
      positions,
    };
  }

  private fromProvider(
    raw: NonNullable<ProviderResult['reading']>,
    config: TarokkaConfig
  ): StoredReading {
    if (raw.source !== 'tarokka-reading' || typeof raw.readingId !== 'string') {
      throw new Error('Foundry returned an unexpected Tarokka reading');
    }
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(raw.readingId)) throw new Error('Bad tarokka-reading id');
    const slots = Array.isArray(raw.slots) ? raw.slots : [];
    const positions = {} as Record<TarokkaPosition, StoredPosition>;
    TAROKKA_POSITIONS.forEach((position, i) => {
      const slot = slots[i];
      const cardId = typeof slot?.cardId === 'string' ? slot.cardId : '';
      if (!CARD_ID.test(cardId) || deckOf(cardId) !== POSITION_DECK[position]) {
        throw new Error(
          `The tarokka-reading reading has no valid card for ${POSITION_LABELS[position]}`
        );
      }
      positions[position] = {
        cardName: this.nameFor(cardId, config, slot?.cardName),
        cardId,
        gmNote: typeof slot?.gmNote === 'string' && slot.gmNote ? slot.gmNote : null,
        revealed: false,
      };
    });
    return {
      readingId: `tr-${raw.readingId}`,
      source: 'tarokka-reading',
      readAt: new Date(this.now()).toISOString(),
      providerVersion: typeof raw.providerVersion === 'string' ? raw.providerVersion : null,
      positions,
    };
  }
}
