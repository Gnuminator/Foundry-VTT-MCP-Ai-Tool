/**
 * Session prep scan (idea I-045): a read-only look at what only Foundry knows
 * for the GM's prep digest. Runs on the GM client.
 *
 * - Quests: journals with a text page that has the quest layout's Status line
 *   (`<li><strong>Status:</strong> Active</li>`, written by `create-quest-journal`).
 * - Campaigns: journals with `campaign-status-toggle` spans (written by
 *   `create-campaign-dashboard`). A part's status is the journal's
 *   `world.campaignStatus` flag (key `<campaignId>-<partId>`), else the toggle's
 *   CSS class, else not started.
 * - Next session: the GM's prep notes journal as plain text.
 * - Bosses: tokens on every scene whose actor has legendary actions, legendary
 *   resistances or a lair (`bossResources`).
 *
 * The wire contract is `shared/src/prep-digest.ts`; only its types are imported
 * (the browser cannot resolve `@gnuminator/shared` at runtime). The query name
 * and the two constants are mirrored here and pinned by `prep-scan.test.ts`.
 */
import type {
  CampaignPartStatus,
  PrepBoss,
  PrepCampaign,
  PrepCampaignPart,
  PrepNextSession,
  PrepNotePage,
  PrepQuest,
  PrepScan,
} from '@gnuminator/shared';

import { bossResources } from './data-access/combat.js';

/** Query name (mirror of the shared `PREP_SCAN_QUERY`). */
export const PREP_SCAN_QUERY = 'getPrepScan';

/** Mirror of the shared `NEXT_SESSION_JOURNAL_NAME`. */
export const NEXT_SESSION_JOURNAL_NAME = 'Next session';

/** Mirror of the shared `CLOSED_QUEST_STATUSES`. */
export const CLOSED_QUEST_STATUSES: readonly string[] = [
  'completed',
  'complete',
  'done',
  'failed',
  'abandoned',
];

/** Plain-text limit of one "Next session" page. */
const MAX_NOTE_CHARS = 2000;

const PART_STATUSES: readonly CampaignPartStatus[] = [
  'not_started',
  'in_progress',
  'completed',
  'skipped',
];

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec | null {
  return value !== null && typeof value === 'object' ? (value as Rec) : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** `collection.contents` read defensively (Foundry `Collection#contents`), else an array as is. */
function contentsOf(collection: unknown): unknown[] {
  if (Array.isArray(collection)) return collection;
  const contents = rec(collection)?.contents;
  return Array.isArray(contents) ? contents : [];
}

// ---------------------------------------------------------------------------
// Text helpers (string based, no DOM, so they run in node tests)
// ---------------------------------------------------------------------------

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, '&');
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** HTML to plain text: block tags become spaces, other tags vanish, entities are decoded. */
export function htmlToText(html: string): string {
  const noBlocks = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  const spaced = noBlocks.replace(
    /<\/?(?:br|p|div|li|ul|ol|tr|td|th|h[1-6]|hr|section)\b[^>]*>/gi,
    ' '
  );
  return collapse(decodeEntities(spaced.replace(/<[^>]*>/g, '')));
}

/** The text content pages of a journal, as `{ id, name, html }`. */
function textPages(journal: unknown): Array<{ id: string; name: string; html: string }> {
  const out: Array<{ id: string; name: string; html: string }> = [];
  for (const page of contentsOf(rec(journal)?.pages)) {
    const p = rec(page);
    if (!p || (p.type !== undefined && p.type !== 'text')) continue;
    const html = str(rec(p.text)?.content);
    if (html === null) continue;
    out.push({ id: str(p.id) ?? '', name: str(p.name) ?? '', html });
  }
  return out;
}

function isNextSession(journal: unknown): boolean {
  const name = str(rec(journal)?.name);
  return name !== null && name.trim().toLowerCase() === NEXT_SESSION_JOURNAL_NAME.toLowerCase();
}

// ---------------------------------------------------------------------------
// Quests
// ---------------------------------------------------------------------------

/** The quest layout's Status line: `<strong>Status:</strong> Active` (text before the next tag). */
const QUEST_STATUS = /<strong>\s*Status:\s*<\/strong>\s*([^<]*)/i;

/** The Status text of the first page that has one, or null (not a quest journal). */
export function questStatusOf(journal: unknown): string | null {
  for (const page of textPages(journal)) {
    const hit = QUEST_STATUS.exec(page.html);
    const status = hit?.[1] ? collapse(decodeEntities(hit[1])) : '';
    if (status.length > 0) return status;
  }
  return null;
}

function scanQuests(journals: unknown[]): PrepQuest[] {
  const out: PrepQuest[] = [];
  for (const journal of journals) {
    const j = rec(journal);
    if (!j || isNextSession(journal)) continue;
    const status = questStatusOf(journal);
    if (status === null) continue;
    out.push({
      journalId: str(j.id) ?? '',
      name: str(j.name) ?? '',
      status,
      open: !CLOSED_QUEST_STATUSES.includes(status.toLowerCase()),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Campaign dashboards
// ---------------------------------------------------------------------------

function attr(tag: string, name: string): string | null {
  const hit = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag);
  return hit?.[1] !== undefined ? decodeEntities(hit[1]) : null;
}

function classStatus(tag: string): CampaignPartStatus | null {
  const cls = attr(tag, 'class');
  if (cls === null) return null;
  const tokens = cls.split(/\s+/).map(t => t.replace(/-/g, '_'));
  return PART_STATUSES.find(status => tokens.includes(status)) ?? null;
}

function campaignFlags(journal: unknown): Rec {
  const j = rec(journal);
  const getFlag = j?.getFlag;
  let flags: unknown;
  if (typeof getFlag === 'function') {
    try {
      flags = (getFlag as (scope: string, key: string) => unknown).call(
        journal,
        'world',
        'campaignStatus'
      );
    } catch {
      flags = undefined;
    }
  } else {
    flags = rec(rec(j?.flags)?.world)?.campaignStatus;
  }
  return rec(flags) ?? {};
}

/** Heading text for the toggle that ends `before`: a sub-part line, else the last `<h3>`. */
function partTitle(before: string): string | null {
  const sub = /<strong>([^<]*)<\/strong>\s*-\s*Status:\s*$/i.exec(before);
  if (sub?.[1]) return collapse(decodeEntities(sub[1])) || null;
  let last: string | null = null;
  for (const hit of before.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)) last = hit[1] ?? null;
  if (last === null) return null;
  const title = htmlToText(last).replace(/^\[LOCKED\]\s*/i, '');
  return title.length > 0 ? title : null;
}

/** Campaigns of one journal (usually one; grouped by `data-campaign-id`). */
function campaignsOf(journal: unknown): PrepCampaign[] {
  const j = rec(journal);
  if (!j) return [];
  const flags = campaignFlags(journal);
  const byCampaign = new Map<string, PrepCampaign>();
  for (const page of textPages(journal)) {
    let segmentStart = 0;
    const toggles = page.html.matchAll(/<[a-z]+\b[^>]*\bcampaign-status-toggle\b[^>]*>/gi);
    for (const match of toggles) {
      const tag = match[0];
      const before = page.html.slice(segmentStart, match.index);
      segmentStart = (match.index ?? 0) + tag.length;
      const campaignId = attr(tag, 'data-campaign-id');
      const partId = attr(tag, 'data-part-id');
      if (!campaignId || !partId) continue;
      let campaign = byCampaign.get(campaignId);
      if (!campaign) {
        campaign = { journalId: str(j.id) ?? '', name: str(j.name) ?? '', campaignId, parts: [] };
        byCampaign.set(campaignId, campaign);
      }
      if (campaign.parts.some(part => part.partId === partId)) continue;
      const flagged = flags[`${campaignId}-${partId}`];
      const status: CampaignPartStatus =
        PART_STATUSES.find(s => s === flagged) ?? classStatus(tag) ?? 'not_started';
      const part: PrepCampaignPart = { partId, title: partTitle(before) ?? partId, status };
      campaign.parts.push(part);
    }
  }
  return [...byCampaign.values()];
}

function scanCampaigns(journals: unknown[]): PrepCampaign[] {
  return journals.filter(journal => !isNextSession(journal)).flatMap(campaignsOf);
}

// ---------------------------------------------------------------------------
// Next session
// ---------------------------------------------------------------------------

interface PermissionTester {
  testUserPermission?: (user: unknown, level: string) => unknown;
}

function permitted(doc: unknown, user: unknown, level: string): boolean {
  const test = (doc as PermissionTester | null)?.testUserPermission;
  return typeof test === 'function' && test.call(doc, user, level) === true;
}

function scanNextSession(journals: unknown[]): PrepNextSession | null {
  const journal = journals.find(isNextSession);
  const j = rec(journal);
  if (!j) return null;

  const pages: PrepNotePage[] = [];
  for (const page of textPages(journal)) {
    const text = htmlToText(page.html);
    const truncated = text.length > MAX_NOTE_CHARS;
    pages.push({
      pageId: page.id,
      name: page.name,
      text: truncated ? text.slice(0, MAX_NOTE_CHARS).trimEnd() : text,
      truncated,
    });
  }

  const nonGm = contentsOf(rec(game as unknown)?.users).filter(user => rec(user)?.isGM !== true);
  const docs: unknown[] = [journal, ...contentsOf(j.pages)];
  const playerVisible = nonGm.some(user => docs.some(doc => permitted(doc, user, 'OBSERVER')));

  return { journalId: str(j.id) ?? '', name: str(j.name) ?? '', pages, playerVisible };
}

// ---------------------------------------------------------------------------
// Bosses
// ---------------------------------------------------------------------------

function scanBosses(): PrepBoss[] {
  const out: PrepBoss[] = [];
  for (const scene of contentsOf(rec(game as unknown)?.scenes)) {
    const s = rec(scene);
    if (!s) continue;
    for (const token of contentsOf(s.tokens)) {
      const t = rec(token);
      if (!t) continue;
      // `token.actor` is the synthetic actor for an unlinked token (carries its own counters).
      const actor = t.actor;
      const boss = bossResources(actor);
      if (!boss) continue;
      out.push({
        sceneId: str(s.id) ?? '',
        sceneName: str(s.name) ?? '',
        tokenId: str(t.id) ?? '',
        tokenName: str(t.name) ?? '',
        actorName: str(rec(actor)?.name) ?? str(t.name) ?? '',
        hidden: t.hidden === true,
        legendary: boss.legendary,
        resistances: boss.resistances,
        lair: boss.lair,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The query
// ---------------------------------------------------------------------------

/** `getPrepScan`: quests, campaign parts, the Next session journal and bosses. GM client only (gated by the caller). */
export function getPrepScan(): PrepScan {
  const journals = contentsOf(rec(game as unknown)?.journal);
  return {
    schema: 1,
    computedAt: Date.now(),
    quests: scanQuests(journals),
    campaigns: scanCampaigns(journals),
    nextSession: scanNextSession(journals),
    bosses: scanBosses(),
  };
}
