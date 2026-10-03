/**
 * An NPC stat block as Markdown (docs/design/OBSIDIAN-O4-DESIGN.md section 13): one
 * `[!statblock]` callout per creature, in the usual stat block layout (a made-up creature):
 *
 * ```
 * > [!statblock] Pebble Hopper
 * > *Small beast, unaligned*
 * >
 * > **Armor Class** 11
 * > **Hit Points** 9 (2d6 + 2)
 * > **Speed** 20 ft
 * >
 * > | STR | DEX | CON | INT | WIS | CHA |
 * > | :-: | :-: | :-: | :-: | :-: | :-: |
 * > | 8 (-1) | 12 (+1) | 12 (+1) | 2 (-4) | 10 (+0) | 4 (-3) |
 * >
 * > ***Springy.*** It jumps twice as far as it should.
 * >
 * > ### Actions
 * > ***Bonk.*** ...
 * ```
 *
 * Shared by world NPC notes and Library monster notes. Labels and values come from the module
 * as plain text (escaped here); feature texts are HTML and go through the page converter, so
 * their enrichers become words and links.
 */
import type { ExportStatBlock } from '@gnuminator/shared';

import { htmlToMarkdown } from './html-to-md.js';
import { collapseWhitespace, escapeInlineText } from './md-escape.js';
import type { LinkContext } from './mirror-common.js';

/** One line of plain text from Foundry, escaped for a note. */
function plain(text: string, max = 400): string {
  // Always used inside a line (after `**Label** ` or `*`): no line-start escaping needed.
  return escapeInlineText(collapseWhitespace(text, max));
}

function signed(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

function abilityTable(block: ExportStatBlock): string | null {
  if (block.abilities.length === 0) return null;
  const labels = block.abilities.map(a => plain(a.label, 8) || a.key.toUpperCase());
  const scores = block.abilities.map(a => `${a.score} (${signed(a.mod)})`);
  const savesDiffer = block.abilities.some(a => a.save !== a.mod);
  if (!savesDiffer) {
    return [
      `| ${labels.join(' | ')} |`,
      `| ${labels.map(() => ':-:').join(' | ')} |`,
      `| ${scores.join(' | ')} |`,
    ].join('\n');
  }
  return [
    `| | ${labels.join(' | ')} |`,
    `| --- | ${labels.map(() => ':-:').join(' | ')} |`,
    `| Score | ${scores.join(' | ')} |`,
    `| Save | ${block.abilities.map(a => signed(a.save)).join(' | ')} |`,
  ].join('\n');
}

function lines(rows: ExportStatBlock['upper']): string | null {
  const out = rows
    .filter(row => row.value.trim() !== '')
    .map(row => `**${plain(row.label, 80)}** ${plain(row.value)}`);
  return out.length ? out.join('\n') : null;
}

/** Letters and digits only, lower case: `Cold Breath (Recharge 6).` to `coldbreathrecharge6`. */
function nameKey(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * True when the paragraph already opens with the feature's name in bold or italics, as
 * D&D Beyond imports write it (`***Cold Breath (Recharge 6).*** The ...`): then the note uses
 * that run instead of adding the name a second time.
 */
function opensWithName(paragraph: string, name: string): boolean {
  const run = /^(\*{1,3}|_{1,3})(.+?)\1/.exec(paragraph);
  if (!run) return false;
  const base = nameKey(name.replace(/\([^)]*\)/g, ''));
  return base !== '' && nameKey(run[2] ?? '').startsWith(base);
}

/** A feature: `***Name.*** text`, the name joined to the first paragraph when there is one. */
function entryBlocks(name: string, html: string, ctx: LinkContext): string[] {
  const title = `***${escapeInlineText(collapseWhitespace(name, 200)).replace(/[.:]+$/, '')}.***`;
  const body = htmlToMarkdown(html, ctx);
  if (body === '') return [title];
  const blocks = body.split('\n\n');
  const first = blocks[0] ?? '';
  if (opensWithName(first, name)) return blocks;
  // A plain paragraph takes the name in front; a table, list, quote or heading follows it.
  if (/^(\||>|#|- |\d+\\?\. |!\[\[)/.test(first)) return [title, ...blocks];
  // The name now starts the line, so the paragraph's own line-start escape (`\+4`) is not needed.
  const joined = first.replace(/^\\([>+\-=#])/, '$1').replace(/^(\d+)\\([.)])/, '$1$2');
  return [`${title} ${joined}`, ...blocks.slice(1)];
}

export interface StatBlockOptions {
  /** The link for a spell the creature has (its Library note), or null for the plain name. */
  spellLink?: (spell: ExportStatBlock['spells'][number]) => string | null;
}

function spellLines(block: ExportStatBlock, options: StatBlockOptions): string | null {
  if (block.spells.length === 0) return null;
  const byLevel = new Map<number, string[]>();
  for (const spell of block.spells) {
    const shown =
      options.spellLink?.(spell) ?? escapeInlineText(collapseWhitespace(spell.name, 200));
    byLevel.set(spell.level, [...(byLevel.get(spell.level) ?? []), shown]);
  }
  return [...byLevel.entries()]
    .sort(([a], [b]) => a - b)
    .map(
      ([level, names]) => `**${level === 0 ? 'Cantrips' : `Level ${level}`}** ${names.join(', ')}`
    )
    .join('\n');
}

/** Quote every line of the blocks into one callout (blank lines between blocks). */
function callout(head: string, blocks: string[]): string {
  const body = blocks
    .filter(b => b.trim() !== '')
    .join('\n\n')
    .split('\n')
    .map(line => (line === '' ? '>' : `> ${line}`));
  return [head, ...body].join('\n');
}

/**
 * The stat block callout (and nothing else: the caller adds the portrait and the description).
 * `ctx` is the link context of the note it goes into.
 */
export function statBlockMarkdown(
  name: string,
  block: ExportStatBlock,
  ctx: LinkContext,
  options: StatBlockOptions = {}
): string {
  const blocks: string[] = [];
  if (block.tag.trim()) blocks.push(`*${plain(block.tag)}*`);
  const upper = lines(block.upper);
  if (upper) blocks.push(upper);
  const abilities = abilityTable(block);
  if (abilities) blocks.push(abilities);
  const lower = lines(block.lower);
  if (lower) blocks.push(lower);
  for (const section of block.sections) {
    if (section.key !== 'trait') blocks.push(`### ${plain(section.label, 80)}`);
    if (section.intro) {
      const intro = htmlToMarkdown(section.intro, ctx);
      if (intro) blocks.push(intro);
    }
    for (const entry of section.entries) blocks.push(...entryBlocks(entry.name, entry.html, ctx));
  }
  const spells = spellLines(block, options);
  if (spells) blocks.push('### Spells', spells);
  if (block.truncated)
    blocks.push('*Some feature text was cut; open the creature in Foundry for the rest.*');
  const title = escapeInlineText(collapseWhitespace(name, 200)) || 'Stat block';
  return callout(`> [!statblock] ${title}`, blocks);
}
