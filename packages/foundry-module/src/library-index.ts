/**
 * The Obsidian Library queries (docs/design/OBSIDIAN-O4-DESIGN.md section 13): compendium
 * content for the GM's vault. Read-only and GM-client only, like `getExportIndex`.
 *
 * - `getLibraryIndex({packs, after})`: the picked packs' documents from the pack index (no
 *   document loads), one row each with a signature over what the note shows at the top level
 *   (name, type, folder, image, `_stats.modifiedTime`). Actor packs give their NPCs; Item packs
 *   every item. Paged by an offset cursor.
 * - `getLibraryDocuments({uuids})`: the full content of up to 40 documents: facts (spell level
 *   and school, rarity, hit die, prerequisites, ...), the raw description HTML (the backend
 *   rewrites the enrichers), an NPC's stat block, and advancement links (the features a class
 *   or subclass grants).
 *
 * Licensed book content passes through here into the GM's vault only. The wire contract is
 * `shared/src/library-index.ts` (types imported, constants mirrored and pinned by
 * `library-index.contract.test.ts`).
 */
import type {
  LibraryDocument,
  LibraryDocumentsResponse,
  LibraryFact,
  LibraryIndexResponse,
  LibraryIndexRow,
  LibraryLink,
  LibraryPackInfo,
  RulesTag,
} from '@gnuminator/shared';

import {
  clip,
  compare,
  dig,
  fitJsonBytes,
  nonEmpty,
  num,
  rec,
  signature,
  sourceName,
  str,
  utf8Bytes,
  type Rec,
} from './doc-read.js';
import { foundryOrigin, imagePath } from './export-index.js';
import { buildStatBlock } from './stat-block.js';

// ---------------------------------------------------------------------------
// Mirrored contract values (pinned by library-index.contract.test.ts)
// ---------------------------------------------------------------------------

export const LIBRARY_INDEX_QUERY = 'getLibraryIndex';
export const LIBRARY_DOCUMENTS_QUERY = 'getLibraryDocuments';
export const LIBRARY_SCHEMA = 1;

/** Pattern source of a compendium pack id (mirror of the shared `LIBRARY_PACK_ID_PATTERN`). */
export const LIBRARY_PACK_ID_PATTERN = '^[A-Za-z0-9][\\w-]{0,63}\\.[\\w-]{1,64}$';

export const LIBRARY_LIMITS = {
  packs: 100,
  indexPageMax: 1000,
  indexPageBytes: 512 * 1024,
  documentsPerRequest: 40,
  descriptionBytes: 256 * 1024,
  responseBudgetBytes: 1536 * 1024,
  linksPerDocument: 300,
  factsPerDocument: 30,
} as const;

const PACK_ID = new RegExp(LIBRARY_PACK_ID_PATTERN);
const COMPENDIUM_UUID = /^Compendium\.[\w-]+\.[\w-]+\.(Actor|Item)\.[A-Za-z0-9]{16}$/;
/** `<index of the pack in the request>:<document id>`: the last row of the previous page. */
const CURSOR = /^(\d{1,3}):([A-Za-z0-9]{16})$/;
const INDEX_FIELDS = [
  'system.type.value',
  'system.identifier',
  'system.classIdentifier',
  '_stats.modifiedTime',
  // The whole `system.source` object: asking for `system.source.rules` fails in Foundry's index
  // builder when an old document stores `source` as a plain value.
  'system.source',
  'folder',
];

interface Failure {
  success: false;
  error: string;
}

function worldId(): string {
  return str(dig(globalThis, 'game', 'world', 'id')) ?? '';
}

function isGm(): boolean {
  return dig(globalThis, 'game', 'user', 'isGM') === true;
}

function packsCollection(): Rec | null {
  return rec(dig(globalThis, 'game', 'packs'));
}

function getPack(id: string): Rec | null {
  const packs = packsCollection();
  const get = packs?.get;
  return typeof get === 'function' ? rec((get as (k: string) => unknown).call(packs, id)) : null;
}

function allPacks(): Rec[] {
  const packs = packsCollection();
  const contents = packs?.contents;
  if (Array.isArray(contents)) return (contents as unknown[]).map(rec).filter((p): p is Rec => !!p);
  const values = packs?.values;
  if (typeof values === 'function') {
    return [...(values as () => Iterable<unknown>).call(packs)]
      .map(rec)
      .filter((p): p is Rec => !!p);
  }
  return [];
}

function packId(pack: Rec): string {
  return str(pack.collection) ?? '';
}

function packInfo(pack: Rec, total: number): LibraryPackInfo {
  const metadata = rec(pack.metadata) ?? {};
  return {
    id: packId(pack),
    label: clip(str(metadata.label) ?? str(pack.title) ?? packId(pack)),
    documentName: str(pack.documentName) ?? str(metadata.type) ?? '',
    packageType: str(metadata.packageType) ?? '',
    packageName: str(metadata.packageName) ?? '',
    total,
  };
}

// ---------------------------------------------------------------------------
// getLibraryIndex
// ---------------------------------------------------------------------------

/** The top-most folder name of an index entry that is not a rules grouping ("5e Core Rules"). */
function groupOf(pack: Rec, folderId: string | null): string | null {
  if (!folderId) return null;
  const folders = rec(pack.folders);
  const get = folders?.get;
  const folder =
    typeof get === 'function' ? rec((get as (k: string) => unknown).call(folders, folderId)) : null;
  if (!folder) return null;
  const ancestors = Array.isArray(folder.ancestors) ? (folder.ancestors as unknown[]) : [];
  const chain = [...ancestors.map(rec).filter((f): f is Rec => !!f)].reverse().concat(folder);
  const names = chain.map(f => str(f.name) ?? '').filter(name => name && !/\brules\b/i.test(name));
  return names[0] ? clip(names[0]) : null;
}

function clipped(value: string | null): string | null {
  return value === null ? null : clip(value);
}

async function indexRows(pack: Rec): Promise<LibraryIndexRow[]> {
  const getIndex = pack.getIndex;
  if (typeof getIndex !== 'function') return [];
  const index = await (getIndex as (o: unknown) => Promise<unknown>).call(pack, {
    fields: INDEX_FIELDS,
  });
  const entries: Rec[] = [];
  const indexRec = rec(index);
  const contents = indexRec?.contents;
  if (Array.isArray(contents)) {
    for (const entry of contents as unknown[]) {
      const r = rec(entry);
      if (r) entries.push(r);
    }
  } else if (
    index &&
    typeof (index as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function'
  ) {
    for (const entry of index as Iterable<unknown>) {
      const r = rec(entry);
      if (r) entries.push(r);
    }
  }
  const id = packId(pack);
  const documentName = str(pack.documentName) ?? '';
  const rows: LibraryIndexRow[] = [];
  for (const entry of entries) {
    const docId = nonEmpty(entry._id) ?? nonEmpty(entry.id);
    if (!docId || !/^[A-Za-z0-9]{16}$/.test(docId)) continue;
    const type = str(entry.type) ?? '';
    if (documentName === 'Actor' && type !== 'npc') continue;
    const name = clip(str(entry.name) ?? '');
    const subtype = clipped(nonEmpty(dig(entry, 'system', 'type', 'value')));
    const group = groupOf(pack, nonEmpty(entry.folder));
    const identifier = clipped(nonEmpty(dig(entry, 'system', 'identifier')));
    const classIdentifier = clipped(nonEmpty(dig(entry, 'system', 'classIdentifier')));
    const modified = num(dig(entry, '_stats', 'modifiedTime'));
    const img = imagePath(entry.img);
    const rulesRaw = nonEmpty(dig(entry, 'system', 'source', 'rules'));
    const rules = rulesRaw === '2014' || rulesRaw === '2024' ? rulesRaw : null;
    rows.push({
      uuid: `Compendium.${id}.${documentName}.${docId}`,
      pack: id,
      id: docId,
      name,
      type,
      subtype,
      group,
      identifier,
      classIdentifier,
      rules,
      sig: signature([
        name,
        type,
        subtype,
        group,
        identifier,
        classIdentifier,
        rules,
        img,
        modified,
      ]),
    });
  }
  return rows.sort((a, b) => compare(a.id, b.id));
}

/** One page of the Library index (GM clients only). */
export async function getLibraryIndex(data: unknown): Promise<LibraryIndexResponse | Failure> {
  if (!isGm()) return { success: false, error: 'Access denied' };
  const raw = rec(data) ?? {};
  const requested = Array.isArray(raw.packs) ? (raw.packs as unknown[]) : [];
  const ids = [
    ...new Set(requested.filter((p): p is string => typeof p === 'string' && PACK_ID.test(p))),
  ].slice(0, LIBRARY_LIMITS.packs);
  // The cursor names the last row of the previous page; the next page starts strictly after it,
  // so a document added or removed earlier in the order never makes a later one get skipped.
  const afterRaw = raw.after;
  let after: { pack: number; id: string } | null = null;
  if (afterRaw !== undefined && afterRaw !== null) {
    const match = typeof afterRaw === 'string' ? CURSOR.exec(afterRaw) : null;
    const packIndex = match ? Number(match[1]) : -1;
    if (!match || packIndex >= ids.length) return { success: false, error: 'Invalid cursor' };
    after = { pack: packIndex, id: match[2] ?? '' };
  }

  const packs: LibraryPackInfo[] = [];
  const missing: string[] = [];
  const rows: Array<{ pack: number; row: LibraryIndexRow }> = [];
  for (const [packIndex, id] of ids.entries()) {
    const pack = getPack(id);
    if (!pack) {
      missing.push(id);
      continue;
    }
    const documentName = str(pack.documentName) ?? '';
    const packRows =
      documentName === 'Actor' || documentName === 'Item' ? await indexRows(pack) : [];
    packs.push(packInfo(pack, packRows.length));
    for (const row of packRows) rows.push({ pack: packIndex, row });
  }
  // Rows are in request pack order, then document id: the cursor order.
  const start = after
    ? rows.findIndex(
        entry =>
          entry.pack > after.pack ||
          (entry.pack === after.pack && compare(entry.row.id, after.id) > 0)
      )
    : 0;
  const page: LibraryIndexRow[] = [];
  let bytes = 0;
  let end = start < 0 ? rows.length : start;
  while (end < rows.length && page.length < LIBRARY_LIMITS.indexPageMax) {
    const entry = rows[end];
    if (!entry) break;
    const size = utf8Bytes(JSON.stringify(entry.row)) + 1;
    if (page.length > 0 && bytes + size > LIBRARY_LIMITS.indexPageBytes) break;
    page.push(entry.row);
    bytes += size;
    end += 1;
  }
  const last = page.length > 0 ? rows[end - 1] : undefined;
  return {
    success: true,
    schema: LIBRARY_SCHEMA,
    worldId: worldId(),
    origin: foundryOrigin(),
    packs,
    missing,
    allPacks: allPacks()
      .map(pack => ({ id: packId(pack), documentName: str(pack.documentName) ?? '' }))
      .filter(pack => pack.id !== '')
      .sort((a, b) => compare(a.id, b.id)),
    entries: page,
    next: last && end < rows.length ? `${last.pack}:${last.row.id}` : null,
  };
}

// ---------------------------------------------------------------------------
// getLibraryDocuments: facts per type
// ---------------------------------------------------------------------------

function config(): Rec | null {
  return rec(dig(globalThis, 'CONFIG', 'DND5E'));
}

function localize(key: string): string {
  const i18n = rec(dig(globalThis, 'game', 'i18n'));
  const fn = i18n?.localize;
  if (typeof fn === 'function') {
    const text = (fn as (k: string) => unknown).call(i18n, key);
    if (typeof text === 'string') return text;
  }
  return key;
}

function configLabel(table: string, key: string | null): string | null {
  if (!key) return null;
  const entry = rec(config()?.[table])?.[key];
  const label = typeof entry === 'string' ? entry : str(rec(entry)?.label);
  return label ? localize(label) : null;
}

function text(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  const s = nonEmpty(value);
  return s ? clip(s.replace(/\s+/g, ' ').trim()) : null;
}

function setValues(value: unknown): string[] {
  if (value instanceof Set)
    return [...(value as Set<unknown>)].filter((v): v is string => typeof v === 'string');
  if (Array.isArray(value))
    return (value as unknown[]).filter((v): v is string => typeof v === 'string');
  return [];
}

function labelsOf(doc: Rec): Rec {
  return rec(doc.labels) ?? {};
}

function sourceText(doc: Rec): string | null {
  const source = rec(dig(doc, 'system', 'source'));
  if (!source) return null;
  const book = nonEmpty(source.book) ?? nonEmpty(source.label) ?? nonEmpty(source.custom);
  const page = nonEmpty(source.page);
  if (!book) return null;
  return clip(page ? `${book} p. ${page}` : book);
}

function rulesOf(doc: Rec): RulesTag | null {
  const rules = nonEmpty(dig(doc, 'system', 'source', 'rules'));
  return rules === '2014' || rules === '2024' ? rules : null;
}

function spellFacts(doc: Rec): LibraryFact[] {
  const labels = labelsOf(doc);
  const props = setValues(dig(doc, 'system', 'properties'));
  const level = num(dig(doc, 'system', 'level'));
  const materials = nonEmpty(dig(doc, 'system', 'materials', 'value'));
  const components = text(dig(labels, 'components', 'vsm'));
  const duration = text(labels.duration);
  return [
    {
      label: 'Level',
      value: text(labels.level) ?? (level === 0 ? 'Cantrip' : `Level ${level ?? '?'}`),
    },
    {
      label: 'School',
      value:
        text(labels.school) ??
        configLabel('spellSchools', nonEmpty(dig(doc, 'system', 'school'))) ??
        '',
    },
    { label: 'Casting Time', value: text(labels.activation) ?? '' },
    { label: 'Range', value: text(labels.range) ?? '' },
    { label: 'Target', value: text(labels.target) ?? '' },
    {
      label: 'Components',
      value: [components, materials ? `(${clip(materials)})` : null].filter(Boolean).join(' '),
    },
    {
      label: 'Duration',
      value: [props.includes('concentration') ? 'Concentration,' : null, duration]
        .filter(Boolean)
        .join(' '),
    },
    { label: 'Ritual', value: props.includes('ritual') ? 'Yes' : '' },
  ];
}

function physicalFacts(doc: Rec): LibraryFact[] {
  const labels = labelsOf(doc);
  const system = doc.system;
  const typeLabel =
    text(dig(system, 'type', 'label')) ?? configLabel('itemTypes', str(doc.type)) ?? text(doc.type);
  const rarityKey = nonEmpty(dig(system, 'rarity'));
  const attunement = nonEmpty(dig(system, 'attunement'));
  const props = Array.isArray(labels.properties)
    ? (labels.properties as unknown[]).map(p => text(rec(p)?.label)).filter((p): p is string => !!p)
    : [];
  const price = num(dig(system, 'price', 'value'));
  const denomination = nonEmpty(dig(system, 'price', 'denomination')) ?? 'gp';
  const weight = num(dig(system, 'weight', 'value'));
  const weightUnits = nonEmpty(dig(system, 'weight', 'units')) ?? 'lb';
  const damages = Array.isArray(labels.damages)
    ? (labels.damages as unknown[])
        .map(d => [text(rec(d)?.formula), text(rec(d)?.damageType)].filter(Boolean).join(' '))
        .filter(Boolean)
    : [];
  return [
    { label: 'Type', value: typeLabel ?? '' },
    { label: 'Rarity', value: configLabel('itemRarity', rarityKey) ?? text(rarityKey) ?? '' },
    {
      label: 'Attunement',
      value: attunement ? (configLabel('attunementTypes', attunement) ?? attunement) : '',
    },
    { label: 'Armor', value: text(labels.armor) ?? '' },
    { label: 'Damage', value: damages.join(', ') },
    { label: 'Properties', value: props.join(', ') },
    { label: 'Price', value: price ? `${price} ${denomination}` : '' },
    { label: 'Weight', value: weight ? `${weight} ${weightUnits}` : '' },
  ];
}

function classFacts(doc: Rec): LibraryFact[] {
  const system = doc.system;
  const hd = nonEmpty(dig(system, 'hd', 'denomination')) ?? nonEmpty(dig(system, 'hitDice'));
  const progression = nonEmpty(dig(system, 'spellcasting', 'progression'));
  const primary = setValues(dig(system, 'primaryAbility', 'value')).map(
    key => configLabel('abilities', key) ?? key
  );
  return [
    { label: 'Hit Die', value: hd ?? '' },
    { label: 'Primary Ability', value: primary.join(', ') },
    {
      label: 'Spellcasting',
      value:
        progression && progression !== 'none'
          ? (configLabel('spellProgression', progression) ?? progression)
          : '',
    },
  ];
}

function featFacts(doc: Rec): LibraryFact[] {
  const system = doc.system;
  const type = nonEmpty(dig(system, 'type', 'value'));
  const subtype = nonEmpty(dig(system, 'type', 'subtype'));
  const typeEntry = rec(rec(config()?.featureTypes)?.[type ?? '']);
  const typeLabel = str(typeEntry?.label);
  const subtypeLabel = subtype ? str(rec(typeEntry?.subtypes)?.[subtype]) : null;
  const level = num(dig(system, 'prerequisites', 'level'));
  return [
    {
      label: 'Type',
      value: [
        typeLabel ? localize(typeLabel) : type,
        subtypeLabel ? `(${localize(subtypeLabel)})` : null,
      ]
        .filter(Boolean)
        .join(' '),
    },
    { label: 'Requirements', value: text(dig(system, 'requirements')) ?? '' },
    { label: 'Prerequisite', value: level ? `Level ${level}` : '' },
    {
      label: 'Repeatable',
      value: dig(system, 'prerequisites', 'repeatable') === true ? 'Yes' : '',
    },
  ];
}

/** A number, or a plain numeric string (dnd5e 6 stores species speeds as deterministic formulas). */
function numeric(value: unknown): number | null {
  const direct = num(value);
  if (direct !== null) return direct;
  if (typeof value === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(value)) return Number(value);
  return null;
}

/** dnd5e 6: `system.movement.speeds.walk` and `system.senses.ranges.darkvision`; older: no nesting. */
function speciesFacts(doc: Rec): LibraryFact[] {
  const system = doc.system;
  const walk =
    numeric(dig(system, 'movement', 'speeds', 'walk')) ?? numeric(dig(system, 'movement', 'walk'));
  const walkUnits = nonEmpty(dig(system, 'movement', 'units')) ?? 'ft';
  const type = nonEmpty(dig(system, 'type', 'value'));
  const darkvision =
    numeric(dig(system, 'senses', 'ranges', 'darkvision')) ??
    numeric(dig(system, 'senses', 'darkvision'));
  const senseUnits = nonEmpty(dig(system, 'senses', 'units')) ?? 'ft';
  return [
    { label: 'Creature Type', value: configLabel('creatureTypes', type) ?? text(type) ?? '' },
    { label: 'Speed', value: walk ? `${walk} ${walkUnits}` : '' },
    { label: 'Darkvision', value: darkvision ? `${darkvision} ${senseUnits}` : '' },
  ];
}

function factsOf(doc: Rec): LibraryFact[] {
  let facts: LibraryFact[] = [];
  switch (doc.type) {
    case 'spell':
      facts = spellFacts(doc);
      break;
    case 'class':
      facts = classFacts(doc);
      break;
    case 'subclass':
      facts = [{ label: 'Class', value: text(dig(doc, 'system', 'classIdentifier')) ?? '' }];
      break;
    case 'feat':
      facts = featFacts(doc);
      break;
    case 'race':
      facts = speciesFacts(doc);
      break;
    case 'background':
    case 'npc':
      facts = [];
      break;
    default:
      facts = physicalFacts(doc);
  }
  const source = sourceText(doc);
  if (source) facts.push({ label: 'Source', value: source });
  return facts
    .filter(fact => fact.value.trim() !== '')
    .map(fact => ({ label: clip(fact.label), value: clip(fact.value) }))
    .slice(0, LIBRARY_LIMITS.factsPerDocument);
}

// ---------------------------------------------------------------------------
// getLibraryDocuments: advancement links
// ---------------------------------------------------------------------------

function indexName(uuid: string): string | null {
  const sync = dig(globalThis, 'fromUuidSync');
  if (typeof sync !== 'function') return null;
  try {
    const found = rec((sync as (u: string, o: unknown) => unknown)(uuid, { strict: false }));
    return found ? clip(str(found.name) ?? '') || null : null;
  } catch {
    return null;
  }
}

function linksOf(doc: Rec): LibraryLink[] {
  const raw = dig(doc, '_source', 'system', 'advancement');
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? Object.values(raw)
      : [];
  const links: LibraryLink[] = [];
  const seen = new Set<string>();
  const add = (uuid: unknown, level: number | null, kind: LibraryLink['kind']): void => {
    if (typeof uuid !== 'string' || !/^Compendium\./.test(uuid) || seen.has(uuid)) return;
    seen.add(uuid);
    links.push({ uuid, name: indexName(uuid), level, kind });
  };
  for (const value of list) {
    const advancement = rec(value);
    if (!advancement) continue;
    const configuration = rec(advancement.configuration) ?? {};
    const level = num(advancement.level);
    if (advancement.type === 'ItemGrant') {
      for (const item of Array.isArray(configuration.items)
        ? (configuration.items as unknown[])
        : []) {
        add(typeof item === 'string' ? item : rec(item)?.uuid, level, 'grant');
      }
    } else if (advancement.type === 'ItemChoice') {
      const choices = rec(configuration.choices) ?? {};
      const levels = Object.keys(choices)
        .map(Number)
        .filter(n => Number.isFinite(n));
      const first = levels.length ? Math.min(...levels) : level;
      for (const item of Array.isArray(configuration.pool)
        ? (configuration.pool as unknown[])
        : []) {
        add(typeof item === 'string' ? item : rec(item)?.uuid, first, 'choice');
      }
    }
  }
  return links
    .sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || compare(a.name ?? '', b.name ?? ''))
    .slice(0, LIBRARY_LIMITS.linksPerDocument);
}

// ---------------------------------------------------------------------------
// getLibraryDocuments
// ---------------------------------------------------------------------------

/** `Compendium.<package>.<pack>.<Type>.<id>` as the pack id and the document id. */
function splitUuid(uuid: string): { pack: string; id: string } {
  const parts = uuid.split('.');
  return { pack: `${parts[1]}.${parts[2]}`, id: parts[4] ?? '' };
}

/**
 * The documents of one pack with these ids, in one `pack.getDocuments({ _id__in })` call (Foundry
 * 14 `CompendiumCollection#getDocuments`). Ids that do not load are left out; a failing call
 * leaves all of them out.
 */
async function loadPackDocuments(packId: string, ids: string[]): Promise<Map<string, Rec>> {
  const found = new Map<string, Rec>();
  const pack = getPack(packId);
  const getDocuments = pack?.getDocuments;
  if (!pack || typeof getDocuments !== 'function') return found;
  try {
    const result = await (getDocuments as (query: unknown) => Promise<unknown>).call(pack, {
      _id__in: ids,
    });
    const wanted = new Set(ids);
    for (const entry of Array.isArray(result) ? (result as unknown[]) : []) {
      const doc = rec(entry);
      const id = doc ? (nonEmpty(doc.id) ?? nonEmpty(doc._id)) : null;
      if (doc && id && wanted.has(id)) found.set(id, doc);
    }
  } catch {
    // every id of this pack stays missing
  }
  return found;
}

function buildDocument(uuid: string, doc: Rec): LibraryDocument {
  const parts = uuid.split('.');
  const documentName = parts[3] === 'Actor' ? 'Actor' : 'Item';
  const isNpc = documentName === 'Actor';
  const html = isNpc ? '' : (str(dig(doc, 'system', 'description', 'value')) ?? '');
  const fitted = fitJsonBytes(html, LIBRARY_LIMITS.descriptionBytes);
  const statBlock = isNpc
    ? buildStatBlock(doc, rulesOf(doc), LIBRARY_LIMITS.descriptionBytes)
    : null;
  return {
    uuid,
    pack: `${parts[1]}.${parts[2]}`,
    id: parts[4] ?? '',
    name: sourceName(doc),
    documentName,
    type: str(doc.type) ?? '',
    subtype: nonEmpty(dig(doc, 'system', 'type', 'value')),
    img: imagePath(doc.img),
    source: sourceText(doc),
    rules: rulesOf(doc),
    facts: factsOf(doc),
    description: fitted.content.trim() ? fitted.content : null,
    statBlock,
    links: isNpc ? [] : linksOf(doc),
    truncated: fitted.truncated || statBlock?.truncated === true,
  };
}

/** Full content of up to 40 compendium documents (GM clients only). */
export async function getLibraryDocuments(
  data: unknown
): Promise<LibraryDocumentsResponse | Failure> {
  if (!isGm()) return { success: false, error: 'Access denied' };
  const raw = rec(data) ?? {};
  const requested = Array.isArray(raw.uuids) ? (raw.uuids as unknown[]) : [];
  const uuids = [
    ...new Set(
      requested.filter((u): u is string => typeof u === 'string' && COMPENDIUM_UUID.test(u))
    ),
  ].slice(0, LIBRARY_LIMITS.documentsPerRequest);
  const documents: LibraryDocument[] = [];
  const missing: string[] = [];
  const deferred: string[] = [];
  let bytes = 0;
  // One `getDocuments` call per pack, made when the first document of the pack is needed (so a
  // pack whose documents are all deferred is never loaded).
  const idsByPack = new Map<string, string[]>();
  for (const uuid of uuids) {
    const { pack, id } = splitUuid(uuid);
    idsByPack.set(pack, [...(idsByPack.get(pack) ?? []), id]);
  }
  const loaded = new Map<string, Map<string, Rec>>();
  for (const uuid of uuids) {
    if (bytes >= LIBRARY_LIMITS.responseBudgetBytes) {
      deferred.push(uuid);
      continue;
    }
    const { pack, id } = splitUuid(uuid);
    let packDocs = loaded.get(pack);
    if (!packDocs) {
      packDocs = await loadPackDocuments(pack, idsByPack.get(pack) ?? []);
      loaded.set(pack, packDocs);
    }
    const doc = packDocs.get(id);
    if (!doc) {
      missing.push(uuid);
      continue;
    }
    const built = buildDocument(uuid, doc);
    const size = utf8Bytes(JSON.stringify(built));
    if (documents.length > 0 && bytes + size > LIBRARY_LIMITS.responseBudgetBytes) {
      deferred.push(uuid);
      bytes = LIBRARY_LIMITS.responseBudgetBytes;
      continue;
    }
    documents.push(built);
    bytes += size;
  }
  return {
    success: true,
    schema: LIBRARY_SCHEMA,
    worldId: worldId(),
    documents,
    missing,
    deferred,
  };
}
