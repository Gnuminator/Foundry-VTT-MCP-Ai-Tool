import { MODULE_ID } from '../constants.js';
import type {
  DnD5eCreatureIndex,
  EnhancedCreatureIndex,
  PackFingerprint,
  PersistentEnhancedIndex,
} from './types.js';

/**
 * Persistent Enhanced Creature Index System
 * Stores pre-computed creature data in JSON file within Foundry world directory for instant filtering
 * Uses file-based storage following Foundry best practices for large data sets
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

  /**
   * Get the file path for the enhanced creature index
   */
  private getIndexFilePath(): string {
    // Store in world data directory using world ID
    return `worlds/${game.world.id}/${this.INDEX_FILENAME}`;
  }

  /**
   * Get or build the enhanced creature index
   */
  async getEnhancedIndex(): Promise<EnhancedCreatureIndex[]> {
    // Check if we have a valid persistent index
    const existingIndex = await this.loadPersistedIndex();

    if (existingIndex && this.isIndexValid(existingIndex)) {
      return existingIndex.creatures;
    }

    // Build new index if needed
    return await this.buildEnhancedIndex();
  }

  /**
   * Force rebuild of the enhanced index
   */
  async rebuildIndex(): Promise<EnhancedCreatureIndex[]> {
    return await this.buildEnhancedIndex(true);
  }

  /**
   * Load persisted index from JSON file
   */
  private async loadPersistedIndex(): Promise<PersistentEnhancedIndex | null> {
    try {
      const filePath = this.getIndexFilePath();

      // Check if file exists using Foundry's FilePicker
      let fileExists = false;
      try {
        const browseResult = await (
          foundry as any
        ).applications.apps.FilePicker.implementation.browse('data', `worlds/${game.world.id}`);
        fileExists = browseResult.files.some((f: any) => f.endsWith(this.INDEX_FILENAME));
      } catch (error) {
        // Directory doesn't exist or other error, return null
        return null;
      }

      if (!fileExists) {
        return null;
      }

      // Load file content
      const response = await fetch(filePath);
      if (!response.ok) {
        console.warn(`[${this.moduleId}] Failed to load index file: ${response.status}`);
        return null;
      }

      const rawData = await response.json();

      // Convert Map data back from JSON
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
   * Save enhanced index to JSON file
   */
  private async savePersistedIndex(index: PersistentEnhancedIndex): Promise<void> {
    try {
      // Convert Map to Array for JSON serialization
      const saveData = {
        ...index,
        metadata: {
          ...index.metadata,
          packFingerprints: Array.from(index.metadata.packFingerprints.entries()),
        },
      };

      const jsonContent = JSON.stringify(saveData, null, 2);

      // Create a File object and upload it using Foundry's file system
      const file = new File([jsonContent], this.INDEX_FILENAME, { type: 'application/json' });

      // Upload the file to the world directory
      const uploadResponse = await (
        foundry as any
      ).applications.apps.FilePicker.implementation.upload('data', `worlds/${game.world.id}`, file);

      if (!uploadResponse) {
        throw new Error('File upload failed');
      }
    } catch (error) {
      console.error(`[${this.moduleId}] Failed to save enhanced index to file:`, error);
      throw error;
    }
  }

  /**
   * Check if existing index is valid (all packs unchanged)
   */
  private isIndexValid(existingIndex: PersistentEnhancedIndex): boolean {
    // Check version
    if (existingIndex.metadata.version !== this.INDEX_VERSION) {
      return false;
    }

    // NEW: Check system compatibility
    const currentSystem = (game as any).system.id;
    if (existingIndex.metadata.gameSystem !== currentSystem) {
      console.log(
        `[${this.moduleId}] System changed from ${existingIndex.metadata.gameSystem} to ${currentSystem}, index invalidated`
      );
      return false;
    }

    // Check each pack fingerprint
    const actorPacks = Array.from(game.packs.values()).filter(
      pack => pack.metadata.type === 'Actor'
    );

    for (const pack of actorPacks) {
      const currentFingerprint = this.generatePackFingerprint(pack);
      const savedFingerprint = existingIndex.metadata.packFingerprints.get(pack.metadata.id);

      if (!savedFingerprint) {
        return false;
      }

      if (!this.fingerprintsMatch(currentFingerprint, savedFingerprint)) {
        return false;
      }
    }

    // Check if any saved packs no longer exist
    for (const [packId] of existingIndex.metadata.packFingerprints) {
      if (!game.packs.get(packId)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Register Foundry hooks for real-time pack change detection
   */
  private registerFoundryHooks(): void {
    if (this.hooksRegistered) return;

    // Listen for compendium document changes
    Hooks.on('createDocument', (document: any) => {
      if (
        document.pack &&
        (document.type === 'npc' || document.type === 'character' || document.type === 'creature')
      ) {
        void this.invalidateIndex();
      }
    });

    Hooks.on('updateDocument', (document: any) => {
      if (
        document.pack &&
        (document.type === 'npc' || document.type === 'character' || document.type === 'creature')
      ) {
        void this.invalidateIndex();
      }
    });

    Hooks.on('deleteDocument', (document: any) => {
      if (
        document.pack &&
        (document.type === 'npc' || document.type === 'character' || document.type === 'creature')
      ) {
        void this.invalidateIndex();
      }
    });

    // Listen for pack creation/deletion
    Hooks.on('createCompendium', (pack: any) => {
      if (pack.metadata.type === 'Actor') {
        void this.invalidateIndex();
      }
    });

    Hooks.on('deleteCompendium', (pack: any) => {
      if (pack.metadata.type === 'Actor') {
        void this.invalidateIndex();
      }
    });

    this.hooksRegistered = true;
  }

  /**
   * Invalidate the current index (mark for rebuild on next access)
   */
  private async invalidateIndex(): Promise<void> {
    try {
      // Check if auto-rebuild is enabled
      const autoRebuild = game.settings.get(this.moduleId, 'autoRebuildIndex');

      if (!autoRebuild) {
        return;
      }

      // Delete the index file to force rebuild
      const filePath = this.getIndexFilePath();

      try {
        // Check if file exists first by trying to browse to the world directory
        const browseResult = await (
          foundry as any
        ).applications.apps.FilePicker.implementation.browse('data', `worlds/${game.world.id}`);
        const fileExists = browseResult.files.some((f: any) => f.endsWith(this.INDEX_FILENAME));

        if (fileExists) {
          // File exists, delete it using fetch with DELETE method
          await fetch(filePath, { method: 'DELETE' });
          // File deletion completed (or failed silently)
        }
      } catch (error) {
        // File doesn't exist or deletion failed - that's okay
      }
    } catch (error) {
      console.warn(`[${this.moduleId}] Failed to invalidate index:`, error);
    }
  }

  /**
   * Generate fingerprint for pack change detection with improved accuracy
   */
  private generatePackFingerprint(pack: any): PackFingerprint {
    // Get actual modification time if available
    let lastModified = Date.now();
    if (pack.metadata.lastModified) {
      lastModified = new Date(pack.metadata.lastModified).getTime();
    }

    return {
      packId: pack.metadata.id,
      packLabel: pack.metadata.label,
      lastModified,
      documentCount: pack.index?.size || 0,
      checksum: this.generatePackChecksum(pack),
    };
  }

  /**
   * Generate checksum for pack contents
   */
  private generatePackChecksum(pack: any): string {
    // Simple checksum based on pack metadata and size
    const data = `${pack.metadata.id}-${pack.metadata.label}-${pack.index?.size || 0}`;
    return btoa(data).slice(0, 16); // Simple hash for demonstration
  }

  /**
   * Compare two pack fingerprints
   */
  private fingerprintsMatch(current: PackFingerprint, saved: PackFingerprint): boolean {
    return current.documentCount === saved.documentCount && current.checksum === saved.checksum;
  }

  /**
   * Build enhanced creature index from all Actor packs with detailed progress tracking
   */
  private async buildEnhancedIndex(force = false): Promise<EnhancedCreatureIndex[]> {
    if (this.buildInProgress && !force) {
      throw new Error('Index build already in progress');
    }

    // Detect game system ONCE at build time
    const gameSystem = (game as any).system.id;

    console.log(`[${this.moduleId}] Building enhanced creature index for system: ${gameSystem}`);

    // Route to D&D 5e builder (only supported system)
    if (gameSystem === 'dnd5e') {
      return await this.buildDnD5eIndex(force);
    } else {
      throw new Error(
        `Enhanced creature index is only supported for D&D 5e (detected system: ${gameSystem}).`
      );
    }
  }

  /**
   * Build D&D 5e enhanced creature index
   */
  private async buildDnD5eIndex(_force = false): Promise<DnD5eCreatureIndex[]> {
    this.buildInProgress = true;

    const startTime = Date.now();
    let progressNotification: any = null;
    let totalErrors = 0; // Track extraction errors

    try {
      const actorPacks = Array.from(game.packs.values()).filter(
        pack => pack.metadata.type === 'Actor'
      );
      const enhancedCreatures: DnD5eCreatureIndex[] = [];
      const packFingerprints = new Map<string, PackFingerprint>();

      // Show initial progress notification
      ui.notifications?.info(
        `Starting enhanced creature index build from ${actorPacks.length} packs...`
      );

      for (let i = 0; i < actorPacks.length; i++) {
        const pack = actorPacks[i];
        const progressPercent = Math.round((i / actorPacks.length) * 100);

        // Update progress notification every few packs or for important packs
        if (i % 3 === 0 || pack.metadata.label.toLowerCase().includes('monster')) {
          if (progressNotification) {
            progressNotification.remove();
          }
          progressNotification = ui.notifications?.info(
            `Building creature index... ${progressPercent}% (${i + 1}/${actorPacks.length}) Processing: ${pack.metadata.label}`
          );
        }

        try {
          // Ensure pack index is loaded
          if (!pack.indexed) {
            await pack.getIndex({});
          }

          // Generate pack fingerprint for change detection
          packFingerprints.set(pack.metadata.id, this.generatePackFingerprint(pack));

          // Show pack processing details for large packs
          const packSize = pack.index?.size || 0;
          if (packSize > 50) {
            if (progressNotification) {
              progressNotification.remove();
            }
            progressNotification = ui.notifications?.info(
              `Processing large pack: ${pack.metadata.label} (${packSize} documents)...`
            );
          }

          // Process creatures in this pack
          const packResult = await this.extractDnD5eDataFromPack(pack);
          enhancedCreatures.push(...packResult.creatures);
          totalErrors += packResult.errors;

          // Pack processing completed: ${pack.metadata.label} - ${packResult.creatures.length} creatures extracted

          // Show milestone notifications for significant progress
          if (i === 0 || (i + 1) % 5 === 0 || i === actorPacks.length - 1) {
            const totalCreaturesSoFar = enhancedCreatures.length;
            if (progressNotification) {
              progressNotification.remove();
            }
            progressNotification = ui.notifications?.info(
              `Index Progress: ${i + 1}/${actorPacks.length} packs complete, ${totalCreaturesSoFar} creatures indexed`
            );
          }
        } catch (error) {
          console.warn(`[${this.moduleId}] Failed to process pack ${pack.metadata.label}:`, error);
          // Show error notification for pack failures
          ui.notifications?.warn(
            `Warning: Failed to index pack "${pack.metadata.label}" - continuing with other packs`
          );
        }
      }

      // Clear progress notification and show final processing step
      if (progressNotification) {
        progressNotification.remove();
      }
      ui.notifications?.info(
        `Saving enhanced index to world database... (${enhancedCreatures.length} creatures)`
      );

      // Create persistent index structure
      const persistentIndex: PersistentEnhancedIndex = {
        metadata: {
          version: this.INDEX_VERSION,
          timestamp: Date.now(),
          packFingerprints,
          totalCreatures: enhancedCreatures.length,
          gameSystem: 'dnd5e', // Mark as D&D 5e index
        },
        creatures: enhancedCreatures,
      };

      // Save to world flags
      await this.savePersistedIndex(persistentIndex);

      const buildTimeSeconds = Math.round((Date.now() - startTime) / 1000);
      const errorText = totalErrors > 0 ? ` (${totalErrors} extraction errors)` : '';
      const successMessage = `Enhanced creature index complete! ${enhancedCreatures.length} creatures indexed from ${actorPacks.length} packs in ${buildTimeSeconds}s${errorText}`;

      ui.notifications?.info(successMessage);

      return enhancedCreatures;
    } catch (error) {
      // Clear any progress notifications on error
      if (progressNotification) {
        progressNotification.remove();
      }

      const errorMessage = `Failed to build enhanced creature index: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(`[${this.moduleId}] ${errorMessage}`);
      ui.notifications?.error(errorMessage);

      throw error;
    } finally {
      this.buildInProgress = false;

      // Ensure progress notification is cleared
      if (progressNotification) {
        progressNotification.remove();
      }
    }
  }

  /**
   * Extract D&D 5e data from all documents in a pack
   */
  private async extractDnD5eDataFromPack(
    pack: any
  ): Promise<{ creatures: DnD5eCreatureIndex[]; errors: number }> {
    const creatures: DnD5eCreatureIndex[] = [];
    let errors = 0;

    try {
      // Load all documents from pack
      const documents = await pack.getDocuments();

      for (const doc of documents) {
        try {
          // Only process NPCs, characters, and creatures
          if (doc.type !== 'npc' && doc.type !== 'character' && doc.type !== 'creature') {
            continue;
          }

          const result = this.extractDnD5eCreatureData(doc, pack);
          if (result) {
            creatures.push(result.creature);
            errors += result.errors;
          }
        } catch (error) {
          console.warn(
            `[${this.moduleId}] Failed to extract data from ${doc.name} in ${pack.metadata.label}:`,
            error
          );
          errors++;
        }
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
   * Extract D&D 5e creature data from a single document
   */
  private extractDnD5eCreatureData(
    doc: any,
    pack: any
  ): { creature: DnD5eCreatureIndex; errors: number } | null {
    try {
      const system = doc.system || {};

      // Extract challenge rating with comprehensive fallbacks
      // Based on debug logs: system.details.cr contains the actual value
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

      // Handle null values (spell effects, etc.)
      if (challengeRating === null || challengeRating === undefined) {
        challengeRating = 0;
      }

      if (typeof challengeRating === 'string') {
        if (challengeRating === '1/8') challengeRating = 0.125;
        else if (challengeRating === '1/4') challengeRating = 0.25;
        else if (challengeRating === '1/2') challengeRating = 0.5;
        else challengeRating = parseFloat(challengeRating) || 0;
      }

      // Ensure it's a number
      challengeRating = Number(challengeRating) || 0;

      // Extract creature type with proper type checking
      // Based on debug logs: system.details.type.value contains the actual value
      let creatureType =
        system.details?.type?.value ??
        system.details?.type ??
        system.type?.value ??
        system.type ??
        system.race?.value ??
        system.race ??
        system.details?.race ??
        'unknown';

      // Handle null/undefined values properly
      if (creatureType === null || creatureType === undefined || creatureType === '') {
        creatureType = 'unknown';
      }

      // Ensure creatureType is a string before calling toLowerCase()
      if (typeof creatureType !== 'string') {
        creatureType = String(creatureType || 'unknown');
      }

      // Extract size with proper type checking
      let size =
        system.traits?.size?.value ||
        system.traits?.size ||
        system.size?.value ||
        system.size ||
        system.details?.size ||
        'medium';

      // Ensure size is a string
      if (typeof size !== 'string') {
        size = String(size || 'medium');
      }

      // Extract hit points with more fallbacks
      const hitPoints =
        system.attributes?.hp?.max ||
        system.hp?.max ||
        system.attributes?.hp?.value ||
        system.hp?.value ||
        system.health?.max ||
        system.health?.value ||
        0;

      // Extract armor class with more fallbacks
      const armorClass =
        system.attributes?.ac?.value ||
        system.ac?.value ||
        system.attributes?.ac ||
        system.ac ||
        system.armor?.value ||
        system.armor ||
        10;

      // Extract alignment with proper type checking
      let alignment =
        system.details?.alignment?.value ||
        system.details?.alignment ||
        system.alignment?.value ||
        system.alignment ||
        'unaligned';

      // Ensure alignment is a string
      if (typeof alignment !== 'string') {
        alignment = String(alignment || 'unaligned');
      }

      // Check for spells with more comprehensive detection
      const hasSpells = !!(
        system.spells ||
        system.attributes?.spellcasting ||
        (system.details?.spellLevel && system.details.spellLevel > 0) ||
        (system.resources?.spell && system.resources.spell.max > 0) ||
        system.spellcasting ||
        system.traits?.spellcasting ||
        system.details?.spellcaster
      );

      // Check for legendary actions with more comprehensive detection
      const hasLegendaryActions = !!(
        system.resources?.legact ||
        system.legendary ||
        (system.resources?.legres && system.resources.legres.value > 0) ||
        system.details?.legendary ||
        system.traits?.legendary ||
        (system.resources?.legendary && system.resources.legendary.max > 0)
      );

      // DEBUG: Log what we extracted for comparison

      // Successful extraction
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

      // Return a basic fallback record with error count instead of null to avoid losing creatures
      return {
        creature: {
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
        },
        errors: 1,
      };
    }
  }
}
