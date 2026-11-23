import { describe, expect, it } from 'vitest';

import { addRelation, addTimelineLine, renderNewPage } from '../campaign/model.js';
import { isCampaignPageHtml, prepareCampaignHtml } from './campaign-mirror.js';
import { htmlToMarkdown } from './html-to-md.js';
import type { LinkContext } from './mirror-common.js';

const link: LinkContext = {
  pageUuid: 'JournalEntry.AAAAAAAAAAAAAAAA.JournalEntryPage.BBBBBBBBBBBBBBBB',
  openBase: '',
  resolve: () => null,
  fromPath: 'AI Tool/Foundry/Journals/Campaign/NPCs/Aldo.md',
};

describe('campaign pages in the mirror', () => {
  it('recognises a campaign page and nothing else', () => {
    expect(isCampaignPageHtml(renderNewPage('npcs', {}))).toBe(true);
    expect(isCampaignPageHtml('<p>other</p>')).toBe(false);
  });

  it('turns relations, transcript refs and session headings into wikilinks', () => {
    let html = renderNewPage('npcs', { summary: { da: 'Kort', en: 'Short' } });
    html = addRelation(html, 'en', { to: 'Bram', en: 'friend' })!;
    html = addTimelineLine(html, 'en', {
      session: 'Session 00',
      ref: 'transcript.en#^u000001',
      time: '00:10',
      en: 'Said hello',
    })!;
    const prepared = prepareCampaignHtml(html);
    const md = prepared.restore(htmlToMarkdown(prepared.html, link));
    expect(md).toContain('[[Bram]]: friend');
    expect(md).toContain('[[transcript.en#^u000001|00:10]] Said hello');
    expect(md).toContain('[[Session 00]]');
    expect(md).toContain('*new*');
    expect(md).not.toContain('CAMPAIGNLINK');
    expect(md.indexOf('Dansk')).toBeLessThan(md.indexOf('English'));
  });

  it('keeps characters that would break a wikilink out of it', () => {
    const html = renderNewPage('npcs', {
      relations: [{ to: 'A|B]]', en: 'x' }],
    });
    const prepared = prepareCampaignHtml(html);
    expect(prepared.restore(prepared.html)).toContain('[[A B]]');
  });
});
