/**
 * Campaign journals (D-151, campaign-journals): the page model.
 *
 * The campaign's notes live in eight GM-only Foundry journals in a "Campaign" folder, one page per
 * thing (an NPC, a place, a session). Every page carries both languages, Danish first, and has the
 * same shape: a short summary, relations, and a timeline with one block per session. The pages are
 * plain HTML with class markers, so a hand edit in Foundry survives: a merge inserts into the
 * marked places instead of re-rendering the page.
 *
 * Pure functions only; the plan tool (`tools/campaign-merge.ts`) reads Foundry, calls these and
 * hands the ops to the guarded-write service. No campaign or book text lives here.
 */
import { createHash } from 'node:crypto';

export const CAMPAIGN_FEATURE_ID = 'campaign-merge';
export const CAMPAIGN_FOLDER = 'Campaign';

export const CAMPAIGN_KINDS = [
  'brothers',
  'npcs',
  'creatures',
  'locations',
  'lore',
  'threads',
  'sessions',
  'table',
] as const;
export type CampaignKind = (typeof CAMPAIGN_KINDS)[number];

export const CAMPAIGN_LANGS = ['da', 'en'] as const;
type CampaignLang = (typeof CAMPAIGN_LANGS)[number];

/**
 * The journal of each kind. `name` is the Foundry journal name and, through the mirror, the vault
 * folder (`AI Tool/Foundry/Journals/Campaign/<name>/`); it is English so the folders match the
 * design. `da` is the Danish title, shown in the pages' Danish section.
 */
export const CAMPAIGN_JOURNALS: Record<CampaignKind, { name: string; en: string; da: string }> = {
  brothers: { name: 'The Brothers', en: 'The Brothers', da: 'Brødrene' },
  npcs: { name: 'NPCs', en: 'NPCs', da: 'NPC’er' },
  creatures: { name: 'Creatures', en: 'Creatures', da: 'Væsner' },
  locations: { name: 'Locations', en: 'Locations', da: 'Steder' },
  lore: { name: 'Lore', en: 'Lore', da: 'Overlevering' },
  threads: { name: 'Threads', en: 'Threads', da: 'Tråde' },
  sessions: { name: 'Sessions', en: 'Sessions', da: 'Sessioner' },
  table: { name: 'Table', en: 'Table', da: 'Bordet' },
};

const HEADINGS: Record<
  CampaignLang,
  { lang: string; relations: string; timeline: string; new: string }
> = {
  da: { lang: 'Dansk', relations: 'Relationer', timeline: 'Tidslinje', new: 'ny' },
  en: { lang: 'English', relations: 'Relations', timeline: 'Timeline', new: 'new' },
};

/** A Foundry document id (16 letters and digits) that is the same for the same seed. */
function stableId(seed: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const digest = createHash('sha256').update(seed).digest();
  let id = '';
  for (let i = 0; i < 16; i++) id += alphabet[digest[i] % alphabet.length];
  return id;
}

export function journalId(kind: CampaignKind): string {
  return stableId(`campaign:journal:${kind}`);
}

function pageKey(name: string): string {
  return name.normalize('NFC').trim().toLocaleLowerCase('da');
}

export function pageId(kind: CampaignKind, name: string): string {
  return stableId(`campaign:page:${kind}:${pageKey(name)}`);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function unescapeQuotes(html: string): string {
  return html.replace(/&quot;/g, '"').replace(/&gt;/g, '>');
}

export interface StatBlockLink {
  uuid: string;
  name: string;
}

export interface TimelineLine {
  /** The session block it goes under, e.g. "Session 00". */
  session: string;
  /** The transcript line it comes from, e.g. `transcript.en#^u000556`; the mirror turns it into a link. */
  ref?: string | undefined;
  /** The timestamp shown with the link, e.g. "01:42". */
  time?: string | undefined;
  da?: string | undefined;
  en?: string | undefined;
}

export interface RelationLine {
  /** The page the relation points to (by name). */
  to: string;
  da?: string | undefined;
  en?: string | undefined;
}

export interface NewPageContent {
  summary?: { da?: string | undefined; en?: string | undefined } | undefined;
  statBlock?: StatBlockLink | undefined;
  relations?: RelationLine[] | undefined;
  timeline?: TimelineLine[] | undefined;
}

const NEW_MARK = (lang: CampaignLang): string =>
  `<em class="campaign-new">${HEADINGS[lang].new}</em> `;

function summaryHtml(lang: CampaignLang, text: string | undefined, isNew: boolean): string {
  const body = text?.trim()
    ? `<p>${isNew ? NEW_MARK(lang) : ''}${escapeHtml(text.trim())}</p>`
    : '';
  return `<div class="campaign-summary">${body}</div>`;
}

function relationLi(lang: CampaignLang, line: RelationLine, isNew: boolean): string {
  const text = line[lang]?.trim();
  return `<li data-to="${escapeHtml(pageKey(line.to))}">${isNew ? NEW_MARK(lang) : ''}<span class="campaign-link">${escapeHtml(line.to)}</span>${text ? `: ${escapeHtml(text)}` : ''}</li>`;
}

function timelineLi(lang: CampaignLang, line: TimelineLine, isNew: boolean): string {
  const text = line[lang]?.trim() ?? '';
  const ref = line.ref?.trim();
  const link = ref
    ? `<a class="campaign-ref" data-ref="${escapeHtml(ref)}">${escapeHtml(line.time?.trim() || ref)}</a> `
    : '';
  return `<li data-ref="${escapeHtml(ref ?? '')}">${isNew ? NEW_MARK(lang) : ''}${link}${escapeHtml(text)}</li>`;
}

function sessionBlock(session: string, items: string): string {
  return `<div class="campaign-session" data-session="${escapeHtml(session)}"><h4>${escapeHtml(session)}</h4><ul>${items}</ul></div>`;
}

function statBlockHtml(link: StatBlockLink | undefined): string {
  if (!link) return '<p class="campaign-statblock"></p>';
  return `<p class="campaign-statblock" data-uuid="${escapeHtml(link.uuid)}">@UUID[${link.uuid}]{${escapeHtml(link.name.replace(/[{}[\]]/g, ''))}}</p>`;
}

function langSection(lang: CampaignLang, content: NewPageContent): string {
  const h = HEADINGS[lang];
  const relations = (content.relations ?? [])
    .filter(r => r[lang]?.trim() !== undefined || r.to)
    .map(r => relationLi(lang, r, true))
    .join('');
  const bySession = new Map<string, string[]>();
  for (const line of content.timeline ?? []) {
    if (!line[lang]?.trim()) continue;
    const list = bySession.get(line.session) ?? [];
    list.push(timelineLi(lang, line, true));
    bySession.set(line.session, list);
  }
  const timeline = [...bySession].map(([s, items]) => sessionBlock(s, items.join(''))).join('');
  return (
    `<section class="campaign-lang" data-lang="${lang}"><h2>${h.lang}</h2>${summaryHtml(
      lang,
      content.summary?.[lang],
      true
    )}<h3>${h.relations}</h3><ul class="campaign-relations">${relations}</ul>` +
    `<h3>${h.timeline}</h3><div class="campaign-timeline">${timeline}</div></section>`
  );
}

/** A whole new page: Danish section, English section, the stat block link. */
export function renderNewPage(kind: CampaignKind, content: NewPageContent): string {
  return `<div class="campaign-page" data-kind="${kind}">${CAMPAIGN_LANGS.map(l =>
    langSection(l, content)
  ).join('')}${statBlockHtml(content.statBlock)}</div>`;
}

/** The part of a page that is one language's section, with its position. */
function sectionRange(html: string, lang: CampaignLang): { start: number; end: number } | null {
  const open = `<section class="campaign-lang" data-lang="${lang}">`;
  const start = html.indexOf(open);
  if (start < 0) return null;
  const end = html.indexOf('</section>', start);
  return end < 0 ? null : { start, end };
}

export class PageStructureError extends Error {}

function within(
  html: string,
  lang: CampaignLang
): { range: { start: number; end: number }; text: string } {
  const range = sectionRange(html, lang);
  if (!range) {
    throw new PageStructureError(
      `The ${lang === 'da' ? 'Danish' : 'English'} section of the page was edited away; restore it before merging`
    );
  }
  return { range, text: html.slice(range.start, range.end) };
}

/** The four entities summaryHtml writes; decoded in one pass so a decoded `&amp;lt;` stays text. */
const ENTITY_CHARS: Record<string, string> = { quot: '"', gt: '>', lt: '<', amp: '&' };

/** The summary text of one language (plain, without the *new* marker); '' when empty. */
export function readSummary(html: string, lang: CampaignLang): string {
  const { text } = within(html, lang);
  const m = /<div class="campaign-summary">([\s\S]*?)<\/div>/.exec(text);
  if (!m) return '';
  // Strip the "new" marker with its text, then every tag (an unterminated "<" too), until
  // nothing changes, so "<<b>script>" cannot leave a tag behind.
  let text_ = m[1];
  for (let prev = ''; prev !== text_; ) {
    prev = text_;
    text_ = text_.replace(/<em class="campaign-new">[^<]*<\/em>\s*|<[^>]*>?/g, '');
  }
  return text_
    .replace(/&(quot|gt|lt|amp);/g, (_all, name: string) => ENTITY_CHARS[name] ?? _all)
    .trim();
}

/** Put a summary into a language section whose summary is empty (an addition). */
export function setEmptySummary(html: string, lang: CampaignLang, text: string): string {
  const { range, text: section } = within(html, lang);
  const next = section.replace(/<div class="campaign-summary">[\s\S]*?<\/div>/, () =>
    summaryHtml(lang, text, true)
  );
  return html.slice(0, range.start) + next + html.slice(range.end);
}

/** Replace a summary (a change: it rewrites text the GM may have read or edited). */
export function replaceSummary(html: string, lang: CampaignLang, text: string): string {
  const { range, text: section } = within(html, lang);
  const next = section.replace(/<div class="campaign-summary">[\s\S]*?<\/div>/, () =>
    summaryHtml(lang, text, false)
  );
  return html.slice(0, range.start) + next + html.slice(range.end);
}

/** Add a relation line unless the page already has one for that name. Returns null when it did. */
export function addRelation(html: string, lang: CampaignLang, line: RelationLine): string | null {
  if (!line[lang]?.trim() && !line.to.trim()) return null;
  const { range, text: section } = within(html, lang);
  const key = escapeHtml(pageKey(line.to));
  if (section.includes(`<li data-to="${key}">`)) return null;
  const close = section.indexOf('</ul>', section.indexOf('class="campaign-relations"'));
  if (close < 0) throw new PageStructureError('The relations list of the page was edited away');
  const next = section.slice(0, close) + relationLi(lang, line, true) + section.slice(close);
  return html.slice(0, range.start) + next + html.slice(range.end);
}

/** Add a timeline line under its session block, unless that line (same link and text) is there. */
export function addTimelineLine(
  html: string,
  lang: CampaignLang,
  line: TimelineLine
): string | null {
  const text = line[lang]?.trim();
  if (!text) return null;
  const { range, text: section } = within(html, lang);
  const li = timelineLi(lang, line, true);
  const plain = timelineLi(lang, line, false);
  // Foundry stores a page's text with `"` and `>` where we wrote `&quot;` and `&gt;`, so compare
  // both sides after the same normalisation or a line with a quote is added again on every run.
  const stored = unescapeQuotes(section);
  if (stored.includes(unescapeQuotes(plain)) || stored.includes(unescapeQuotes(li))) return null;
  const marker = `<div class="campaign-session" data-session="${escapeHtml(line.session)}">`;
  const at = section.indexOf(marker);
  let next: string;
  if (at >= 0) {
    const close = section.indexOf('</ul>', at);
    if (close < 0) throw new PageStructureError('A session block of the page was edited broken');
    next = section.slice(0, close) + li + section.slice(close);
  } else {
    const tl = section.indexOf('class="campaign-timeline">');
    if (tl < 0) throw new PageStructureError('The timeline of the page was edited away');
    const end = section.lastIndexOf('</div>');
    next = section.slice(0, end) + sessionBlock(line.session, li) + section.slice(end);
  }
  return html.slice(0, range.start) + next + html.slice(range.end);
}

/** The stat block uuid the page links to, or null. */
export function readStatBlock(html: string): string | null {
  const m = /<p class="campaign-statblock" data-uuid="([^"]*)">/.exec(html);
  return m?.[1] ? m[1] : null;
}

export function setStatBlock(html: string, link: StatBlockLink): string {
  const next = statBlockHtml(link);
  return /<p class="campaign-statblock"[^>]*>[\s\S]*?<\/p>/.test(html)
    ? html.replace(/<p class="campaign-statblock"[^>]*>[\s\S]*?<\/p>/, () => next)
    : html.replace(/<\/div>\s*$/, () => `${next}</div>`);
}

/** Whether the page still carries a *new* marker. */
export function hasNewMarks(html: string): boolean {
  return html.includes('class="campaign-new"');
}

/** Clear every *new* marker ("seen"). */
export function clearNewMarks(html: string): string {
  return html.replace(/<em class="campaign-new">[^<]*<\/em>\s?/g, '');
}
