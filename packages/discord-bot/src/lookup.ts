/**
 * Player lookups in Discord (item discord-lookups, I-186): `/recap`, `/npc <name>` and `/handouts`
 * answer from the dashboard's player state (`/api/player/state`, the projection the /player page
 * uses) and from nothing else. Only handouts the GM revealed to everyone count: a handout that
 * names chosen players stays out, because Discord has no way to tell who is asking. The answer is
 * the handout's own text, never a summary and never an AI call, so nothing can invent a fact.
 */

import { bi } from './i18n.js';

/** The fields of a revealed handout the lookups read (a subset of the player state's handout). */
interface LookupHandout {
  id: string;
  title: string;
  html: string;
  revealedAt: string | null;
}

export const NOTHING_REVEALED = bi('Intet afsløret endnu.', 'Nothing revealed yet.');
export const LOOKUP_UNAVAILABLE = bi(
  'Kan ikke hente det lige nu. Prøv igen om lidt.',
  'Could not look that up right now. Try again in a moment.'
);

export const LOOKUP_NOT_HERE = bi(
  'Det her virker kun i spillets server.',
  'This only works in the game server.'
);
const CLIPPED = bi('(Mere på spillersiden.)', '(More on the player page.)');

/** Discord allows 2000 characters in a message; the clip note fits inside this. */
const MAX_ANSWER = 1800;
const MAX_LIST = 25;
const RECAP_TITLE = /(^|[^\p{L}])(recap|resum[eé]|referat)($|[^\p{L}])/iu;

/** Lookups run in a server, and in the configured one when the bot has one (never in a DM). */
export function lookupAllowed(
  interactionGuildId: string | null,
  configuredGuildId: string | undefined
): boolean {
  if (!interactionGuildId) return false;
  return !configuredGuildId || interactionGuildId === configuredGuildId;
}

/** The reply for one command; a failed read (null) is "could not look that up", never a guess. */
export function lookupReply(command: string, name: string, state: unknown): string {
  if (state === null) return LOOKUP_UNAVAILABLE;
  if (command === 'recap') return recapAnswer(state);
  if (command === 'npc') return npcAnswer(state, name);
  return handoutsAnswer(state);
}

/** The handouts every player may see: revealed, with no list of chosen players. */
export function publicHandouts(state: unknown): LookupHandout[] {
  const list = (state as { handouts?: unknown } | null)?.handouts;
  if (!Array.isArray(list)) return [];
  const out: LookupHandout[] = [];
  for (const h of list) {
    if (!h || typeof h !== 'object') continue;
    const r = h as Record<string, unknown>;
    if (typeof r['title'] !== 'string' || typeof r['html'] !== 'string') continue;
    if (Array.isArray(r['players']) && r['players'].length > 0) continue;
    out.push({
      id: typeof r['id'] === 'string' ? r['id'] : r['title'],
      title: r['title'],
      html: r['html'],
      revealedAt: typeof r['revealedAt'] === 'string' ? r['revealedAt'] : null,
    });
  }
  return out;
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

const BLOCK_ENDS = new Set(['br', 'p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr']);

/**
 * Drops every tag by scanning for `<` to the next `>` (an unclosed `<` drops the rest), with the
 * text of script and style elements; a block element's end becomes a line break. The output is
 * plain text for Discord, never HTML.
 */
function stripTags(html: string): string {
  let out = '';
  let i = 0;
  while (i < html.length) {
    const open = html.indexOf('<', i);
    if (open === -1) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, open);
    const close = html.indexOf('>', open);
    if (close === -1) break;
    const tag = html.slice(open + 1, close).trim();
    const closing = tag.startsWith('/');
    const name = (/^\/?\s*([a-z][a-z0-9]*)/i.exec(tag)?.[1] ?? '').toLowerCase();
    i = close + 1;
    if (!closing && (name === 'script' || name === 'style')) {
      const end = html.toLowerCase().indexOf(`</${name}`, i);
      const endClose = end === -1 ? -1 : html.indexOf('>', end);
      i = endClose === -1 ? html.length : endClose + 1;
    } else if ((closing || name === 'br') && BLOCK_ENDS.has(name)) {
      out += '\n';
    }
  }
  return out;
}

/** The visible text of sanitized handout HTML: tags dropped, block ends kept as line breaks. */
export function htmlToText(html: string): string {
  return stripTags(html)
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, m => ENTITIES[m] ?? m)
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function clip(text: string): string {
  // Counted in UTF-16 units (JS length), the safe reading of Discord's limit; cut on whole characters.
  if (text.length <= MAX_ANSWER) return text;
  let kept = '';
  for (const ch of text) {
    if (kept.length + ch.length > MAX_ANSWER - 60) break;
    kept += ch;
  }
  return `${kept.trimEnd()}…\n${CLIPPED}`;
}

function answer(h: LookupHandout): string {
  const body = htmlToText(h.html);
  return clip(body ? `**${h.title}**\n${body}` : `**${h.title}**`);
}

/** The newest handout first (by reveal time; without a time, later in the list is newer). */
function newestFirst(list: readonly LookupHandout[]): LookupHandout[] {
  const time = (h: LookupHandout): number => {
    const t = h.revealedAt ? Date.parse(h.revealedAt) : NaN;
    return Number.isNaN(t) ? -Infinity : t;
  };
  return list
    .map((h, i) => ({ h, i }))
    .sort((a, b) => {
      const d = time(b.h) - time(a.h);
      return d !== 0 && !Number.isNaN(d) ? d : b.i - a.i;
    })
    .map(x => x.h);
}

/** `/recap`: the newest revealed handout whose title says recap. */
export function recapAnswer(state: unknown): string {
  const recap = newestFirst(publicHandouts(state)).find(h => RECAP_TITLE.test(h.title));
  return recap ? answer(recap) : NOTHING_REVEALED;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `/npc <name>`: a revealed handout whose title is the name, starts with it, or holds it as whole
 * words, in that order. No guessing beyond that: a near miss answers "nothing revealed yet".
 */
export function npcAnswer(state: unknown, name: string): string {
  const q = norm(name);
  if (!q) return NOTHING_REVEALED;
  const list = publicHandouts(state);
  const words = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(q)}($|[^\\p{L}\\p{N}])`, 'u');
  const tiers: ((t: string) => boolean)[] = [
    (t): boolean => t === q,
    (t): boolean => t.startsWith(q),
    (t): boolean => words.test(t),
  ];
  for (const test of tiers) {
    const hit = list.find(h => test(norm(h.title)));
    if (hit) return answer(hit);
  }
  return NOTHING_REVEALED;
}

/** `/handouts`: the titles of what has been revealed, newest first. */
export function handoutsAnswer(state: unknown): string {
  const list = newestFirst(publicHandouts(state));
  if (list.length === 0) return NOTHING_REVEALED;
  const shown = list.slice(0, MAX_LIST).map(h => `- ${h.title}`);
  const more = list.length > MAX_LIST ? `\n… +${list.length - MAX_LIST}` : '';
  return clip(shown.join('\n') + more);
}

interface LookupReaderOptions {
  dashboardUrl: string;
  token?: string | undefined;
  fetch?: typeof fetch;
  log?: (message: string) => void;
}

/** Reads the player state from the dashboard; null on any failure. */
export function createPlayerStateReader(options: LookupReaderOptions): () => Promise<unknown> {
  const doFetch = options.fetch ?? fetch;
  const url = `${options.dashboardUrl.replace(/\/+$/, '')}/api/player/state`;
  return async () => {
    try {
      const res = await doFetch(url, {
        headers: options.token ? { 'X-CoGM-Token': options.token } : {},
        signal: AbortSignal.timeout(1500),
      });
      return res.ok ? ((await res.json()) as unknown) : null;
    } catch (err) {
      options.log?.(`Lookup: could not read ${url} (${(err as Error).message})`);
      return null;
    }
  };
}
