import { MODULE_ID } from '../constants.js';
import { trackUsage } from '../usage-recorder.js';
import { logInfo } from '../log.js';
import { num, plainText, rec, str } from '../character-sheet-fields.js';
import type {
  DnD5eCreatureIndex,
  EnhancedCreatureIndex,
  PackFingerprint,
  PersistentEnhancedIndex,
} from './types.js';

/** dnd5e document types that count as "creatures" for the index. */
const CREATURE_TYPES = new Set(['npc', 'character']);

/** Quiet time after the last pack change before the background rebuild starts. */
export const REBUILD_DEBOUNCE_MS = 5_000;

/** Quiet time after the last pack change before a GM browser writes the dirty stamp. */
export const DIRTY_STAMP_DEBOUNCE_MS = 1_000;

/** After a failed build, stale reads start no new background build for this long. */
export const BUILD_RETRY_COOLDOWN_MS = 60_000;

/** Creatures in a pack's first `getDocuments` call during a build (the browser runs in between). */
export const PACK_LOAD_CHUNK_SIZE = 10;

/** The build's progress note changes at most this often within one pack. */
const PROGRESS_INTERVAL_MS = 1_000;

/** Bounds of the adaptive chunk size (see {@link nextChunkSize}). */
export const PACK_LOAD_MIN_CHUNK = 5;
export const PACK_LOAD_MAX_CHUNK = 100;

/** The time one chunk load aims for: about the longest freeze a build should cause. */
export const PACK_LOAD_CHUNK_TARGET_MS = 250;

/**
 * The size of the next chunk after one of `size` creatures took `elapsedMs`:
 * as many creatures as fit {@link PACK_LOAD_CHUNK_TARGET_MS} at the measured
 * time per creature, at most twice the last size, within the bounds. A busy PC
 * gets small chunks (short freezes), a quiet one big chunks (fewer round trips).
 */
export function nextChunkSize(size: number, elapsedMs: number): number {
  const fit = elapsedMs > 0 ? Math.floor((PACK_LOAD_CHUNK_TARGET_MS * size) / elapsedMs) : size * 2;
  return Math.max(PACK_LOAD_MIN_CHUNK, Math.min(PACK_LOAD_MAX_CHUNK, size * 2, fit));
}

/** Whether the page is in a hidden tab or a minimized window (nobody to keep it responsive for). */
function pageHidden(): boolean {
  return (globalThis as { document?: { hidden?: boolean } }).document?.hidden === true;
}

/**
 * Let the browser handle input, rendering and socket messages before going on:
 * `scheduler.yield()` where the browser has it, else a message-channel task (no
 * 4 ms timer clamp).
 */
function yieldToBrowser(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof scheduler?.yield === 'function') return scheduler.yield();
  return new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (): void => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/**
 * Whether this browser rebuilds the creature index after a pack change: the
 * bridge user's GM browser, the one bridge queries reach. With "Any GM" only the
 * active GM (`game.users.activeGM`, the active GM with the lowest id) rebuilds,
 * so several GMs online do not all upload a build. (The warm-up at `ready` runs
 * in every GM browser with "Any GM", since the backend may route queries to any
 * of them.)
 */
export function isIndexBuilder(): boolean {
  const user = game.user;
  if (!user?.isGM) return false;
  const bridgeUserId: unknown = game.settings.get(MODULE_ID, 'bridgeUserId');
  if (typeof bridgeUserId === 'string' && bridgeUserId !== '') return bridgeUserId === user.id;
  return game.users?.activeGM?.id === user.id;
}

/** The fields of a creature document the index reads (a loaded Actor-pack document). */
interface PackCreatureDoc {
  _id: string;
  name: string;
  type: string;
  img: string;
  system?: unknown;
  items?: unknown;
}

/** A dismissible progress notification (Foundry's `ui.notifications.info` return value). */
interface RemovableNote {
  remove(): void;
}

/**
 * Persistent Enhanced Creature Index.
 *
 * Pre-computes a flat, filterable record per creature across every Actor
 * compendium and persists it as JSON in the world data directory
 * (`worlds/<id>/enhanced-creature-index.json`) so the compendium fast path can
 * filter thousands of monsters without re-loading every document.
 *
 * It is file-based (not settings/flags) because the payload is large: reads go
 * through `fetch`, writes through Foundry's `FilePicker.upload`. The index
 * self-invalidates via a pack-change hook (a world-setting stamp) plus a per-pack
 * fingerprint, rebuilding in the background whenever the world has drifted
 * (the stale copy is served meanwhile). D&D 5e only.
 *
 * The `compendium` domain injects a single instance (see `data-access.ts`).
 */
export class PersistentCreatureIndex {
  private moduleId: string = MODULE_ID;
  // 1.1.0 (M3): sizes stored as dnd5e keys ('med'), hasSpells/hasLegendaryActions
  // fixed; a bump makes worlds rebuild an index persisted by an older module.
  private readonly INDEX_VERSION = '1.2.0';
  private readonly INDEX_FILENAME = 'enhanced-creature-index.json';
  /** The build in flight, shared by every caller until it settles. */
  private buildPromise: Promise<EnhancedCreatureIndex[]> | null = null;
  private hooksRegistered = false;
  /** The pending background rebuild after pack changes (debounced). */
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  /** The pending dirty-stamp write after pack changes (debounced), and its stamp. */
  private dirtyTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingDirtyAt = 0;
  /** The `pendingDirtyAt` whose stamp write went through. */
  private stampedDirtyAt = 0;
  /** The index last read from or written to the file: served while a build runs, and reused while current. */
  private loadedIndex: PersistentEnhancedIndex | null = null;
  /** When the last build failed (0 after a success), for {@link BUILD_RETRY_COOLDOWN_MS}. */
  private lastFailedBuildAt = 0;
  /** Counts the builds that set `loadedIndex`, so a file read begun before one keeps out. */
  private builtIndexes = 0;

  constructor() {
    this.registerFoundryHooks();
  }

  // ---- public API ----------------------------------------------------------

  /**
   * Return the creature index for a query. A persisted index is reused verbatim
   * when it is current (see {@link isIndexValid}). A stale one with this module's
   * version and system (a pack changed) is still served while a background build
   * replaces it, so a creature edit never blocks queries for a whole build; only a
   * cold start with no usable saved index waits on the build.
   */
  async getEnhancedIndex(): Promise<EnhancedCreatureIndex[]> {
    return (await this.resolveIndex(false)).creatures;
  }

  /**
   * Make sure the persisted index is current, building it when it is missing or
   * stale (an older `INDEX_VERSION`, another system, changed packs). Run from the
   * GM's `ready` so a bridge query never waits out a rebuild, and awaited by the
   * test kit before its first creature query. `rebuilt` is false when the
   * persisted index was already current.
   */
  async ensureIndexCurrent(): Promise<{ rebuilt: boolean; totalCreatures: number }> {
    const { creatures, rebuilt } = await this.resolveIndex(true);
    return { rebuilt, totalCreatures: creatures.length };
  }

  /**
   * Force a full rebuild, ignoring any persisted/valid index. A build already in
   * flight is joined rather than started twice.
   */
  async rebuildIndex(): Promise<EnhancedCreatureIndex[]> {
    return this.startBuild();
  }

  /**
   * The persisted index when it is current, else the (shared) build's result.
   * Without `waitForCurrent`, a usable but stale saved index is served while the
   * build runs in the background; after a failed build, reads start no new one
   * for {@link BUILD_RETRY_COOLDOWN_MS} (a build that keeps failing would
   * otherwise run, and show its error, on every query): a stale saved index is
   * served, and with none the read throws.
   */
  private async resolveIndex(
    waitForCurrent: boolean
  ): Promise<{ creatures: EnhancedCreatureIndex[]; rebuilt: boolean }> {
    // Held here: the build can end (and clear `buildPromise`) while the file loads below.
    const build = this.buildPromise;
    if (build) {
      if (!waitForCurrent) {
        // The copy read before the build: the file (several MB) is not parsed again per query.
        const saved = this.loadedIndex ?? (await this.loadPersistedIndex());
        if (saved && this.isIndexUsable(saved)) {
          return { creatures: saved.creatures, rebuilt: false };
        }
        return { creatures: await build, rebuilt: true };
      }
      const creatures = await build;
      // A creature change during the joined build left its result stale: build once more.
      if (this.loadedIndex && this.isIndexValid(this.loadedIndex)) {
        return { creatures, rebuilt: true };
      }
      return { creatures: await this.startBuild(), rebuilt: true };
    }
    // An index in memory that is still current needs no fetch and parse of the file. (Another
    // GM's newer file differs from it only after a change, and the change's stamp makes it stale.)
    const persisted =
      this.loadedIndex && this.isIndexValid(this.loadedIndex)
        ? this.loadedIndex
        : await this.loadPersistedIndex();
    if (persisted && this.isIndexValid(persisted)) {
      return { creatures: persisted.creatures, rebuilt: false };
    }
    if (!waitForCurrent && persisted && this.isIndexUsable(persisted)) {
      if (this.inBuildCooldown()) {
        return { creatures: persisted.creatures, rebuilt: false };
      }
      this.startBuild().then(
        creatures => {
          logInfo(
            `[${this.moduleId}] Enhanced creature index rebuilt in the background (${creatures.length} creatures)`
          );
        },
        (error: unknown) => {
          console.warn(`[${this.moduleId}] Failed to rebuild the creature index:`, error);
        }
      );
      return { creatures: persisted.creatures, rebuilt: false };
    }
    if (!waitForCurrent && this.inBuildCooldown()) {
      // No usable saved index and a build failed just now: the query falls back to the
      // basic search instead of running (and failing) a full build every time.
      throw new Error('The creature index build failed less than a minute ago; not retried yet');
    }
    return { creatures: await this.startBuild(), rebuilt: true };
  }

  /** Whether a build failed within the last {@link BUILD_RETRY_COOLDOWN_MS}. */
  private inBuildCooldown(): boolean {
    return Date.now() - this.lastFailedBuildAt < BUILD_RETRY_COOLDOWN_MS;
  }

  /** Start a build, or return the one in flight: one build at a time. */
  private startBuild(): Promise<EnhancedCreatureIndex[]> {
    this.buildPromise ??= this.buildEnhancedIndex()
      .then(
        creatures => {
          this.lastFailedBuildAt = 0;
          return creatures;
        },
        (error: unknown) => {
          this.lastFailedBuildAt = Date.now();
          throw error;
        }
      )
      .finally(() => {
        this.buildPromise = null;
      });
    return this.buildPromise;
  }

  // ---- storage location -----------------------------------------------------

  /** The world data directory that holds the index file. */
  private worldDir(): string {
    return `worlds/${game.world.id}`;
  }

  /** Full path to the persisted index file. */
  private indexFilePath(): string {
    return `${this.worldDir()}/${this.INDEX_FILENAME}`;
  }

  /** Foundry's FilePicker implementation (browse + upload). */
  private get filePicker(): FoundryFilePicker {
    return foundry.applications.apps.FilePicker.implementation;
  }

  /**
   * Whether the index file is present in the world directory. Returns false when
   * the directory can't be browsed (missing / error), so callers treat that as
   * "no cached index" and rebuild.
   */
  private async indexFileExists(): Promise<boolean> {
    try {
      const result = await this.filePicker.browse('data', this.worldDir());
      return result.files.some(f => f.endsWith(this.INDEX_FILENAME));
    } catch {
      return false;
    }
  }

  // ---- load / save ----------------------------------------------------------

  /**
   * Load the persisted index into `loadedIndex`, or null when it is absent or
   * unreadable. When a build ended during the read, the build's index is
   * returned instead: the file was read before its upload, so it is older.
   */
  private async loadPersistedIndex(): Promise<PersistentEnhancedIndex | null> {
    const builtBefore = this.builtIndexes;
    const loaded = await this.readIndexFile();
    if (this.builtIndexes !== builtBefore) {
      return this.loadedIndex;
    }
    if (loaded) {
      this.loadedIndex = loaded;
    }
    return loaded;
  }

  /**
   * Read and deserialize the index file, or null when it is absent or
   * unreadable. `packFingerprints` is stored as an entries array in JSON and is
   * rehydrated back into a Map here (so `isIndexValid` can `.get(...)` it).
   */
  private async readIndexFile(): Promise<PersistentEnhancedIndex | null> {
    try {
      if (!(await this.indexFileExists())) {
        return null;
      }

      const response = await fetch(this.indexFilePath());
      if (!response.ok) {
        console.warn(`[${this.moduleId}] Failed to load index file: ${response.status}`);
        return null;
      }

      // On the wire `packFingerprints` is an entries array; it becomes a Map below.
      const rawData = (await response.json()) as { metadata?: { packFingerprints?: unknown } };
      const metadata = rawData.metadata;
      if (metadata?.packFingerprints) {
        metadata.packFingerprints = new Map(
          metadata.packFingerprints as Iterable<readonly [string, PackFingerprint]>
        );
      }
      return rawData as unknown as PersistentEnhancedIndex;
    } catch (error) {
      console.warn(`[${this.moduleId}] Failed to load persisted index from file:`, error);
      return null;
    }
  }

  /**
   * Serialize and upload the index as a JSON File. The `packFingerprints` Map is
   * converted to an entries array so it survives `JSON.stringify`.
   */
  private async savePersistedIndex(index: PersistentEnhancedIndex): Promise<void> {
    try {
      const saveData = {
        ...index,
        metadata: {
          ...index.metadata,
          packFingerprints: Array.from(index.metadata.packFingerprints.entries()),
        },
      };
      const file = new File([JSON.stringify(saveData, null, 2)], this.INDEX_FILENAME, {
        type: 'application/json',
      });
      const uploaded = await this.filePicker.upload('data', this.worldDir(), file);
      if (!uploaded) {
        throw new Error('File upload failed');
      }
    } catch (error) {
      console.error(`[${this.moduleId}] Failed to save enhanced index to file:`, error);
      throw error;
    }
  }

  // ---- validity / fingerprints ----------------------------------------------

  /** A saved index of this module's version and the current system, current or not. */
  private isIndexUsable(existingIndex: PersistentEnhancedIndex): boolean {
    return (
      existingIndex.metadata.version === this.INDEX_VERSION &&
      existingIndex.metadata.gameSystem === game.system.id
    );
  }

  /**
   * A persisted index is valid only when every dimension still matches the live
   * world: schema version, game system, no creature change after its build
   * started (no `creatureIndexDirtyAt` stamp above the one the build saw), and
   * (per currently-loaded Actor
   * pack) a fingerprint equal to the saved one. Any added, removed, or changed
   * pack invalidates it (forcing a rebuild on the next read).
   */
  private isIndexValid(existingIndex: PersistentEnhancedIndex): boolean {
    if (existingIndex.metadata.version !== this.INDEX_VERSION) {
      return false;
    }

    if (this.dirtyStamp() > (existingIndex.metadata.dirtyStamp ?? 0)) {
      return false;
    }

    const currentSystem = game.system.id;
    if (existingIndex.metadata.gameSystem !== currentSystem) {
      logInfo(
        `[${this.moduleId}] System changed from ${existingIndex.metadata.gameSystem} to ${currentSystem}, index invalidated`
      );
      return false;
    }

    const savedFingerprints = existingIndex.metadata.packFingerprints;

    // Every live Actor pack must carry a matching saved fingerprint.
    for (const pack of this.actorPacks()) {
      const saved = savedFingerprints.get(pack.metadata.id);
      if (!saved || !this.fingerprintsMatch(this.generatePackFingerprint(pack), saved)) {
        return false;
      }
    }

    // Every saved pack must still exist.
    for (const [packId] of savedFingerprints) {
      if (!game.packs.get(packId)) {
        return false;
      }
    }

    return true;
  }

  /** The `creatureIndexDirtyAt` stamp of the last creature change (0 before any). */
  private dirtyStamp(): number {
    const stamp: unknown = game.settings.get(this.moduleId, 'creatureIndexDirtyAt');
    return typeof stamp === 'number' ? stamp : 0;
  }

  /** All loaded Actor-type compendium packs. */
  private actorPacks(): CompendiumCollection[] {
    return Array.from(game.packs.values()).filter(pack => pack.metadata.type === 'Actor');
  }

  /** Fingerprint used to detect whether a pack changed since it was indexed. */
  private generatePackFingerprint(pack: CompendiumCollection): PackFingerprint {
    const metadata = pack.metadata as CompendiumMetadata & {
      lastModified?: string | number | Date;
    };
    const lastModified = metadata.lastModified
      ? new Date(metadata.lastModified).getTime()
      : Date.now();
    return {
      packId: pack.metadata.id,
      packLabel: pack.metadata.label,
      lastModified,
      documentCount: pack.index?.size || 0,
      checksum: this.generatePackChecksum(pack),
    };
  }

  /** Cheap content checksum (id + label + size), truncated to 16 chars. */
  private generatePackChecksum(pack: CompendiumCollection): string {
    const data = `${pack.metadata.id}-${pack.metadata.label}-${pack.index?.size || 0}`;
    return btoa(data).slice(0, 16);
  }

  /** Two fingerprints match when document count and checksum agree. */
  private fingerprintsMatch(current: PackFingerprint, saved: PackFingerprint): boolean {
    return current.documentCount === saved.documentCount && current.checksum === saved.checksum;
  }

  // ---- hooks / invalidation -------------------------------------------------

  /**
   * Register the pack-change hook once. Foundry 14 calls `updateCompendium`
   * (pack, documents, operation, userId) in every client after documents in a
   * pack are created, updated or deleted; a change to a creature in an Actor
   * pack marks the persisted index stale. (The `createDocument`,
   * `updateDocument`, `deleteDocument`, `createCompendium` and
   * `deleteCompendium` hooks used before do not exist in Foundry 14, so pack
   * changes were never seen.) A new or deleted pack shows up in the pack
   * fingerprints at the next read. Not seen: an edit to an embedded Item of a
   * pack Actor (a feature or spell) only calls `updateItem`, never
   * `updateCompendium`, so it waits for the next pack change or a manual rebuild.
   */
  private registerFoundryHooks(): void {
    if (this.hooksRegistered) return;

    const isCreature = (document: unknown): boolean => {
      const type = (document as { type?: unknown } | null)?.type;
      return typeof type === 'string' && CREATURE_TYPES.has(type);
    };
    Hooks.on('updateCompendium', (pack: CompendiumCollection, documents: unknown): void => {
      if (!game.user?.isGM) return;
      if (pack?.metadata?.type !== 'Actor') return;
      if (!Array.isArray(documents) || documents.some(isCreature)) {
        this.markIndexDirty();
      }
    });

    this.hooksRegistered = true;
  }

  /**
   * Mark the persisted index stale, only when the `autoRebuildIndex` setting is
   * on. Foundry's server cannot delete the file (its data route answers GET and
   * POST only), so every GM browser writes a stamp for the last change to the
   * world setting `creatureIndexDirtyAt` instead. A build saves the stamp it saw
   * before reading the packs; an index whose saved stamp is below the current one
   * is stale in every browser, even when the index builder is offline. The
   * builder's browser also rebuilds in the background.
   *
   * The stamp only goes up: the browser's `Date.now()`, or the current stamp plus
   * one when that clock is behind. Stamps are compared with stamps, never with
   * a browser's clock, so clock skew between GM PCs neither hides a change nor
   * adds builds. (Foundry 14's `game.time.serverTime` counts from the server
   * start, so it is no use across restarts.) Two GMs writing in the same moment
   * can still lower it once; that is the one gap left.
   */
  private markIndexDirty(): void {
    try {
      if (!game.settings.get(this.moduleId, 'autoRebuildIndex')) {
        return;
      }
      this.pendingDirtyAt = Date.now();
      if (this.dirtyTimer) clearTimeout(this.dirtyTimer);
      this.dirtyTimer = setTimeout(() => {
        this.dirtyTimer = null;
        const changedAt = this.pendingDirtyAt;
        game.settings
          .set(this.moduleId, 'creatureIndexDirtyAt', Math.max(changedAt, this.dirtyStamp() + 1))
          .then(() => {
            this.stampedDirtyAt = changedAt;
          })
          .catch((error: unknown) => {
            console.warn(`[${this.moduleId}] Failed to mark the creature index stale:`, error);
          });
      }, DIRTY_STAMP_DEBOUNCE_MS);
      this.scheduleRebuild();
    } catch (error) {
      console.warn(`[${this.moduleId}] Failed to mark the creature index stale:`, error);
    }
  }

  /**
   * Rebuild in the background once the packs have been quiet for
   * {@link REBUILD_DEBOUNCE_MS} (an import fires one hook per creature), only in
   * the index builder's browser, on dnd5e and while the enhanced index is on.
   * It builds afresh (an edit keeps the pack fingerprints) unless a build since
   * the change already saw its stamp.
   */
  private scheduleRebuild(): void {
    if (game.system.id !== 'dnd5e') return;
    if (!isIndexBuilder()) return;
    if (!game.settings.get(this.moduleId, 'enableEnhancedCreatureIndex')) return;
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null;
      this.rebuildAfterChange().then(
        ({ rebuilt, totalCreatures }) => {
          logInfo(
            rebuilt
              ? `[${this.moduleId}] Enhanced creature index rebuilt after a pack change (${totalCreatures} creatures)`
              : `[${this.moduleId}] Enhanced creature index already current after a pack change (${totalCreatures} creatures)`
          );
        },
        (error: unknown) => {
          console.warn(`[${this.moduleId}] Failed to rebuild the creature index:`, error);
        }
      );
    }, REBUILD_DEBOUNCE_MS);
  }

  /**
   * Wait for a build in flight, then build again, unless the last change's stamp
   * went through and the index in memory is current against it: a creature query
   * after the stamp starts a build, and the timer would otherwise run a second
   * full build for the same change. A failed stamp write always rebuilds.
   */
  private async rebuildAfterChange(): Promise<{ rebuilt: boolean; totalCreatures: number }> {
    await this.buildPromise?.catch(() => undefined);
    if (
      this.stampedDirtyAt === this.pendingDirtyAt &&
      this.loadedIndex &&
      this.isIndexValid(this.loadedIndex)
    ) {
      return { rebuilt: false, totalCreatures: this.loadedIndex.creatures.length };
    }
    return { rebuilt: true, totalCreatures: (await this.rebuildIndex()).length };
  }

  // ---- build ----------------------------------------------------------------

  /**
   * Build the index, routed by system. D&D 5e is the only supported system;
   * anything else throws. Callers go through {@link startBuild} (one at a time).
   */
  private async buildEnhancedIndex(): Promise<EnhancedCreatureIndex[]> {
    const gameSystem = game.system.id;
    logInfo(`[${this.moduleId}] Building enhanced creature index for system: ${gameSystem}`);

    if (gameSystem !== 'dnd5e') {
      throw new Error(
        `Enhanced creature index is only supported for D&D 5e (detected system: ${gameSystem}).`
      );
    }

    return this.buildDnD5eIndex();
  }

  /**
   * Build the D&D 5e index from every Actor pack and persist it. A pack that
   * fails to load is skipped (with a warning) so a single bad pack never aborts
   * the whole build; the index is always persisted, even when empty.
   */
  private async buildDnD5eIndex(): Promise<DnD5eCreatureIndex[]> {
    const startTime = Date.now();
    // Before the first pack is read: a change after this raises the stamp above it.
    const dirtyStamp = this.dirtyStamp();
    // Single rolling progress notification (replace-in-place). Held in an object
    // so its nullability isn't narrowed away by control-flow analysis.
    const notifier = {
      current: null as RemovableNote | null,
      show(message: string): void {
        this.current?.remove();
        this.current = ui.notifications?.info(message) ?? null;
      },
      clear(): void {
        this.current?.remove();
        this.current = null;
      },
    };
    let totalErrors = 0;

    try {
      const actorPacks = this.actorPacks();
      const creatures: DnD5eCreatureIndex[] = [];
      const packFingerprints = new Map<string, PackFingerprint>();

      ui.notifications?.info(
        `Starting enhanced creature index build from ${actorPacks.length} packs...`
      );

      for (let i = 0; i < actorPacks.length; i++) {
        const pack = actorPacks[i];
        try {
          // Ensure the pack index is loaded before fingerprinting it.
          if (!pack.indexed) {
            await pack.getIndex({});
          }
          packFingerprints.set(pack.metadata.id, this.generatePackFingerprint(pack));

          // A big pack takes a while: say how far it got, at most once a second.
          let shownAt = Date.now();
          const { creatures: packCreatures, errors } = await this.extractDnD5eDataFromPack(
            pack,
            (loaded, total) => {
              if (loaded >= total || Date.now() - shownAt < PROGRESS_INTERVAL_MS) return;
              shownAt = Date.now();
              notifier.show(
                `Building creature index... pack ${i + 1}/${actorPacks.length} ` +
                  `(${pack.metadata.label}): ${loaded}/${total} creatures loaded`
              );
            }
          );
          creatures.push(...packCreatures);
          totalErrors += errors;

          const percent = Math.round(((i + 1) / actorPacks.length) * 100);
          notifier.show(
            `Building creature index... ${percent}% (${i + 1}/${actorPacks.length}) — ` +
              `${creatures.length} creatures indexed`
          );
        } catch (error) {
          console.warn(`[${this.moduleId}] Failed to process pack ${pack.metadata.label}:`, error);
          ui.notifications?.warn(
            `Warning: Failed to index pack "${pack.metadata.label}" - continuing with other packs`
          );
        }
      }

      notifier.clear();
      ui.notifications?.info(
        `Saving enhanced index to world database... (${creatures.length} creatures)`
      );

      const persistentIndex: PersistentEnhancedIndex = {
        metadata: {
          version: this.INDEX_VERSION,
          timestamp: Date.now(),
          dirtyStamp,
          packFingerprints,
          totalCreatures: creatures.length,
          gameSystem: 'dnd5e',
        },
        creatures,
      };
      await this.savePersistedIndex(persistentIndex);
      this.loadedIndex = persistentIndex;
      this.builtIndexes++;

      const buildTimeSeconds = Math.round((Date.now() - startTime) / 1000);
      const errorText = totalErrors > 0 ? ` (${totalErrors} extraction errors)` : '';
      ui.notifications?.info(
        `Enhanced creature index complete! ${creatures.length} creatures indexed from ` +
          `${actorPacks.length} packs in ${buildTimeSeconds}s${errorText}`
      );

      return creatures;
    } catch (error) {
      notifier.clear();
      const errorMessage = `Failed to build enhanced creature index: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`;
      console.error(`[${this.moduleId}] ${errorMessage}`);
      trackUsage('error', 'module.error.creature-index', { code: 'build-failed' });
      ui.notifications?.error(errorMessage);
      throw error;
    } finally {
      notifier.clear();
    }
  }

  /**
   * Extract every creature record from one pack. The creatures listed in the
   * pack index load in chunks (`getDocuments({ _id__in })`), yielding to the
   * browser between chunks: one `getDocuments()` of a big pack builds every
   * Actor in one go and froze the GM browser for about 10 s, so a creature
   * query in that time timed out. The first chunk holds
   * {@link PACK_LOAD_CHUNK_SIZE} creatures, later ones {@link nextChunkSize}.
   * In a hidden page nobody waits on the freeze, so chunks are the biggest and
   * there is no yield (a background tab runs the yields far later: a build there
   * took 3.7 times as long). A chunk that fails to load yields no creatures (and
   * one error) so the build continues; per-document extraction failures are
   * absorbed by {@link extractDnD5eCreatureData}. `onChunk` hears the creatures
   * loaded so far after each chunk.
   */
  private async extractDnD5eDataFromPack(
    pack: CompendiumCollection,
    onChunk?: (loaded: number, total: number) => void
  ): Promise<{ creatures: DnD5eCreatureIndex[]; errors: number }> {
    const creatures: DnD5eCreatureIndex[] = [];
    let errors = 0;
    const allIds = this.creatureIds(pack);
    let size = PACK_LOAD_CHUNK_SIZE;

    for (let start = 0; start < allIds.length; ) {
      const hidden = pageHidden();
      const ids = allIds.slice(start, start + (hidden ? PACK_LOAD_MAX_CHUNK : size));
      start += ids.length;
      const began = performance.now();
      try {
        const documents = (await pack.getDocuments({ _id__in: ids })) as PackCreatureDoc[];
        for (const doc of documents) {
          if (!CREATURE_TYPES.has(doc.type)) {
            continue;
          }
          const result = this.extractDnD5eCreatureData(doc, pack);
          creatures.push(result.creature);
          errors += result.errors;
        }
      } catch (error) {
        console.warn(
          `[${this.moduleId}] Failed to load documents from ${pack.metadata.label}:`,
          error
        );
        errors++;
      }
      if (!hidden) size = nextChunkSize(ids.length, performance.now() - began);
      onChunk?.(start, allIds.length);
      if (!pageHidden()) await yieldToBrowser();
    }

    return { creatures, errors };
  }

  /** The ids of the pack index entries that are creatures (or carry no type). */
  private creatureIds(pack: CompendiumCollection): string[] {
    const ids: string[] = [];
    for (const entry of pack.index ?? []) {
      const { _id, type } = entry as { _id?: unknown; type?: unknown };
      if (typeof _id !== 'string' || _id === '') continue;
      if (typeof type === 'string' && !CREATURE_TYPES.has(type)) continue;
      ids.push(_id);
    }
    return ids;
  }

  /**
   * Flatten one creature document into an index record. Reads the prepared dnd5e 6 fields
   * (verified against dnd5e.mjs 6.0.5 `NPCData` / `CharacterData`); on any failure it returns
   * a safe fallback record (counted as one extraction error) rather than dropping the
   * creature. Reads the canonical `_id` field.
   */
  private extractDnD5eCreatureData(
    doc: PackCreatureDoc,
    pack: CompendiumCollection
  ): { creature: DnD5eCreatureIndex; errors: number } {
    try {
      const system = rec(doc.system);
      const details = rec(system.details);
      const attributes = rec(system.attributes);

      // `details.cr` is a nullable NumberField on NPCs (fractions stored as 0.125 etc.);
      // characters have none.
      const challengeRating = num(details.cr, 0);

      // `details.type` is a CreatureTypeField ({value, subtype, swarm, custom}); characters
      // get it from their species item during data preparation (humanoid without one).
      const creatureType = str(rec(details.type).value) || 'unknown';

      // `traits.size` is an ActorSizeField holding dnd5e's short key (tiny, sm, med, lg,
      // huge, grg; initial "med"), kept as the key to match CONFIG.DND5E.actorSizes and the
      // backend filter (filters.ts).
      const size = str(rec(system.traits).size) || 'med';

      const hp = rec(attributes.hp);
      const hitPoints = num(hp.max, 0) || num(hp.value, 0);
      const armorClass = num(rec(attributes.ac).value, 0) || 10;
      const alignment = str(details.alignment) || 'unaligned';

      // Spellcasting: `system.spells` (spell1..9 + pact, `{value, override}` plus prepared
      // `max`) and `attributes.spellcasting` (a StringField, "" for non-casters) exist on
      // every creature, so their presence says nothing. The signal is a nonzero slot or a
      // spell item. Not the ability: the 2024 monsters (`dnd5e.actors24`) set one on every
      // NPC (a Wolf has "str"; seen live on 6.0.5), and their casters (Mage, Lich, dragons)
      // cast from spell items, not slots.
      const isPositiveNumber = (v: unknown): boolean => typeof v === 'number' && v > 0;
      const hasSpellSlotValue = Object.values(rec(system.spells)).some(slot => {
        const s = rec(slot);
        return isPositiveNumber(s.value) || isPositiveNumber(s.max) || isPositiveNumber(s.override);
      });
      const items: unknown = doc.items;
      const itemList: unknown[] = Array.isArray(items)
        ? items
        : Array.isArray(rec(items).contents)
          ? (rec(items).contents as unknown[])
          : [];
      const hasSpellItem = itemList.some(item => rec(item).type === 'spell');
      const hasSpells = hasSpellSlotValue || hasSpellItem;

      // Legendary actions: `resources.legact` is a `{max, spent}` container on every NPC
      // (initial max 0), so only a positive max counts. `legres` is legendary resistance, a
      // different trait.
      const hasLegendaryActions = num(rec(rec(system.resources).legact).max, 0) > 0;

      return {
        creature: {
          id: doc._id,
          name: doc.name,
          type: doc.type,
          pack: pack.metadata.id,
          packLabel: pack.metadata.label,
          challengeRating,
          creatureType: creatureType.toLowerCase(),
          size: size.toLowerCase(),
          hitPoints,
          armorClass,
          hasSpells,
          hasLegendaryActions,
          alignment: alignment.toLowerCase(),
          description: this.biographyText(doc.system),
          img: doc.img,
        },
        errors: 0,
      };
    } catch (error) {
      console.warn(`[${this.moduleId}] Failed to extract enhanced data from ${doc.name}:`, error);
      // Keep the creature with safe defaults rather than dropping it.
      return { creature: this.fallbackRecord(doc, pack), errors: 1 };
    }
  }

  /**
   * The biography as plain text (no tags or secret blocks), so the description search matches
   * words, not markup. dnd5e 6 stores `details.biography` as `{value, public}`; a plain string
   * (older data) is read as is.
   */
  private biographyText(system: unknown): string {
    const bio = rec(rec(system).details).biography;
    return plainText(typeof bio === 'string' ? bio : rec(bio).value, 2000);
  }

  /** Safe default record used when extraction throws (fallback HP is 1, not 0). */
  private fallbackRecord(doc: PackCreatureDoc, pack: CompendiumCollection): DnD5eCreatureIndex {
    return {
      id: doc._id,
      name: doc.name,
      type: doc.type,
      pack: pack.metadata.id,
      packLabel: pack.metadata.label,
      challengeRating: 0,
      creatureType: 'unknown',
      size: 'med',
      hitPoints: 1,
      armorClass: 10,
      hasSpells: false,
      hasLegendaryActions: false,
      alignment: 'unaligned',
      description: 'Data extraction failed',
      img: doc.img || '',
    };
  }
}
