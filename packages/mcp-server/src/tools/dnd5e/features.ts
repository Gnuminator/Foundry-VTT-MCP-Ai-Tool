import { NPCS_ONLY, toolRef } from '@gnuminator/shared';
import { z } from 'zod';
import { FoundryClient } from '../../foundry-client.js';
import { Logger } from '../../logger.js';
import { ErrorHandler } from '../../utils/error-handler.js';
import { detectGameSystem, getCachedSystemId } from '../../utils/system-detection.js';
import { arr, at, type Rec } from '../../systems/data.js';

// ---------------------------------------------------------------------------
// Options interface
// ---------------------------------------------------------------------------

export interface DnD5eFeaturesFromCompendiumToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

// ---------------------------------------------------------------------------
// Tool class
// ---------------------------------------------------------------------------

export class DnD5eFeaturesFromCompendiumTools {
  private foundryClient: FoundryClient;
  private logger: Logger;
  private errorHandler: ErrorHandler;

  constructor({ foundryClient, logger }: DnD5eFeaturesFromCompendiumToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'DnD5eFeaturesFromCompendiumTools' });
    this.errorHandler = new ErrorHandler(this.logger);
  }

  getToolDefinitions(): { name: string; description: string; inputSchema: object }[] {
    return [
      {
        name: 'dnd5e-add-features-from-compendium',
        description:
          'Direct write. D&D 5e only. Import monster features and class features by name from a compendium ' +
          'pack onto an actor (NPC or PC), copied as they are in the compendium. ' +
          'Examples: "Pack Tactics", "Multiattack", "Action Surge", "Font of Magic". ' +
          'Names must be exact (any case) and in English: translate them first.\n' +
          'compendiumPacks is searched in order, first match wins. Default ["dnd5e.monsterfeatures", "dnd5e.classfeatures"] ' +
          'is the 2014 SRD; ["dnd5e.monsterfeatures24"] is 2024 monster features only.\n' +
          'Not for: spells or spell slots (use dnd5e-add-feature with featureType "spells" or "spellcasting"); ' +
          '2024 class features (they live inside the class items, so this cannot import them); homebrew.\n' +
          'Returns a report: added, skipped (already on the actor), not found, failed.\n' +
          'Find the actorIdentifier with list-characters or get-character.',
        inputSchema: {
          type: 'object',
          properties: {
            actorIdentifier: {
              type: 'string',
              description: 'Name or ID of the target actor (partial name match supported)',
              ...toolRef('actor', 'id', { filter: NPCS_ONLY }),
            },
            featureNames: {
              type: 'array',
              description:
                'English feature names to import (exact match, case-insensitive). ' +
                'Maximum 50 per call.',
              minItems: 1,
              maxItems: 50,
              items: { type: 'string', minLength: 1 },
              ...toolRef('compendium-entry', 'name', {
                filter: { documentName: 'Item', types: ['feat'] },
              }),
            },
            compendiumPacks: {
              type: 'array',
              description:
                'Pack IDs to search in order, first match wins. Default ["dnd5e.monsterfeatures", "dnd5e.classfeatures"] ' +
                '(SRD 2014); "dnd5e.monsterfeatures24" for 2024 monster features.',
              items: { type: 'string', minLength: 1 },
              default: ['dnd5e.monsterfeatures', 'dnd5e.classfeatures'],
              ...toolRef('compendium-pack', 'id', { filter: { documentName: 'Item' } }),
            },
          },
          required: ['actorIdentifier', 'featureNames'],
        },
      },
    ];
  }

  async handleAddFeaturesFromCompendium(args: unknown): Promise<unknown> {
    const schema = z.object({
      actorIdentifier: z.string().min(1, 'actorIdentifier cannot be empty'),
      featureNames: z.array(z.string().min(1)).min(1).max(50),
      compendiumPacks: z
        .array(z.string().min(1))
        .default(['dnd5e.monsterfeatures', 'dnd5e.classfeatures']),
    });

    const parsed = schema.parse(args);

    this.logger.info('Adding features to D&D 5e actor from compendium', {
      actorIdentifier: parsed.actorIdentifier,
      featureCount: parsed.featureNames.length,
      packs: parsed.compendiumPacks,
    });

    try {
      const system = await detectGameSystem(this.foundryClient, this.logger);
      if (system !== 'dnd5e') {
        throw new Error(
          `dnd5e-add-features-from-compendium requires D&D 5e. ` +
            `Detected system: "${getCachedSystemId() ?? 'unknown'}".`
        );
      }

      const result = (await this.foundryClient.query(
        'foundry-mcp-bridge.addFeaturesFromCompendium',
        parsed
      )) as Rec;

      this.logger.info('Features import complete', {
        actorId: at(result, 'actor', 'id'),
        added: arr(result.added).length,
        skipped: arr(result.skipped).length,
        notFound: arr(result.notFound).length,
        failed: arr(result.failed).length,
      });

      return this.formatResponse(result, parsed);
    } catch (error) {
      this.errorHandler.handleToolError(
        error,
        'dnd5e-add-features-from-compendium',
        'feature import'
      );
    }
  }

  private formatResponse(result: Rec, params: { featureNames: string[] }): Rec {
    const actor = result.actor as { id: string; name: string };
    const added = result.added as Array<{
      name: string;
      packId: string;
      packLabel: string;
      itemId: string;
    }>;
    const skipped = result.skipped as Array<{ name: string; reason: string }>;
    const notFound = result.notFound as string[];
    const failed = result.failed as Array<{ name: string; error: string }>;
    const warnings = result.warnings as string[];

    const totalRequested = params.featureNames.length;

    // ── Summary line ──────────────────────────────────────────────────────────
    const parts: string[] = [];
    if (added.length > 0) parts.push(`${added.length} added`);
    if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
    if (notFound.length > 0) parts.push(`${notFound.length} not found`);
    if (failed.length > 0) parts.push(`${failed.length} failed`);

    const statusIcon = failed.length > 0 ? '⚠️' : notFound.length > 0 ? '🔍' : '✅';
    const summary = `${statusIcon} Features imported to "${actor.name}" — ${
      parts.length > 0 ? parts.join(', ') : 'nothing changed'
    }`;

    // ── Sections ──────────────────────────────────────────────────────────────
    const lines: string[] = [
      `**Actor:** ${actor.name} (id: \`${actor.id}\`)`,
      `**Requested:** ${totalRequested} — Added: ${added.length}, Skipped: ${skipped.length}, Not found: ${notFound.length}${failed.length > 0 ? `, Failed: ${failed.length}` : ''}`,
    ];

    if (added.length > 0) {
      lines.push('\n✅ **Added:**');
      for (const f of added) {
        lines.push(`  - ${f.name} *(${f.packLabel}, item \`${f.itemId}\`)*`);
      }
    }

    if (skipped.length > 0) {
      lines.push('\n⏭️ **Skipped:**');
      for (const f of skipped) {
        lines.push(`  - ${f.name} — *${f.reason}*`);
      }
    }

    if (notFound.length > 0) {
      lines.push('\n❌ **Not found in compendium:**');
      for (const name of notFound) {
        lines.push(`  - ${name}`);
      }
    }

    if (failed.length > 0) {
      lines.push('\n⚠️ **Failed during import:**');
      for (const f of failed) {
        lines.push(`  - ${f.name} — *${f.error}*`);
      }
    }

    if (warnings.length > 0) {
      lines.push(`\n⚠️ **Warnings:**`);
      for (const w of warnings) {
        lines.push(`  - ${w}`);
      }
    }

    return {
      summary,
      success: added.length > 0 || (notFound.length === 0 && failed.length === 0),
      actor,
      added,
      skipped,
      notFound,
      failed,
      warnings,
      message: `${summary}\n\n${lines.join('\n')}`,
    };
  }
}
