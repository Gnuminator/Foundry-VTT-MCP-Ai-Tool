/**
 * Library notes (docs/design/OBSIDIAN-O4-DESIGN.md section 13): one note per compendium
 * document from the packs the GM picked, under
 * `Campaigns/<world>/AI Tool/Library/<Category>/<Book title>/` (I-100: by kind, then book; class
 * features and species traits add their group folder below the book).
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
  pathKey,
  relativeLinkTarget,
  type LibraryLinks,
  type LinkContext,
} from './mirror-common.js';
import { folderPath, shortSuffix } from './mirror-paths.js';
import { GENERATED_BY, renderBaseText, withGeneratedHash } from './ownership.js';
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

/** The book folder of entries without a source book. */
export const NO_BOOK_FOLDER = 'Other';

/** The fields of a row (or document) that place its note. */
export type LibraryPlacement = Pick<LibraryIndexRow, 'type' | 'subtype' | 'group'> &
  Partial<Pick<LibraryIndexRow, 'book' | 'bookTitle'>> & { uuid?: string };

/** The book an entry comes from as its notes show it (the full title, else the code), or null. */
export function libraryBook(
  row: Partial<Pick<LibraryIndexRow, 'book' | 'bookTitle'>>
): string | null {
  const title = (row.bookTitle ?? row.book ?? '').replace(/\s+/g, ' ').trim();
  return title || null;
}

/** The category of an index row (folder, note type, tag). */
export function libraryCategory(row: LibraryPlacement): LibraryCategory {
  const book = libraryBook(row) ?? NO_BOOK_FOLDER;
  const folder = (name: string, group?: string | null): string =>
    folderPath(`${LIBRARY_ROOT}/${name}`, group ? [book, group] : [book]);
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
  /** The hub note of a book by its title (I-100), or null. */
  bookNote?(title: string): string | null;
  image?(src: string, alt: string, width?: number): string | null;
}

type PropValue = string | number | boolean | null | readonly string[];

function propText(text: string, max = 200): string {
  return collapseWhitespace(text, max)
    .replace(/\[(?=\[)/g, '[ ')
    .replace(/\](?=\])/g, '] ');
}

/** The `book` property of an entry's note (the full title as a property value), or null. */
export function bookProperty(
  row: Partial<Pick<LibraryIndexRow, 'book' | 'bookTitle'>>
): string | null {
  const book = libraryBook(row);
  return book ? propText(book) || null : null;
}

// ---------------------------------------------------------------------------
// One base per book (I-100): the whole book across kinds
// ---------------------------------------------------------------------------

/** Where the per-book bases go (inside the Library: kept out of git with it). */
export const LIBRARY_BOOKS_FOLDER = `${LIBRARY_ROOT}/Books`;

function yamlSingleQuoted(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

/**
 * The base of one book: a table of every Library note whose `book` property is `title`. Only
 * the title and filters, no book text. Compared by content like the mirror's bases.
 */
export function renderBookBase(worldId: string, title: string): string {
  const lines = [
    'filters:',
    '  and:',
    `    - file.inFolder("Campaigns/${worldId}/${LIBRARY_ROOT}")`,
    `    - ${yamlSingleQuoted(`book == ${JSON.stringify(title)}`)}`,
    'views:',
    '  - type: table',
    `    name: ${yamlSingleQuoted(title)}`,
    '    order:',
    '      - file.name',
    '      - type',
    '      - rules',
    '      - source',
    '      - page',
    '    sort:',
    '      - property: type',
    '        direction: ASC',
    '      - property: file.name',
    '        direction: ASC',
  ];
  return renderBaseText(`${lines.join('\n')}\n`);
}

/** The title a generated book base filters on (read back from its text), or null. */
export function bookBaseTitle(text: string): string | null {
  const match = /^ {4}- '(book == ".*")'\s*$/m.exec(text);
  if (!match?.[1]) return null;
  try {
    const value: unknown = JSON.parse(match[1].replace(/''/g, "'").slice('book == '.length));
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Base paths for these book titles (`AI Tool/Library/Books/<title>.base`), in title order; a
 * title whose file name is taken by another gets a short hash of the title.
 */
export function bookBasePaths(titles: Iterable<string>): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const title of [...new Set(titles)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    let candidate = `${LIBRARY_BOOKS_FOLDER}/${safeFileName(title)}.base`;
    if (used.has(pathKey(candidate))) {
      candidate = `${LIBRARY_BOOKS_FOLDER}/${safeFileName(title)} (${shortSuffix(title)}).base`;
    }
    used.add(pathKey(candidate));
    out.set(title, candidate);
  }
  return out;
}

/** The note type of a book's hub note. */
export const LIBRARY_BOOK_TYPE = 'library-book';

/** A book's hub note sits next to its base: `Library/Books/<title>.md`. */
export function bookNotePath(basePath: string): string {
  return basePath.replace(/\.base$/i, '.md');
}

/**
 * The hub note of one book: every Library note from the book links here (so Obsidian's graph
 * groups a book's notes around it), and it embeds the book's base. It has no `book` property, so
 * the base does not list it.
 */
export function renderBookNote(worldId: string, title: string, basePath: string): string {
  const name = propText(title) || 'Untitled';
  const props: Record<string, PropValue> = {
    type: LIBRARY_BOOK_TYPE,
    fvtt_world: worldId,
    name,
    aliases: [name],
    schema: 1,
    tags: [`campaign/${worldId}`, 'library', 'book'],
    generated_by: GENERATED_BY,
    generated_hash: '',
  };
  const baseFile = basePath.split('/').pop() ?? '';
  const body = [
    `# ${escapeText(title, 200) || 'Untitled'}`,
    '',
    '> [!info] Book in the Library',
    '> Every Library note from this book links here; the table lists them. The AI Tool rewrites this note; if you edit it, the tool stops updating it.',
    '',
    `![[${baseFile}]]`,
  ];
  return withGeneratedHash([frontmatter(props), ...body, ''].join('\n'));
}

/** Whether a note's text is a book hub note we wrote (its type and marker), from its head. */
export function isBookNoteText(text: string): boolean {
  return (
    new RegExp(`^type: "${LIBRARY_BOOK_TYPE}"$`, 'm').test(text) &&
    new RegExp(`^generated_by: "?${GENERATED_BY}"?$`, 'm').test(text)
  );
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
  'book',
  'page',
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
  row: Pick<LibraryIndexRow, 'sig' | 'identifier' | 'group'> &
    Partial<Pick<LibraryIndexRow, 'book' | 'bookTitle' | 'page'>>,
  path: string,
  ctx: LibraryNoteContext
): string {
  const sig = row.sig;
  const category = libraryCategory({
    ...doc,
    group: row.group,
    book: row.book ?? doc.book ?? null,
    bookTitle: row.bookTitle ?? doc.bookTitle ?? null,
    uuid: doc.uuid,
  });
  const book = bookProperty({
    book: row.book ?? doc.book ?? null,
    bookTitle: row.bookTitle ?? doc.bookTitle ?? null,
  });
  const pageText = (row.page ?? doc.page ?? '').trim();
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
    book: book ?? undefined,
    page: pageText
      ? /^\d{1,6}$/.test(pageText)
        ? Number(pageText)
        : propText(pageText, 40)
      : undefined,
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
  const hub = book ? (ctx.bookNote?.(book) ?? null) : null;
  if (book && hub) {
    const at = pageText ? `, page ${escapeText(pageText, 40)}` : '';
    body.push(`From ${noteLink(path, hub, book)}${at}.`, '');
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
