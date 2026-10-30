import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { markdownToHtml, readQuestNote, resolveQuestNote } from './quest-import.js';
import { rmTmp } from '../test-support/rm-tmp.js';

const WORLD = 'w1';
let vaultDir: string;

async function note(rel: string, text: string): Promise<string> {
  const full = path.join(vaultDir, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, text, 'utf8');
  return rel;
}

const QUEST = [
  '---',
  'type: quest-prep',
  'fvtt_uuid:',
  'ai_context: true',
  'secret: CANARY-QUEST-SECRET',
  'stakes: The village starves',
  '---',
  '%% GM hint, never imported. %%',
  '## Where it stands',
  'The **Sunsword** is in [[Vallaki|the town]].',
  '- Ask Ireena',
  '- Visit <script>alert(1)</script>',
].join('\n');

beforeEach(async () => {
  vaultDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'quest-import-'));
});

afterEach(async () => {
  await rmTmp(vaultDir);
});

describe('markdownToHtml', () => {
  it('escapes markup and keeps headings, lists and emphasis', () => {
    const html = markdownToHtml('# A\n\ntext *it* **b**\n- x\n- <b>y</b>');
    expect(html).toContain('<h2>A</h2>');
    expect(html).toContain('<em>it</em>');
    expect(html).toContain('<strong>b</strong>');
    expect(html).toContain('<li>&lt;b&gt;y&lt;/b&gt;</li>');
    expect(html).not.toContain('<b>');
  });
});

describe('resolveQuestNote', () => {
  it.each([
    ['Campaigns/w1/Prep/../AI Tool/x.md'],
    ['/etc/passwd.md'],
    ['C:/x/Prep.md'],
    ['Campaigns/w1/Prep/a\\b.md'],
    ['Campaigns/w2/Prep/Quest.md'],
    ['Campaigns/w1/AI Tool/Quest.md'],
    ['Campaigns/w1/Prep/Templates/Quest.md'],
    ['Campaigns/w1/Prep/Quest.txt'],
    ['Campaigns/w1/Prep/Quest.sync-conflict-20261028-1-AB.md'],
  ])('refuses %s', p => {
    expect(() => resolveQuestNote(vaultDir, WORLD, p)).toThrow();
  });

  it('accepts a note under Prep', () => {
    expect(resolveQuestNote(vaultDir, WORLD, 'Campaigns/w1/Prep/Quests/The Sunsword.md')).toContain(
      'The Sunsword.md'
    );
  });
});

describe('readQuestNote', () => {
  it('builds the title and html, without secret, ai_context or comments', async () => {
    const rel = await note('Campaigns/w1/Prep/Quests/The Sunsword.md', QUEST);
    const result = await readQuestNote(vaultDir, WORLD, rel);
    expect(result.title).toBe('The Sunsword');
    expect(result.html).toContain('Stakes:</strong> The village starves');
    expect(result.html).toContain('<strong>Sunsword</strong> is in the town.');
    expect(result.html).toContain('&lt;script&gt;');
    expect(result.html).not.toContain('<script>');
    expect(result.html).not.toContain('CANARY-QUEST-SECRET');
    expect(result.html).not.toContain('never imported');
    expect(result.html).not.toContain('ai_context');
  });

  it('puts the escaped title in the first <h1>, the only one on the page', async () => {
    const rel = await note('Campaigns/w1/Prep/Quests/The Sunsword.md', QUEST);
    const result = await readQuestNote(vaultDir, WORLD, rel);
    expect(result.html.startsWith('<h1>The Sunsword</h1>\n')).toBe(true);
    expect(result.html.match(/<h1>/g)).toHaveLength(1);
    const tricky = await note(
      'Campaigns/w1/Prep/Quests/Tricky.md',
      QUEST.replace('---', '---\ntitle: Tom & <b>Jerry</b>')
    );
    const html = (await readQuestNote(vaultDir, WORLD, tricky)).html;
    expect(html.startsWith('<h1>Tom &amp; &lt;b&gt;Jerry&lt;/b&gt;</h1>')).toBe(true);
  });

  it('refuses other types, a set fvtt_uuid, an empty note and a missing file', async () => {
    const base = 'Campaigns/w1/Prep/';
    const npc = await note(`${base}Npc.md`, QUEST.replace('quest-prep', 'npc-prep'));
    await expect(readQuestNote(vaultDir, WORLD, npc)).rejects.toThrow(/quest-prep/);
    const linked = await note(
      `${base}Linked.md`,
      QUEST.replace('fvtt_uuid:', 'fvtt_uuid: JournalEntry.a')
    );
    await expect(readQuestNote(vaultDir, WORLD, linked)).rejects.toThrow(/already points/);
    const empty = await note(
      `${base}Empty.md`,
      '---\ntype: quest-prep\nfvtt_uuid:\n---\n## Where it stands\n\n## Next steps\n'
    );
    await expect(readQuestNote(vaultDir, WORLD, empty)).rejects.toThrow(/empty/);
    await expect(readQuestNote(vaultDir, WORLD, `${base}Nope.md`)).rejects.toThrow(
      /not in the vault/
    );
  });

  it('refuses a note kept from Claude with ai_context: false', async () => {
    const rel = await note(
      'Campaigns/w1/Prep/Hidden.md',
      QUEST.replace('ai_context: true', 'ai_context: false')
    );
    await expect(readQuestNote(vaultDir, WORLD, rel)).rejects.toThrow(/ai_context: false/);
  });

  it('reads a null or ~ fvtt_uuid as empty', async () => {
    for (const empty of ['null', '~']) {
      const rel = await note(
        `Campaigns/w1/Prep/Null ${empty === '~' ? 'tilde' : 'word'}.md`,
        QUEST.replace('fvtt_uuid:', `fvtt_uuid: ${empty}`)
      );
      await expect(readQuestNote(vaultDir, WORLD, rel)).resolves.toMatchObject({
        title: expect.stringContaining('Null'),
      });
    }
  });

  it('refuses a folder that leads out of the vault', async () => {
    const outside = await fsp.mkdtemp(path.join(os.tmpdir(), 'quest-outside-'));
    try {
      await fsp.writeFile(path.join(outside, 'Evil.md'), QUEST, 'utf8');
      await fsp.mkdir(path.join(vaultDir, 'Campaigns/w1/Prep'), { recursive: true });
      try {
        await fsp.symlink(outside, path.join(vaultDir, 'Campaigns/w1/Prep/Link'), 'junction');
      } catch {
        return; // no permission to make a link here: nothing to test
      }
      await expect(
        readQuestNote(vaultDir, WORLD, 'Campaigns/w1/Prep/Link/Evil.md')
      ).rejects.toThrow(/leaves the Prep folder/);
    } finally {
      await rmTmp(outside);
    }
  });

  it('refuses a note over the size limit', async () => {
    const rel = await note(
      'Campaigns/w1/Prep/Big.md',
      `---\ntype: quest-prep\nfvtt_uuid:\n---\n${'x'.repeat(70_000)}`
    );
    await expect(readQuestNote(vaultDir, WORLD, rel)).rejects.toThrow(/KB/);
  });
});
