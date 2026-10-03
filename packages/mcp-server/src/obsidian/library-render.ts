/**
 * Library notes (docs/design/OBSIDIAN-O4-DESIGN.md section 13): one note per compendium
 * document from the packs the GM picked, under `Campaigns/<world>/AI Tool/Library/<Category>/`.
 * Pure functions: a `LibraryDocument` (module query `getLibraryDocuments`) plus the paths and
 * links the Library sync resolved, Markdown out. Deterministic, so an unchanged note is never
 * rewritten.
 *
 * Licensed content (book and compendium text): these notes live only in the GM's vault, in a
 * folder the git guard keeps ignored. `player_safe` marks rules content a player may see (spells,
 * items, class options, species, backgrounds, feats) for a later player vault; monsters never
 * are.
 */
import type { LibraryDocument, LibraryIndexRow, LibraryLink } from '@gnuminator/shared';

import { htmlToMarkdown } from './html-to-md.js';
import { LIBRARY_ROOT } from './licensed-guard.js';
import { collapseWhitespace, escapeInlineText, escapeLineStart } from './md-escape.js';
import {
  openUrl,
  relativeLinkTarget,
  type LibraryLinks,
  type LinkContext,
} from './mirror-common.js';
import { GENERATED_BY, withGeneratedHash } from './ownership.js';
import { frontmatter, safeFileName } from './render.js';
import { statBlockMarkdown } from './stat-block-md.js';

/** Where a document's note goes and how it is typed. */
export interface LibraryCategory {
  /** Campaign-relative folder (no trailing slash). */
  folder: string;
  /** The note's `type` property. */
  type: string;
  /** Tag next to `library` (`monster`, `spell`, ...). */
  tag: string;
  /** Rules content a player may see (O7 player vault); never monsters. */
  playerSafe: boolean;
}

const PHYSICAL = new Set(['weapon', 'equipment', 'consumable', 'tool', 'loot', 'container']);

function folder(name: string, group?: string | null): string {
  const sub = group ? `/${safeFileName(group)}` : '';
  return `${LIBRARY_ROOT}/${name}${sub}`;
}

/** The category of an index row (folder, note type, tag). */
export function libraryCategory(
  row: Pick<LibraryIndexRow, 'type' | 'subtype' | 'group'> & { uuid?: string }
): LibraryCategory {
  const isActor = row.uuid?.split('.')[3] === 'Actor' || row.type === 'npc';
  if (isActor)
    return {
      folder: folder('Monsters'),
      type: 'library-monster',
      tag: 'monster',
      playerSafe: false,
    };
  switch (row.type) {
    case 'spell':
      return { folder: folder('Spells'), type: 'library-spell', tag: 'spell', playerSafe: true };
    case 'class':
      return { folder: folder('Classes'), type: 'library-class', tag: 'class', playerSafe: true };
    case 'subclass':
      return {
        folder: folder('Subclasses'),
        type: 'library-subclass',
        tag: 'subclass',
        playerSafe: true,
      };
    case 'race':
      return {
        folder: folder('Species'),
        type: 'library-species',
        tag: 'species',
        playerSafe: true,
      };
    case 'background':
      return {
        folder: folder('Backgrounds'),
        type: 'library-background',
        tag: 'background',
        playerSafe: true,
      };
    case 'feat': {
      switch (row.subtype) {
        case 'feat':
          return { folder: folder('Feats'), type: 'library-feat', tag: 'feat', playerSafe: true };
        case 'class':
          return {
            folder: folder('Class features', row.group),
            type: 'library-feature',
            tag: 'class-feature',
            playerSafe: true,
          };
        case 'race':
          return {
            folder: folder('Species traits', row.group),
            type: 'library-feature',
            tag: 'species-trait',
            playerSafe: true,
          };
        case 'background':
          return {
            folder: folder('Background features'),
            type: 'library-feature',
            tag: 'background-feature',
            playerSafe: true,
          };
        case 'monster':
          return {
            folder: folder('Monster features'),
            type: 'library-feature',
            tag: 'monster-feature',
            playerSafe: false,
          };
        default:
          return {
            folder: folder('Features'),
            type: 'library-feature',
            tag: 'feature',
            playerSafe: true,
          };
      }
    }
    default:
      if (PHYSICAL.has(row.type)) {
        return { folder: folder('Items'), type: 'library-item', tag: 'item', playerSafe: true };
      }
      return { folder: folder('Other'), type: 'library-other', tag: 'other', playerSafe: false };
  }
}

/** Every Library note type (the scan recognizes these). */
export const LIBRARY_NOTE_TYPES: readonly string[] = [
  'library-monster',
  'library-spell',
  'library-class',
  'library-subclass',
  'library-species',
  'library-background',
  'library-feat',
  'library-feature',
  'library-item',
  'library-other',
];

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Everything a Library note needs besides its document. */
export interface LibraryNoteContext {
  worldId: string;
  /** Validated `FOUNDRY_AI_OPEN_BASE`, or '' when off. */
  openBase: string;
  /** The link context for text in this note (world notes, Library notes, images). */
  linkContext(fromPath: string, uuid: string, selfName: string): LinkContext;
  library: LibraryLinks;
  /** The pack's label (`DDB Spells`). */
  packLabel(pack: string): string;
  /** A class's Library note by its identifier (subclasses link their class). */
  classByIdentifier(identifier: string): { uuid: string; name: string } | null;
  /** Subclasses of a class identifier (classes list their subclasses). */
  subclassesOf(identifier: string): Array<{ uuid: string; name: string }>;
  image?(src: string, alt: string, width?: number): string | null;
}

type PropValue = string | number | boolean | null | readonly string[];

function propText(text: string, max = 200): string {
  return collapseWhitespace(text, max)
    .replace(/\[(?=\[)/g, '[ ')
    .replace(/\](?=\])/g, '] ');
}

function escapeText(text: string, max = 400): string {
  return escapeInlineText(collapseWhitespace(text, max));
}

function factKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

/** Facts that are also note properties (Bases can sort and filter by them). */
const RESERVED_KEYS = new Set([
  'type',
  'name',
  'source',
  'tags',
  'aliases',
  'schema',
  'rules',
  'player_safe',
  'category',
  'pack',
]);

function noteLink(fromPath: string, toPath: string, label: string): string {
  const text =
    escapeInlineText(collapseWhitespace(label, 200)).replace(/[[\]]/g, '\\$&') || 'Untitled';
  return `[${text}](${relativeLinkTarget(fromPath, toPath)})`;
}

/** A link to another Library document by uuid: its note, else its name (Open in Foundry). */
function libraryLink(
  ctx: LibraryNoteContext,
  fromPath: string,
  uuid: string,
  name: string | null
): string {
  const target = ctx.library.byUuid(uuid);
  const label = name ?? target?.name ?? 'entry';
  if (target?.notePath) return noteLink(fromPath, target.notePath, label);
  if (ctx.openBase && /^https?:\/\/[^\s()<>]+$/.test(ctx.openBase)) {
    return `[${escapeText(label, 200)}](${openUrl(ctx.openBase, uuid)})`;
  }
  return escapeText(label, 200);
}

function linksSection(
  ctx: LibraryNoteContext,
  fromPath: string,
  links: readonly LibraryLink[],
  heading: string
): string[] {
  if (links.length === 0) return [];
  const out = [`## ${heading}`, ''];
  const byLevel = new Map<string, LibraryLink[]>();
  for (const link of links) {
    const key = link.level === null ? '' : String(link.level);
    byLevel.set(key, [...(byLevel.get(key) ?? []), link]);
  }
  const levels = [...byLevel.keys()].sort((a, b) =>
    a === '' ? 1 : b === '' ? -1 : Number(a) - Number(b)
  );
  const grouped = levels.length > 1 || levels[0] !== '';
  for (const level of levels) {
    const group = byLevel.get(level) ?? [];
    const items = group.map(link => {
      const choice = link.kind === 'choice' ? ' (choice)' : '';
      return `${libraryLink(ctx, fromPath, link.uuid, link.name)}${choice}`;
    });
    if (grouped)
      out.push(`- **${level === '' ? 'Any level' : `Level ${level}`}:** ${items.join(', ')}`);
    else out.push(...items.map(item => `- ${item}`));
  }
  out.push('');
  return out;
}

export const LIBRARY_BANNER_LINES = (packLabel: string): string[] => [
  '> [!info] Library note from Foundry',
  `> From the compendium "${escapeText(packLabel, 120)}". The AI Tool rewrites this note when the entry changes in Foundry; if you edit it, the tool stops updating it. Licensed content: this folder is kept out of git.`,
];

/** One Library note. `path` is its campaign-relative path; `row` its index row (signature, identifier). */
export function renderLibraryNote(
  doc: LibraryDocument,
  row: Pick<LibraryIndexRow, 'sig' | 'identifier' | 'group'>,
  path: string,
  ctx: LibraryNoteContext
): string {
  const sig = row.sig;
  const category = libraryCategory({ ...doc, group: row.group, uuid: doc.uuid });
  const name = propText(doc.name) || 'Untitled';
  const link = ctx.linkContext(path, doc.uuid, doc.name);
  const packLabel = ctx.packLabel(doc.pack);

  const facts = doc.facts.filter(f => f.value.trim() !== '' && f.label !== 'Source');
  const factProps: Record<string, PropValue> = {};
  for (const fact of facts) {
    const key = factKey(fact.label);
    if (!key || RESERVED_KEYS.has(key) || key in factProps) continue;
    factProps[key] = propText(fact.value);
  }
  const props: Record<string, PropValue | undefined> = {
    type: category.type,
    fvtt_world: ctx.worldId,
    fvtt_uuid: doc.uuid,
    fvtt_type: doc.documentName,
    name,
    fvtt_pack: doc.pack,
    pack: propText(packLabel),
    item_type: propText(doc.type),
    ...(doc.statBlock
      ? {
          cr:
            doc.statBlock.lower
              .find(l => l.label === 'Challenge' || l.label === 'CR')
              ?.value.split(' ')[0] ?? null,
          creature: propText(doc.statBlock.tag),
        }
      : {}),
    ...factProps,
    aliases: [name],
    fvtt_sig: propText(sig),
    rules: doc.rules,
    player_safe: category.playerSafe,
    source: doc.source ? propText(doc.source) : null,
    schema: 1,
    tags: [`campaign/${ctx.worldId}`, 'library', category.tag],
    generated_by: GENERATED_BY,
    generated_hash: '',
  };

  const body: string[] = [
    `# ${escapeText(doc.name, 200) || 'Untitled'}`,
    '',
    ...LIBRARY_BANNER_LINES(packLabel),
    '',
  ];
  if (ctx.openBase && /^https?:\/\/[^\s()<>]+$/.test(ctx.openBase)) {
    body.push(`[Open in Foundry](${openUrl(ctx.openBase, doc.uuid)})`, '');
  }

  if (doc.statBlock) {
    const portrait = doc.img && ctx.image ? ctx.image(doc.img, doc.name, 250) : null;
    if (portrait) body.push(portrait, '');
    const spellLink = (spell: { name: string; sourceUuid: string | null }): string | null => {
      const uuid =
        (spell.sourceUuid && ctx.library.byUuid(spell.sourceUuid) ? spell.sourceUuid : null) ??
        ctx.library.spellByName?.(spell.name) ??
        null;
      const target = uuid ? ctx.library.byUuid(uuid) : null;
      return target?.notePath ? noteLink(path, target.notePath, spell.name) : null;
    };
    body.push(statBlockMarkdown(doc.name, doc.statBlock, link, { spellLink }), '');
    if (doc.statBlock.description) {
      const description = htmlToMarkdown(doc.statBlock.description, link);
      if (description) body.push('## Description', '', description, '');
    }
  } else {
    const factLines: string[] = [];
    for (const fact of facts) {
      let value = escapeText(fact.value);
      if (doc.type === 'subclass' && fact.label === 'Class') {
        const cls = ctx.classByIdentifier(fact.value);
        if (cls) value = libraryLink(ctx, path, cls.uuid, cls.name);
      }
      factLines.push(`**${escapeText(fact.label, 80)}** ${value}`);
    }
    if (doc.source) factLines.push(`**Source** ${escapeText(doc.source, 120)}`);
    if (factLines.length) body.push(factLines.map(line => escapeLineStart(line)).join('\n'), '');
    if (doc.description) {
      const description = htmlToMarkdown(doc.description, link);
      if (description) body.push(description, '');
    }
    if (doc.truncated) body.push('*The text was cut; open the entry in Foundry for the rest.*', '');
    if (doc.type === 'class') {
      const identifier =
        row.identifier ??
        doc.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
      const subclasses = ctx.subclassesOf(identifier);
      if (subclasses.length) {
        body.push(
          '## Subclasses',
          '',
          ...subclasses.map(sub => `- ${libraryLink(ctx, path, sub.uuid, sub.name)}`),
          ''
        );
      }
    }
    const heading =
      doc.type === 'class' || doc.type === 'subclass' ? 'Features by level' : 'Grants';
    body.push(...linksSection(ctx, path, doc.links, heading));
  }

  while (body.length > 0 && body[body.length - 1] === '') body.pop();
  return withGeneratedHash([frontmatter(props), ...body, ''].join('\n'));
}
