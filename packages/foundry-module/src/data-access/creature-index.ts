import { MODULE_ID } from '../constants.js';
import type {
  DnD5eCreatureIndex,
  EnhancedCreatureIndex,
  PackFingerprint,
  PersistentEnhancedIndex,
} from './types.js';

/** dnd5e document types that count as "creatures" for the index. */
const CREATURE_TYPES = new Set(['npc', 'character', 'creature']);

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
 * self-invalidates via pack-change hooks plus a per-pack fingerprint, rebuilding
 * lazily on the next read whenever the world has drifted. D&D 5e only.
 *
 * The `compendium` domain injects a single instance (see `data-access.ts`).
 */
export class PersistentCreatureIndex {
  private moduleId: string = MODULE_ID;
  private readonly INDEX_VERSION = '1.0.0';
  private readonly INDEX_FILENAME = 'enhanced-creature-index.json';
  private buildInProgress = false;
  private hooksRegistered = false;

  constructor() {
    this.registerFoundryHooks();
  }

  // ---- public API ----------------------------------------------------------

  /**
   * Return the creature index, rebuilding (and persisting) it only when there is
   * no valid persisted copy. A persisted index is reused verbatim when its
   * version, game system, and every Actor-pack fingerprint still match the live
   * world; otherwise it is rebuilt.
   */
  async getEnhancedIndex(): Promise<EnhancedCreatureIndex[]> {
    const persisted = await this.loadPersistedIndex();
    if (persisted && this.isIndexValid(persisted)) {
      return persisted.creatures;
    }
    return this.buildEnhancedIndex();
  }

  /** Force a full rebuild, ignoring any persisted/valid index. */
  async rebuildIndex(): Promise<EnhancedCreatureIndex[]> {
    return this.buildEnhancedIndex(true);
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
  private get filePicker(): any {
    return (foundry as any).applications.apps.FilePicker.implementation;
  }

  /**
   * Whether the index file is present in the world directory. Returns false when
   * the directory can't be browsed (missing / error), so callers treat that as
   * "no cached index" and rebuild.
   */
  private async indexFileExists(): Promise<boolean> {
    try {
      const result = await this.filePicker.browse('data', this.worldDir());
      return result.files.some((f: string) => f.endsWith(this.INDEX_FILENAME));
    } catch {
      return false;
    }
  }

  // ---- load / save ----------------------------------------------------------

  /**
   * Load and deserialize the persisted index, or null when it is absent or
   * unreadable. `packFingerprints` is stored as an entries array in JSON and is
   * rehydrated back into a Map here (so `isIndexValid` can `.get(...)` it).
   */
  private async loadPersistedIndex(): Promise<PersistentEnhancedIndex | null> {
    try {
      if (!(await this.indexFileExists())) {
        return null;
      }

      const response = await fetch(this.indexFilePath());
      if (!response.ok) {
        console.warn(`[${this.moduleId}] Failed to load index file: ${response.status}`);
        return null;
      }

      const rawData = await response.json();
      const metadata = rawData.metadata;
      if (metadata?.packFingerprints) {
        metadata.packFingerprints = new Map(metadata.packFingerprints);
      }
      return rawData;
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

  /**
   * A persisted index is valid only when every dimension still matches the live
   * world: schema version, game system, and — per currently-loaded Actor pack —
   * a fingerprint equal to the saved one. Any added, removed, or changed pack
   * invalidates it (forcing a rebuild on the next read).
   */
  private isIndexValid(existingIndex: PersistentEnhancedIndex): boolean {
    if (existingIndex.metadata.version !== this.INDEX_VERSION) {
      return false;
    }

    const currentSystem = (game as any).system.id;
    if (existingIndex.metadata.gameSystem !== currentSystem) {
      console.log(
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

  /** All loaded Actor-type compendium packs. */
  private actorPacks(): any[] {
    return Array.from(game.packs.values()).filter((pack: any) => pack.metadata.type === 'Actor');
  }

  /** Fingerprint used to detect whether a pack changed since it was indexed. */
  private generatePackFingerprint(pack: any): PackFingerprint {
    const lastModified = pack.metadata.lastModified
      ? new Date(pack.metadata.lastModified).getTime()
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
  private generatePackChecksum(pack: any): string {
    const data = `${pack.metadata.id}-${pack.metadata.label}-${pack.index?.size || 0}`;
    return btoa(data).slice(0, 16);
  }

  /** Two fingerprints match when document count and checksum agree. */
  private fingerprintsMatch(current: PackFingerprint, saved: PackFingerprint): boolean {
    return current.documentCount === saved.documentCount && current.checksum === saved.checksum;
  }

  // ---- hooks / invalidation -------------------------------------------------

  /**
   * Register the pack-change hooks once. A creature-document mutation in a pack,
   * or an Actor-pack create/delete, invalidates the persisted index.
   */
  private registerFoundryHooks(): void {
    if (this.hooksRegistered) return;

    const onCreatureDoc = (document: any) => {
      if (document.pack && CREATURE_TYPES.has(document.type)) {
        void this.invalidateIndex();
      }
    };
    Hooks.on('createDocument', onCreatureDoc);
    Hooks.on('updateDocument', onCreatureDoc);
    Hooks.on('deleteDocument', onCreatureDoc);

    const onActorPack = (pack: any) => {
      if (pack.metadata.type === 'Actor') {
        void this.invalidateIndex();
      }
    };
    Hooks.on('createCompendium', onActorPack);
    Hooks.on('deleteCompendium', onActorPack);

    this.hooksRegistered = true;
  }

  /**
   * Invalidate by deleting the persisted file so the next read rebuilds — but
   * only when the `autoRebuildIndex` setting is on. Best-effort: a missing file
   * or a failed delete is ignored.
   */
  private async invalidateIndex(): Promise<void> {
    try {
      if (!game.settings.get(this.moduleId, 'autoRebuildIndex')) {
        return;
      }
      try {
        if (await this.indexFileExists()) {
          await fetch(this.indexFilePath(), { method: 'DELETE' });
        }
      } catch {
        // File doesn't exist or deletion failed — that's okay.
      }
    } catch (error) {
      console.warn(`[${this.moduleId}] Failed to invalidate index:`, error);
    }
  }

  // ---- build ----------------------------------------------------------------

  /**
   * Build the index, routed by system. D&D 5e is the only supported system;
   * anything else throws. A non-forced build is rejected while one is in flight.
   */
  private async buildEnhancedIndex(force = false): Promise<EnhancedCreatureIndex[]> {
    if (this.buildInProgress && !force) {
      throw new Error('Index build already in progress');
    }

    const gameSystem = (game as any).system.id;
    console.log(`[${this.moduleId}] Building enhanced creature index for system: ${gameSystem}`);

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
    this.buildInProgress = true;

    const startTime = Date.now();
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

          const { creatures: packCreatures, errors } = await this.extractDnD5eDataFromPack(pack);
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
          packFingerprints,
          totalCreatures: creatures.length,
          gameSystem: 'dnd5e',
        },
        creatures,
      };
      await this.savePersistedIndex(persistentIndex);

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
      ui.notifications?.error(errorMessage);
      throw error;
    } finally {
      this.buildInProgress = false;
      notifier.clear();
    }
  }

  /**
   * Extract every creature record from one pack. A pack-level load failure
   * yields no creatures (and one error) so the build continues; per-document
   * extraction failures are absorbed by {@link extractDnD5eCreatureData}.
   */
  private async extractDnD5eDataFromPack(
    pack: any
  ): Promise<{ creatures: DnD5eCreatureIndex[]; errors: number }> {
    const creatures: DnD5eCreatureIndex[] = [];
    let errors = 0;

    try {
      const documents = await pack.getDocuments();
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

    return { creatures, errors };
  }

  /**
   * Flatten one creature document into an index record. Every field read is
   * defensive (system data shapes vary across modules/versions); on any failure
   * it returns a safe fallback record (counted as one extraction error) rather
   * than dropping the creature. Reads the canonical `_id` field.
   */
  private extractDnD5eCreatureData(
    doc: any,
    pack: any
  ): { creature: DnD5eCreatureIndex; errors: number } {
    try {
      const system = doc.system || {};

      // Challenge rating — many shapes; null/strings normalized to a number.
      let challengeRating =
        system.details?.cr ??
        system.details?.cr?.value ??
        system.cr?.value ??
        system.cr ??
        system.attributes?.cr?.value ??
        system.attributes?.cr ??
        system.challenge?.rating ??
        system.challenge?.cr ??
        0;
      if (challengeRating === null || challengeRating === undefined) {
        challengeRating = 0;
      }
      if (typeof challengeRating === 'string') {
        if (challengeRating === '1/8') challengeRating = 0.125;
        else if (challengeRating === '1/4') challengeRating = 0.25;
        else if (challengeRating === '1/2') challengeRating = 0.5;
        else challengeRating = parseFloat(challengeRating) || 0;
      }
      challengeRating = Number(challengeRating) || 0;

      // Creature type — nullish/empty coalesced to 'unknown', forced to string.
      let creatureType =
        system.details?.type?.value ??
        system.details?.type ??
        system.type?.value ??
        system.type ??
        system.race?.value ??
        system.race ??
        system.details?.race ??
        'unknown';
      if (creatureType === null || creatureType === undefined || creatureType === '') {
        creatureType = 'unknown';
      }
      if (typeof creatureType !== 'string') {
        creatureType = String(creatureType || 'unknown');
      }

      // Size — first truthy candidate, defaulting to 'medium'.
      let size =
        system.traits?.size?.value ||
        system.traits?.size ||
        system.size?.value ||
        system.size ||
        system.details?.size ||
        'medium';
      if (typeof size !== 'string') {
        size = String(size || 'medium');
      }

      const hitPoints =
        system.attributes?.hp?.max ||
        system.hp?.max ||
        system.attributes?.hp?.value ||
        system.hp?.value ||
        system.health?.max ||
        system.health?.value ||
        0;

      const armorClass =
        system.attributes?.ac?.value ||
        system.ac?.value ||
        system.attributes?.ac ||
        system.ac ||
        system.armor?.value ||
        system.armor ||
        10;

      let alignment =
        system.details?.alignment?.value ||
        system.details?.alignment ||
        system.alignment?.value ||
        system.alignment ||
        'unaligned';
      if (typeof alignment !== 'string') {
        alignment = String(alignment || 'unaligned');
      }

      const hasSpells = !!(
        system.spells ||
        system.attributes?.spellcasting ||
        (system.details?.spellLevel && system.details.spellLevel > 0) ||
        (system.resources?.spell && system.resources.spell.max > 0) ||
        system.spellcasting ||
        system.traits?.spellcasting ||
        system.details?.spellcaster
      );

      const hasLegendaryActions = !!(
        system.resources?.legact ||
        system.legendary ||
        (system.resources?.legres && system.resources.legres.value > 0) ||
        system.details?.legendary ||
        system.traits?.legendary ||
        (system.resources?.legendary && system.resources.legendary.max > 0)
      );

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
          description: doc.system?.details?.biography || doc.system?.description || '',
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

  /** Safe default record used when extraction throws (fallback HP is 1, not 0). */
  private fallbackRecord(doc: any, pack: any): DnD5eCreatureIndex {
    return {
      id: doc._id,
      name: doc.name,
      type: doc.type,
      pack: pack.metadata.id,
      packLabel: pack.metadata.label,
      challengeRating: 0,
      creatureType: 'unknown',
      size: 'medium',
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
