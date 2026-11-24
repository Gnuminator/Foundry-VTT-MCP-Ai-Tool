import { describe, expect, it } from 'vitest';

import {
  addRelation,
  addTimelineLine,
  clearNewMarks,
  journalId,
  pageId,
  readSummary,
  renderNewPage,
} from './model.js';
import { planCampaignMerge, planMarkSeen, type CampaignReader } from './plan.js';

function readerOf(store: Record<string, Record<string, string>>): CampaignReader {
  return {
    pages: async (kind): Promise<Array<{ id: string; name: string }> | null> => {
      const j = store[kind];
      return j ? Object.keys(j).map(id => ({ id, name: id })) : null;
    },
    content: async (kind, id) => store[kind][id],
  };
}

const opts = { setup: false, folderId: async (): Promise<string> => 'FOLDER' };
const timeline = {
  session: 'Session 00',
  ref: 'transcript.en#^u000001',
  time: '00:42',
  da: 'Han sagde noget',
  en: 'He said something',
};

describe('campaign model', () => {
  it('renders both languages, Danish first, with new marks', () => {
    const html = renderNewPage('npcs', {
      summary: { da: 'Kort', en: 'Short' },
      timeline: [timeline],
    });
    expect(html.indexOf('data-lang="da"')).toBeLessThan(html.indexOf('data-lang="en"'));
    expect(html).toContain('class="campaign-new">ny<');
    expect(html).toContain('class="campaign-new">new<');
    expect(readSummary(html, 'da')).toBe('Kort');
    expect(html).toContain('data-ref="transcript.en#^u000001"');
  });

  it('escapes text', () => {
    const html = renderNewPage('lore', { summary: { da: '<b>x</b>', en: 'a & b' } });
    expect(html).not.toContain('<b>x</b>');
    expect(readSummary(html, 'da')).toBe('<b>x</b>');
    expect(readSummary(html, 'en')).toBe('a & b');
  });

  it('does not add a line with a quote again after Foundry unescaped it', () => {
    const quoted = { ...timeline, en: 'He said "no" > yes' };
    const once = addTimelineLine(renderNewPage('npcs', {}), 'en', quoted)!;
    expect(once).toContain('&quot;no&quot; &gt; yes');
    // Foundry stores the page text with the characters unescaped.
    const stored = once.replace(/&quot;/g, '"').replace(/&gt;/g, '>');
    expect(addTimelineLine(stored, 'en', quoted)).toBeNull();
  });

  it('adds a line once and keeps hand edits', () => {
    const base = renderNewPage('npcs', {}).replace(
      '</div></section><section',
      '</div><p>my note</p></section><section'
    );
    const once = addTimelineLine(base, 'en', timeline)!;
    expect(once).toContain('my note');
    expect(addTimelineLine(once, 'en', timeline)).toBeNull();
    const second = addTimelineLine(once, 'en', { ...timeline, ref: 'x', en: 'More' })!;
    expect(second.match(/data-session="Session 00"/g)).toHaveLength(1);
    expect(addRelation(second, 'da', { to: 'Bram', da: 'bror' })).toContain('data-to="bram"');
  });

  it('clears new marks', () => {
    const html = renderNewPage('npcs', { summary: { da: 'a', en: 'b' } });
    expect(clearNewMarks(html)).not.toContain('campaign-new');
  });
});

describe('planCampaignMerge', () => {
  it('creates the empty journal and holds the entry when the journal is missing', async () => {
    const parts = await planCampaignMerge(
      [{ kind: 'npcs', name: 'Aldo', summary: { da: 'a', en: 'b' }, timeline: [timeline] }],
      readerOf({}),
      opts
    );
    expect(parts.changes).toHaveLength(0);
    expect(parts.additions).toHaveLength(1);
    const op = parts.additions[0];
    expect(op).toMatchObject({ kind: 'create', documentName: 'JournalEntry', keepId: true });
    const data = (op as { data: Record<string, unknown> }).data;
    expect(data._id).toBe(journalId('npcs'));
    expect(data.ownership).toEqual({ default: 0 });
    expect(data.folder).toBe('FOLDER');
    // The journal is made empty; the entry waits for the next plan (a plan cannot create into a
    // journal that does not exist yet).
    expect(data.pages).toEqual([]);
    expect(parts.held).toEqual([expect.objectContaining({ kind: 'npcs', name: 'Aldo' })]);
  });

  it('embeds a new page in an existing journal', async () => {
    const parts = await planCampaignMerge(
      [{ kind: 'npcs', name: 'Aldo', summary: { da: 'a', en: 'b' } }],
      readerOf({ npcs: {} }),
      opts
    );
    expect(parts.additions[0]).toMatchObject({
      kind: 'create',
      documentName: 'JournalEntryPage',
      parentUuid: `JournalEntry.${journalId('npcs')}`,
    });
  });

  it('puts additions to an existing page in additions and summary rewrites in changes', async () => {
    const id = pageId('npcs', 'Aldo');
    const html = renderNewPage('npcs', { summary: { da: 'gammel', en: 'old' } });
    const store = { npcs: { [id]: html } };
    const add = await planCampaignMerge(
      [
        {
          kind: 'npcs',
          name: 'Aldo',
          timeline: [timeline],
          summary: { da: 'ny tekst', en: 'new text' },
        },
      ],
      readerOf(store),
      opts
    );
    expect(add.changes).toHaveLength(0);
    expect(add.additions).toHaveLength(1);
    expect(add.warnings.join(' ')).toContain('differs');

    const rewrite = await planCampaignMerge(
      [
        {
          kind: 'npcs',
          name: 'Aldo',
          timeline: [timeline],
          summary: { da: 'ny tekst', en: 'new text' },
          replaceSummary: true,
        },
      ],
      readerOf(store),
      opts
    );
    expect(rewrite.additions).toHaveLength(0);
    expect(rewrite.changes).toHaveLength(1);
    expect(rewrite.changes[0]).toMatchObject({
      kind: 'update',
      uuid: `JournalEntry.${journalId('npcs')}.JournalEntryPage.${id}`,
    });
  });

  it('holds unconfirmed names and is idempotent for known lines', async () => {
    const id = pageId('npcs', 'Aldo');
    const html = addTimelineLine(renderNewPage('npcs', {}), 'en', timeline)!;
    const parts = await planCampaignMerge(
      [
        { kind: 'npcs', name: 'Aldo', timeline: [{ ...timeline, da: undefined }] },
        { kind: 'npcs', name: 'Barnoon', nameConfirmed: false },
      ],
      readerOf({ npcs: { [id]: html } }),
      opts
    );
    expect(parts.held).toHaveLength(1);
    expect(parts.additions).toHaveLength(0);
  });

  it('holds a page whose structure was edited away', async () => {
    const id = pageId('npcs', 'Aldo');
    const parts = await planCampaignMerge(
      [{ kind: 'npcs', name: 'Aldo', timeline: [timeline] }],
      readerOf({ npcs: { [id]: '<p>free text</p>' } }),
      opts
    );
    expect(parts.held[0].reason).toContain('edited away');
    expect(parts.additions).toHaveLength(0);
  });

  it('setup creates every missing journal', async () => {
    const parts = await planCampaignMerge([], readerOf({ lore: {} }), { ...opts, setup: true });
    expect(parts.additions).toHaveLength(7);
  });

  it('markSeen clears marks in a change plan', async () => {
    const id = pageId('npcs', 'Aldo');
    const html = renderNewPage('npcs', { summary: { da: 'a', en: 'b' } });
    const seen = await planMarkSeen(readerOf({ npcs: { [id]: html } }));
    expect(seen.ops).toHaveLength(1);
    expect(JSON.stringify(seen.ops[0])).not.toContain('campaign-new');
  });
});
