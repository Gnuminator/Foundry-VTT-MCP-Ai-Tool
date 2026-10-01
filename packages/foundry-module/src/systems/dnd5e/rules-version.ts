/**
 * Rules-version tagging: 2014 vs 2024 D&D rules (plan step 0.5).
 *
 * Every write this module makes to an Actor or Item records which rules the
 * document follows in `flags.foundry-mcp-bridge.rules = {version, source, at}`,
 * and read tools surface it. The version is detected in this order:
 *
 * 1. An explicit GM choice passed by the caller (source `gm`).
 * 2. The document's `system.source.rules` (dnd5e renders from it). For an
 *    embedded Item imported by DDB-Importer the item-level value is unreliable
 *    (DDB copies it from an obsolete path), so the owning actor decides.
 * 3. DDB-Importer's `flags.ddbimporter.sourceId`: below 145 is a 2014 book.
 * 4. The world's dnd5e `rulesVersion` setting (`modern` = 2024,
 *    `legacy` = 2014), which is also what dnd5e defaults new documents to.
 *
 * Never write `flags.ddbimporter.*`: DDB-Importer reads its own flags there.
 */
import { MODULE_ID } from '../../constants.js';

export type RulesVersion = '2014' | '2024';

export type RulesSource = 'gm' | 'system.source.rules' | 'ddbimporter.sourceId' | 'world-setting';

export interface RulesDetection {
  version: RulesVersion;
  source: RulesSource;
}

/** The stored tag: detection plus when it was written. */
export interface RulesTag extends RulesDetection {
  at: string;
}

/** DDB-Importer sourceIds below this are 2014 books (MM 2024 is 147). */
const DDB_FIRST_2024_SOURCE_ID = 145;

/** Path of the tag, for updates. */
export const RULES_FLAG_PATH = `flags.${MODULE_ID}.rules`;

type RulesDocument = Actor | Item;

function isRulesVersion(value: unknown): value is RulesVersion {
  return value === '2014' || value === '2024';
}

function ddbFlags(doc: RulesDocument): Record<string, unknown> | undefined {
  return doc.flags?.ddbimporter;
}

/** The world default from dnd5e's `rulesVersion` setting, if readable. */
export function worldRulesVersion(): RulesVersion | null {
  try {
    const setting: unknown = game.settings.get('dnd5e', 'rulesVersion');
    if (setting === 'modern') return '2024';
    if (setting === 'legacy') return '2014';
  } catch {
    // Setting not registered (not dnd5e, or too early in startup).
  }
  return null;
}

/** Detect the rules version of an Actor or Item (see the order above). */
export function detectRulesVersion(
  doc: RulesDocument,
  gmChoice?: RulesVersion
): RulesDetection | null {
  if (gmChoice !== undefined) {
    if (!isRulesVersion(gmChoice)) throw new Error(`Unknown rules version: ${String(gmChoice)}`);
    return { version: gmChoice, source: 'gm' };
  }
  if (doc.documentName === 'Item') {
    const owner = (doc as Item).actor;
    if (owner && ddbFlags(doc) !== undefined) return detectRulesVersion(owner);
  }
  const rules = (doc.system as { source?: { rules?: unknown } } | undefined)?.source?.rules;
  if (isRulesVersion(rules)) return { version: rules, source: 'system.source.rules' };
  const sourceId = ddbFlags(doc)?.sourceId;
  if (typeof sourceId === 'number' && Number.isFinite(sourceId) && sourceId > 0) {
    return {
      version: sourceId < DDB_FIRST_2024_SOURCE_ID ? '2014' : '2024',
      source: 'ddbimporter.sourceId',
    };
  }
  const world = worldRulesVersion();
  return world ? { version: world, source: 'world-setting' } : null;
}

/** The tag stored on a document, or null (also for malformed data). */
export function readRulesTag(doc: FoundryDocument): RulesTag | null {
  const raw = doc.flags?.[MODULE_ID]?.rules as Partial<RulesTag> | undefined;
  if (!raw || !isRulesVersion(raw.version) || typeof raw.source !== 'string') return null;
  return { version: raw.version, source: raw.source, at: typeof raw.at === 'string' ? raw.at : '' };
}

/**
 * The update fragment that tags `doc`, or `{}` when the version cannot be
 * determined. Merge it into the same update as the change it accompanies.
 */
export function rulesTagUpdate(
  doc: RulesDocument,
  gmChoice?: RulesVersion,
  at: string = new Date().toISOString()
): Record<string, unknown> {
  const detection = detectRulesVersion(doc, gmChoice);
  if (!detection) return {};
  const tag: RulesTag = { ...detection, at };
  return { [RULES_FLAG_PATH]: tag };
}

/**
 * Like {@link rulesTagUpdate}, but `{}` when the document already carries a tag with the same
 * version and source. Guarded writes use it so a second change to the same actor does not rewrite
 * the tag's timestamp, which would make the undo of the first change report a false conflict.
 */
export function rulesTagUpdateIfChanged(
  doc: RulesDocument,
  gmChoice?: RulesVersion,
  at: string = new Date().toISOString()
): Record<string, unknown> {
  const update = rulesTagUpdate(doc, gmChoice, at);
  const next = update[RULES_FLAG_PATH] as RulesTag | undefined;
  const current = readRulesTag(doc as unknown as FoundryDocument);
  if (next && current && current.version === next.version && current.source === next.source) {
    return {};
  }
  return update;
}

/** The rules tag to put into creation data for a new Actor or Item. */
export function rulesTagForCreate(
  data: { system?: { source?: { rules?: unknown } }; flags?: Record<string, unknown> },
  gmChoice?: RulesVersion,
  at: string = new Date().toISOString()
): RulesTag | null {
  const pseudo = {
    documentName: 'Actor',
    system: data.system ?? {},
    flags: data.flags ?? {},
  } as unknown as Actor;
  const detection = detectRulesVersion(pseudo, gmChoice);
  return detection ? { ...detection, at } : null;
}
