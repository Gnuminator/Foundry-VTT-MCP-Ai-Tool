import { MODULE_ID } from '../constants.js';
import * as shared from './shared.js';

/** What the compendium import needs to find the actor and the packs to search. */
export interface CompendiumImportTarget {
  actorIdentifier: string;
  compendiumPacks?: string[] | undefined;
}

/** Input of {@link ActorCompendiumImportDataAccess.addSpellsToActor}. */
export interface AddSpellsToActorInput extends CompendiumImportTarget {
  spellNames: string[];
}

/** Input of {@link ActorCompendiumImportDataAccess.addFeaturesFromCompendium}. */
export interface AddFeaturesFromCompendiumInput extends CompendiumImportTarget {
  featureNames: string[];
}

/** Result of {@link ActorCompendiumImportDataAccess.addSpellsToActor} and {@link ActorCompendiumImportDataAccess.addFeaturesFromCompendium}. */
export interface CompendiumImportResult {
  actor: { id: string; name: string };
  added: Array<{ name: string; packId: string; packLabel: string; itemId: string }>;
  skipped: Array<{ name: string; reason: string }>;
  notFound: string[];
  failed: Array<{ name: string; error: string }>;
  warnings: string[];
}

/** The part of an item the compendium import's duplicate check reads. */
interface ImportableItem {
  type?: string | undefined;
  name?: string | undefined;
}

/**
 * Add spells or features from compendium packs to an actor, split out of
 * ActorBuilderDataAccess (which keeps the delegating public methods).
 */
export class ActorCompendiumImportDataAccess {
  // ---------------------------------------------------------------------------
  // Add spells from compendium packs to an actor
  // ---------------------------------------------------------------------------

  async addSpellsToActor(data: AddSpellsToActorInput): Promise<CompendiumImportResult> {
    return this.importFromCompendium(data, data.spellNames, {
      defaultPacks: ['dnd5e.spells'],
      noValidPacksMessage:
        'No valid compendium packs available — check the compendiumPacks parameter. ' +
        'Valid pack IDs for D&D 5e: "dnd5e.spells" (2014) or "dnd5e.spells24" (2024).',
      // Only an existing item of type 'spell' counts as a duplicate.
      isDuplicate: (i: ImportableItem, normalizedName: string) =>
        i.type === 'spell' && i.name?.toLowerCase() === normalizedName,
      operation: 'addSpellsToActor',
    });
  }

  // ---------------------------------------------------------------------------
  // Add features from compendium packs to an actor
  // ---------------------------------------------------------------------------

  async addFeaturesFromCompendium(
    data: AddFeaturesFromCompendiumInput
  ): Promise<CompendiumImportResult> {
    return this.importFromCompendium(data, data.featureNames, {
      defaultPacks: ['dnd5e.monsterfeatures', 'dnd5e.classfeatures'],
      noValidPacksMessage:
        'No valid compendium packs available — check the compendiumPacks parameter. ' +
        'Valid pack IDs for D&D 5e: "dnd5e.monsterfeatures" or "dnd5e.classfeatures" (2014), ' +
        '"dnd5e.monsterfeatures24" (2024 monster features). ' +
        'Note: 2024 class features are embedded in class items and cannot be imported with this tool.',
      // A feature name is semantically unique on an actor regardless of item type.
      isDuplicate: (i: ImportableItem, normalizedName: string) =>
        i.name?.toLowerCase() === normalizedName,
      operation: 'addFeaturesFromCompendium',
    });
  }

  /** Extract a human-readable message from an unknown thrown value. */
  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }

  /**
   * Shared compendium-import engine for {@link addSpellsToActor} /
   * {@link addFeaturesFromCompendium}. Deduplicates the requested names
   * (case-insensitive), indexes each requested Item-typed pack once, then per
   * name: skips on-actor duplicates (per `opts.isDuplicate`) and input
   * duplicates, resolves the name first-pack-wins, fetches the document, strips
   * its `_id`, and embeds it (per-item error isolation). Returns the
   * added/skipped/notFound/failed/warnings breakdown.
   */
  private async importFromCompendium(
    data: CompendiumImportTarget,
    names: string[],
    opts: {
      defaultPacks: string[];
      noValidPacksMessage: string;
      isDuplicate: (item: ImportableItem, normalizedName: string) => boolean;
      operation: string;
    }
  ): Promise<CompendiumImportResult> {
    shared.validateFoundryState();
    shared.requireDnd5e(opts.operation);

    try {
      const actor = shared.findActorByIdentifier(data.actorIdentifier);
      if (!actor) {
        throw new Error(`Actor not found: "${data.actorIdentifier}"`);
      }

      const compendiumPacks: string[] = data.compendiumPacks ?? opts.defaultPacks;
      const warnings: string[] = [];

      // Phase A: deduplicate input (case-insensitive).
      const seen = new Set<string>();
      const unique: string[] = [];
      const skipped: Array<{ name: string; reason: string }> = [];
      for (const name of names) {
        const key = name.toLowerCase();
        if (seen.has(key)) {
          skipped.push({ name, reason: 'duplicate in input' });
        } else {
          seen.add(key);
          unique.push(name);
        }
      }

      // Phase B: index each valid Item-typed pack once (lowercase name → _id).
      const packMaps: Array<{ packId: string; packLabel: string; nameMap: Map<string, string> }> =
        [];
      for (const packId of compendiumPacks) {
        const pack = game.packs.get(packId);
        if (!pack) {
          warnings.push(`Compendium pack "${packId}" not found — skipped`);
          continue;
        }
        if (pack.metadata.type !== 'Item') {
          warnings.push(
            `Pack "${packId}" has type "${pack.metadata.type}", expected "Item" — skipped`
          );
          continue;
        }
        if (!pack.indexed) {
          await pack.getIndex({});
        }
        const nameMap = new Map<string, string>();
        for (const entry of pack.index.values()) {
          if (entry.name) {
            nameMap.set(entry.name.toLowerCase(), entry._id);
          }
        }
        packMaps.push({ packId, packLabel: pack.metadata.label, nameMap });
      }

      if (packMaps.length === 0) {
        throw new Error(opts.noValidPacksMessage);
      }

      // Phase C: per-name search + import.
      const added: Array<{ name: string; packId: string; packLabel: string; itemId: string }> = [];
      const notFound: string[] = [];
      const failed: Array<{ name: string; error: string }> = [];

      for (const name of unique) {
        const normalizedName = name.toLowerCase();

        const existing = actor.items.find(i => opts.isDuplicate(i, normalizedName));
        if (existing) {
          skipped.push({ name, reason: 'already on actor' });
          continue;
        }

        // Resolve first-pack-wins.
        let found: { packId: string; packLabel: string; entryId: string } | null = null;
        for (const pm of packMaps) {
          const entryId = pm.nameMap.get(normalizedName);
          if (entryId) {
            found = { packId: pm.packId, packLabel: pm.packLabel, entryId };
            break;
          }
        }
        if (!found) {
          notFound.push(name);
          continue;
        }

        const pack = game.packs.get(found.packId) as CompendiumCollection<Item>;
        const document = await pack.getDocument(found.entryId);
        if (!document) {
          // In the index but the document is missing (defensive).
          notFound.push(name);
          warnings.push(
            `"${name}" found in index but document missing in pack "${found.packId}" — skipped`
          );
          continue;
        }

        const itemData = document.toObject() as Record<string, unknown>;
        delete itemData._id; // Let Foundry assign a fresh local id; prevents id clash.

        try {
          const [created] = (await actor.createEmbeddedDocuments('Item', [itemData])) as Item[];
          added.push({
            name,
            packId: found.packId,
            packLabel: found.packLabel,
            itemId: created.id,
          });
        } catch (embedErr) {
          failed.push({ name, error: this.errorMessage(embedErr) });
        }
      }

      return {
        actor: { id: actor.id, name: actor.name },
        added,
        skipped,
        notFound,
        failed,
        warnings,
      };
    } catch (error) {
      console.error(`[${MODULE_ID}] ${opts.operation} failed`, error);
      throw error;
    }
  }
}
