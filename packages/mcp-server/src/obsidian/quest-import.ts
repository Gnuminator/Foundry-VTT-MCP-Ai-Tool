/**
 * O6: a quest prep note from the GM's Obsidian vault as a Foundry quest journal (a guarded plan,
 * switch `obsidian-import`, off by default; `tools/obsidian-quest-import.ts`). This file only
 * reads one note and turns it into a title and sanitized HTML; it never writes anything.
 *
 * The note must sit under `Campaigns/<world>/Prep/` (never the tool's own `AI Tool/` folder, never
 * `Prep/Templates/`), be a Markdown file of at most QUEST_NOTE_MAX_BYTES, have `type: quest-prep`
 * and an empty `fvtt_uuid` (a note that already points at a journal is not imported again). The
 * `secret` and `ai_context` properties are never copied; `stakes` and the body are. The HTML is
 * built from escaped text only, so a note cannot bring markup into Foundry.
 */
import { promises as fsp } from 'fs';
import * as path from 'path';

import { PREP_TEMPLATES_DIR } from './prep-templates.js';

export const QUEST_NOTE_MAX_BYTES = 65_536;

export interface QuestImportNote {
  /** Vault-relative path with forward slashes, as given. */
  notePath: string;
  title: string;
  /** Sanitized HTML for the journal's "Quest Details" page. */
  html: string;
}

export class QuestImportError extends Error {}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Inline Markdown on already-escaped text: wikilinks as plain text, bold and italic. */
function inline(escaped: string): string {
  return escaped
    .replace(/\[\[([^\]|]*\|)?([^\]]+)\]\]/g, '$2')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
}

/** Headings, bullet lists and paragraphs; everything else is a paragraph of escaped text. */
export function markdownToHtml(markdown: string): string {
  const out: string[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const flushList = (): void => {
    if (list.length === 0) return;
    out.push(`<ul>${list.map(item => `<li>${item}</li>`).join('')}</ul>`);
    list = [];
  };
  const flushPara = (): void => {
    if (para.length === 0) return;
    out.push(`<p>${para.join(' ')}</p>`);
    para = [];
  };
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    if (line === '') {
      flushList();
      flushPara();
    } else if (heading?.[1] !== undefined) {
      flushList();
      flushPara();
      const level = Math.min(heading[1].length + 1, 6);
      out.push(`<h${level}>${inline(escapeHtml(heading[2] ?? ''))}</h${level}>`);
    } else if (bullet?.[1] !== undefined) {
      flushPara();
      list.push(inline(escapeHtml(bullet[1])));
    } else {
      flushList();
      para.push(inline(escapeHtml(line)));
    }
  }
  flushList();
  flushPara();
  return out.join('\n');
}

function withoutComments(text: string): string {
  const closed = text.replace(/%%[\s\S]*?%%/g, '');
  const open = closed.indexOf('%%');
  return open === -1 ? closed : closed.slice(0, open);
}

/** Properties as plain scalars (lists and nested values are skipped) and the body after them. */
export function splitNote(text: string): { props: Record<string, string>; body: string } {
  const unmarked = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = unmarked.replace(/\r\n?/g, '\n').split('\n');
  const props: Record<string, string> = {};
  if (lines[0]?.trim() !== '---') return { props, body: lines.join('\n') };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) return { props, body: lines.join('\n') };
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z_][\w-]*):(?:[ \t]+(.*))?$/.exec(line.trimEnd());
    if (!match?.[1]) continue;
    props[match[1]] = (match[2] ?? '').trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return { props, body: lines.slice(end + 1).join('\n') };
}

/**
 * The note's file under `Campaigns/<worldId>/Prep/`, or an error naming why not. Rejects `..`,
 * absolute and drive paths, other folders, the templates and conflict copies.
 */
export function resolveQuestNote(vaultDir: string, worldId: string, notePath: string): string {
  const parts = notePath.split('/');
  if (
    notePath.includes('\\') ||
    notePath.includes('\0') ||
    parts.some(part => part === '' || part === '.' || part === '..' || part.includes(':'))
  ) {
    throw new QuestImportError('The note path is not a plain vault path.');
  }
  const prefix = `Campaigns/${worldId}/Prep/`;
  if (!notePath.toLowerCase().startsWith(prefix.toLowerCase())) {
    throw new QuestImportError(`Only notes under ${prefix} can be imported.`);
  }
  const rest = notePath.slice(prefix.length).toLowerCase();
  const templates = `${PREP_TEMPLATES_DIR.slice('Prep/'.length).toLowerCase()}/`;
  if (rest.startsWith(templates)) {
    throw new QuestImportError('A prep template is not a note: fill one in first.');
  }
  if (!notePath.toLowerCase().endsWith('.md') || /\.sync-conflict-/i.test(notePath)) {
    throw new QuestImportError('Only a Markdown note (not a sync-conflict copy) can be imported.');
  }
  const full = path.resolve(vaultDir, ...parts);
  const root = path.resolve(vaultDir);
  if (!full.startsWith(root + path.sep)) {
    throw new QuestImportError('The note path leaves the vault.');
  }
  return full;
}

/** Read one quest prep note and build its journal title and HTML. */
export async function readQuestNote(
  vaultDir: string,
  worldId: string,
  notePath: string
): Promise<QuestImportNote> {
  const full = resolveQuestNote(vaultDir, worldId, notePath);
  let stat;
  try {
    stat = await fsp.lstat(full);
  } catch {
    throw new QuestImportError('That note is not in the vault.');
  }
  if (!stat.isFile()) throw new QuestImportError('That path is not a note.');
  if (stat.size > QUEST_NOTE_MAX_BYTES) {
    throw new QuestImportError(
      `The note is over ${QUEST_NOTE_MAX_BYTES / 1024} KB: shorten it before importing.`
    );
  }
  const { props, body } = splitNote(await fsp.readFile(full, 'utf8'));
  if (props.type !== 'quest-prep') {
    throw new QuestImportError('Only a note with type: quest-prep can be imported as a quest.');
  }
  if ((props.fvtt_uuid ?? '') !== '') {
    throw new QuestImportError(
      'This note already points at a Foundry document (fvtt_uuid): clear it to import it as a new quest.'
    );
  }
  const base = path.posix.basename(notePath, '.md').trim();
  const title = (props.title ?? base).trim().slice(0, 120);
  if (title === '') throw new QuestImportError('The note has no name to use as the quest title.');
  const stakes = (props.stakes ?? '').trim();
  const text = withoutComments(body).trim();
  const html = [
    stakes === '' ? '' : `<p><strong>Stakes:</strong> ${inline(escapeHtml(stakes))}</p>`,
    markdownToHtml(text),
  ]
    .filter(part => part !== '')
    .join('\n');
  const hasText = text
    .split('\n')
    .some(line => line.trim() !== '' && !/^#{1,6}(\s|$)/.test(line.trim()));
  if (html === '' || (!hasText && stakes === '')) {
    throw new QuestImportError('The note is empty: write something under its headings first.');
  }
  return { notePath, title, html };
}
