/**
 * Campaign merge planning (D-151): from the entries a caller wants merged and what Foundry holds
 * now, build the guarded ops, split in two plans. Additions (a new page, a new timeline line,
 * relation or stat block link, a first summary) can apply at once when the GM switched that on.
 * Changes (a summary replaced, a stat block link changed, "seen" clearing the *new* marks) always
 * wait for a confirm. A page with any change goes wholly into the changes plan, so the two plans
 * never touch the same page (an apply refuses a page that moved since its plan).
 */
import { MODULE_ID, type GuardedOp } from '@gnuminator/shared';

import {
  CAMPAIGN_JOURNALS,
  CAMPAIGN_KINDS,
  CAMPAIGN_LANGS,
  PageStructureError,
  addRelation,
  addTimelineLine,
  clearNewMarks,
  hasNewMarks,
  journalId,
  pageId,
  readStatBlock,
  readSummary,
  renderNewPage,
  replaceSummary,
  setEmptySummary,
  setStatBlock,
  type CampaignKind,
  type NewPageContent,
} from './model.js';

/** Foundry's JournalEntryPage text format for HTML. */
const HTML_FORMAT = 1;
const NONE = 0;
const MAX_SEEN_OPS = 200;

export interface CampaignEntry extends NewPageContent {
  kind: CampaignKind;
  /** The page's name: the NPC, place or session it is about. */
  name: string;
  /** False: the name is not confirmed yet (names check page), so the entry is held back. */
  nameConfirmed?: boolean | undefined;
  /** Replace a summary that is already there (a change that waits for a confirm). */
  replaceSummary?: boolean | undefined;
}

/** What the planner needs to know about Foundry. Implemented over the bridge by the tool. */
export interface CampaignReader {
  /** The pages of a campaign journal (ids and names), or null when the journal does not exist. */
  pages(kind: CampaignKind): Promise<Array<{ id: string; name: string }> | null>;
  /** One page's HTML. */
  content(kind: CampaignKind, pageId: string): Promise<string>;
}

export interface HeldEntry {
  kind: CampaignKind;
  name: string;
  reason: string;
}

interface CampaignPlanParts {
  additions: GuardedOp[];
  changes: GuardedOp[];
  additionLines: string[];
  changeLines: string[];
  held: HeldEntry[];
  warnings: string[];
}

interface Working {
  kind: CampaignKind;
  name: string;
  id: string;
  /** Existing page's HTML at read time; null for a page this plan creates. */
  original: string | null;
  html: string;
  change: boolean;
  lines: string[];
}

function pageUuid(kind: CampaignKind, id: string): string {
  return `JournalEntry.${journalId(kind)}.JournalEntryPage.${id}`;
}

function pageData(w: Working, sort: number): Record<string, unknown> {
  return {
    _id: w.id,
    name: w.name,
    type: 'text',
    sort,
    text: { content: w.html, format: HTML_FORMAT },
    flags: { [MODULE_ID]: { campaign: { kind: w.kind } } },
  };
}

export async function planCampaignMerge(
  entries: CampaignEntry[],
  reader: CampaignReader,
  options: { setup: boolean; folderId: () => Promise<string> }
): Promise<CampaignPlanParts> {
  const out: CampaignPlanParts = {
    additions: [],
    changes: [],
    additionLines: [],
    changeLines: [],
    held: [],
    warnings: [],
  };
  const journals = new Map<CampaignKind, Array<{ id: string; name: string }> | null>();
  const load = async (kind: CampaignKind): Promise<Array<{ id: string; name: string }> | null> => {
    if (!journals.has(kind)) journals.set(kind, await reader.pages(kind));
    return journals.get(kind)!;
  };
  const working = new Map<string, Working>();

  for (const entry of entries) {
    const name = entry.name.trim();
    if (!name) throw new Error('A campaign entry needs a name');
    if (entry.nameConfirmed === false) {
      out.held.push({
        kind: entry.kind,
        name,
        reason: 'The name is not confirmed yet (names check page); nothing was planned for it',
      });
      continue;
    }
    const id = pageId(entry.kind, name);
    const key = `${entry.kind}:${id}`;
    const pages = await load(entry.kind);
    let w = working.get(key);
    const warn = (text: string): number =>
      out.warnings.push(`${CAMPAIGN_JOURNALS[entry.kind].en} / ${name}: ${text}`);

    if (!w) {
      if (pages?.some(p => p.id === id)) {
        const html = await reader.content(entry.kind, id);
        w = { kind: entry.kind, name, id, original: html, html, change: false, lines: [] };
      } else {
        const html = renderNewPage(entry.kind, entry);
        w = {
          kind: entry.kind,
          name,
          id,
          original: null,
          html,
          change: false,
          lines: ['new page'],
        };
        working.set(key, w);
        for (const lang of CAMPAIGN_LANGS) {
          if (!entry.summary?.[lang]?.trim())
            warn(`no ${lang === 'da' ? 'Danish' : 'English'} summary`);
        }
        continue;
      }
      working.set(key, w);
    }

    try {
      for (const lang of CAMPAIGN_LANGS) {
        const text = entry.summary?.[lang]?.trim();
        if (text) {
          const current = readSummary(w.html, lang);
          if (!current) {
            w.html = setEmptySummary(w.html, lang, text);
            w.lines.push(`${lang} summary added`);
          } else if (current !== text) {
            if (entry.replaceSummary) {
              w.html = replaceSummary(w.html, lang, text);
              w.change = true;
              w.lines.push(`${lang} summary replaced`);
            } else {
              warn(`the ${lang} summary differs and was kept (set replaceSummary to replace it)`);
            }
          }
        }
        for (const rel of entry.relations ?? []) {
          const next = addRelation(w.html, lang, rel);
          if (next !== null) {
            w.html = next;
            w.lines.push(`${lang} relation to ${rel.to}`);
          }
        }
        for (const line of entry.timeline ?? []) {
          const next = addTimelineLine(w.html, lang, line);
          if (next !== null) {
            w.html = next;
            w.lines.push(`${lang} timeline line in ${line.session}`);
          }
        }
      }
      if (entry.statBlock) {
        const current = readStatBlock(w.html);
        if (current !== entry.statBlock.uuid) {
          w.html = setStatBlock(w.html, entry.statBlock);
          if (current) w.change = true;
          w.lines.push(current ? 'stat block link changed' : 'stat block link added');
        }
      }
      for (const rel of entry.relations ?? []) {
        if (!rel.da?.trim() || !rel.en?.trim())
          warn(`the relation to ${rel.to} has only one language`);
      }
      for (const line of entry.timeline ?? []) {
        if (!line.da?.trim() || !line.en?.trim())
          warn(`a timeline line in ${line.session} has only one language`);
      }
    } catch (error) {
      if (error instanceof PageStructureError) {
        out.held.push({ kind: entry.kind, name, reason: error.message });
        working.delete(key);
        continue;
      }
      throw error;
    }
  }

  // The journals: created when missing (with their new pages inside), else new pages are embedded.
  const needJournal = new Set<CampaignKind>();
  if (options.setup) for (const kind of CAMPAIGN_KINDS) needJournal.add(kind);
  for (const w of working.values()) if (w.original === null) needJournal.add(w.kind);
  let folder: string | null = null;
  for (const kind of CAMPAIGN_KINDS) {
    const pages = await load(kind);
    const created = [...working.values()].filter(w => w.kind === kind && w.original === null);
    if (pages === null && !needJournal.has(kind)) continue;
    if (pages === null) {
      folder ??= await options.folderId();
      // The journal is made empty, and the entries for it wait for the next plan (a plan cannot
      // create into a journal that does not exist yet). That keeps the undo of this change simple:
      // it deletes the journal only while it is still empty (the undo guard in tools/campaign-merge.ts).
      out.additions.push({
        kind: 'create',
        documentName: 'JournalEntry',
        keepId: true,
        data: {
          _id: journalId(kind),
          name: CAMPAIGN_JOURNALS[kind].name,
          folder,
          ownership: { default: NONE },
          flags: { [MODULE_ID]: { campaign: { kind } } },
          pages: [],
        },
      });
      out.additionLines.push(`journal "${CAMPAIGN_JOURNALS[kind].name}" (GM-only)`);
      for (const w of created) {
        out.held.push({
          kind,
          name: w.name,
          reason: `The journal "${CAMPAIGN_JOURNALS[kind].name}" is made by this plan; apply it, then plan this entry again`,
        });
      }
      continue;
    }
    const existing = pages?.length ?? 0;
    created.forEach((w, i) => {
      out.additions.push({
        kind: 'create',
        documentName: 'JournalEntryPage',
        parentUuid: `JournalEntry.${journalId(kind)}`,
        keepId: true,
        data: pageData(w, (existing + i + 1) * 100_000),
      });
      out.additionLines.push(`${CAMPAIGN_JOURNALS[kind].en} / ${w.name}: new page`);
    });
  }

  // Existing pages that changed.
  for (const w of working.values()) {
    if (w.original === null || w.html === w.original) continue;
    const op: GuardedOp = {
      kind: 'update',
      uuid: pageUuid(w.kind, w.id),
      changes: { 'text.content': w.html },
    };
    const line = `${CAMPAIGN_JOURNALS[w.kind].en} / ${w.name}: ${w.lines.join(', ')}`;
    if (w.change) {
      out.changes.push(op);
      out.changeLines.push(line);
    } else {
      out.additions.push(op);
      out.additionLines.push(line);
    }
  }
  return out;
}

/** "Seen": clear the *new* marks of every campaign page that still carries them. A change plan. */
export async function planMarkSeen(
  reader: CampaignReader
): Promise<{ ops: GuardedOp[]; lines: string[] }> {
  const ops: GuardedOp[] = [];
  const lines: string[] = [];
  for (const kind of CAMPAIGN_KINDS) {
    const pages = await reader.pages(kind);
    for (const p of pages ?? []) {
      const html = await reader.content(kind, p.id);
      if (!hasNewMarks(html)) continue;
      // A plan holds at most 200 ops; the rest waits for the next markSeen.
      if (ops.length >= MAX_SEEN_OPS) return { ops, lines };
      ops.push({
        kind: 'update',
        uuid: pageUuid(kind, p.id),
        changes: { 'text.content': clearNewMarks(html) },
      });
      lines.push(`${CAMPAIGN_JOURNALS[kind].en} / ${p.name}: new marks cleared`);
    }
  }
  return { ops, lines };
}
