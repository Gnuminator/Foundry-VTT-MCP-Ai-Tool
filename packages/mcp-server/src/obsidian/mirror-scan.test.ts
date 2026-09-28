/**
 * The vault scan of the Foundry mirror (docs/OBSIDIAN-O4-DESIGN.md 2.1): what
 * it recognizes, which note wins a uuid, what it never follows, and its caps.
 * Everything runs in temp folders.
 */
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pathKey, type ScannedNote } from './mirror-common.js';
import {
  parseFrontmatter,
  parseScalar,
  SCAN_FRONTMATTER_MAX_BYTES,
  SCAN_HEAD_BYTES,
  SCAN_MAX_DEPTH,
  SCAN_MAX_FILES,
  scanCampaign,
} from './mirror-scan.js';
import { campaignDir } from './note-writer.js';
import { withGeneratedHash } from './ownership.js';

const WORLD = 'strahd-test';
/** Built at run time so the source has no invisible or ambiguous characters. */
const EACUTE = String.fromCharCode(0xe9);
const EACUTE_UPPER = String.fromCharCode(0xc9);
const BS = String.fromCharCode(92);
let tmp: string;
let vault: string;
let outside: string;
let root: string;

beforeEach(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'mirror-scan-'));
  vault = path.join(tmp, 'vault');
  outside = path.join(tmp, 'outside');
  await fsp.mkdir(vault, { recursive: true });
  await fsp.mkdir(outside, { recursive: true });
  root = campaignDir(vault, WORLD);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fsp.rm(tmp, { recursive: true, force: true });
});

interface NoteSpec {
  type: string;
  uuid: string;
  name?: string;
  sig?: string;
  journal?: string;
}

/** A mirror note as the renderer writes it: JSON-quoted values, hash filled in. */
function mirrorText(spec: NoteSpec, body = 'Body'): string {
  const lines = ['---', `type: ${JSON.stringify(spec.type)}`];
  if (spec.name !== undefined) lines.push(`name: ${JSON.stringify(spec.name)}`);
  lines.push(`fvtt_uuid: ${JSON.stringify(spec.uuid)}`);
  if (spec.sig !== undefined) lines.push(`fvtt_sig: ${JSON.stringify(spec.sig)}`);
  if (spec.journal !== undefined) lines.push(`fvtt_journal: ${JSON.stringify(spec.journal)}`);
  lines.push('generated_by: "foundry-ai-tool"', 'generated_hash: ""', '---', body, '');
  return withGeneratedHash(lines.join('\n'));
}

/** The GM changed a word of the body: the hash no longer matches. */
function edited(text: string): string {
  return text.replace('Body', 'Body, edited');
}

async function put(rel: string, text: string): Promise<void> {
  const full = path.join(root, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, text, 'utf8');
}

async function tryDirLink(target: string, link: string): Promise<boolean> {
  try {
    await fsp.mkdir(path.dirname(link), { recursive: true });
    await fsp.symlink(target, link, 'junction');
    return true;
  } catch {
    return false;
  }
}

function note(
  notePath: string,
  spec: NoteSpec,
  flags: { inside: boolean; owned: boolean }
): ScannedNote {
  return {
    path: notePath,
    uuid: spec.uuid,
    type: spec.type,
    sig: spec.sig ?? null,
    insideFence: flags.inside,
    owned: flags.owned,
    name: spec.name ?? null,
    journalUuid: spec.journal ?? null,
  };
}

const paths = (notes: ScannedNote[]): string[] => notes.map(n => n.path);

describe('scanCampaign: mirror notes', () => {
  it('finds notes by their properties, inside and outside the fence, edited or not', async () => {
    const wolf: NoteSpec = { type: 'npc', uuid: 'Actor.wolf', name: 'Wolf', sig: 's-wolf' };
    const hero: NoteSpec = { type: 'pc', uuid: 'Actor.hero', name: 'Hero' };
    const bear: NoteSpec = { type: 'npc', uuid: 'Actor.bear', name: 'Bear' };
    await put('AI Tool/Foundry/NPCs/Wolf.md', mirrorText(wolf));
    await put('AI Tool/Foundry/PCs/Hero.md', edited(mirrorText(hero)));
    await put('Elsewhere/Deep/Bear.md', mirrorText(bear)); // moved by the GM

    const scan = await scanCampaign(vault, WORLD);
    expect([...scan.mirror.values()]).toEqual([
      note('AI Tool/Foundry/NPCs/Wolf.md', wolf, { inside: true, owned: true }),
      note('AI Tool/Foundry/PCs/Hero.md', hero, { inside: true, owned: false }),
      note('Elsewhere/Deep/Bear.md', bear, { inside: false, owned: true }),
    ]);
    expect([...scan.mirror.keys()]).toEqual(['Actor.wolf', 'Actor.hero', 'Actor.bear']);
    expect(scan.pages.size).toBe(0);
    expect(scan.duplicates).toEqual([]);
    expect(paths(scan.movedByGm)).toEqual(['Elsewhere/Deep/Bear.md']);
    expect(scan.errors).toEqual([]);
    expect(scan.limitsHit).toEqual([]);
    expect(scan.fileCount).toBe(3);
  });

  it('accepts every mirror note type and ignores the rest', async () => {
    const types = ['pc', 'npc', 'scene', 'journal', 'story-item'];
    for (const type of types) {
      await put(`AI Tool/Foundry/${type}.md`, mirrorText({ type, uuid: `Doc.${type}` }));
    }
    await put('AI Tool/Foundry/session.md', mirrorText({ type: 'session', uuid: 'Doc.session' }));
    await put('AI Tool/Foundry/empty.md', mirrorText({ type: 'npc', uuid: '' }));
    const scan = await scanCampaign(vault, WORLD);
    expect([...scan.mirror.keys()].sort()).toEqual(types.map(t => `Doc.${t}`).sort());
  });

  it('ignores notes without the marker, with another marker, or with no uuid', async () => {
    await put(
      'AI Tool/Foundry/NPCs/NoMarker.md',
      ['---', 'type: npc', 'fvtt_uuid: Actor.a', '---', 'Mine', ''].join('\n')
    );
    await put(
      'AI Tool/Foundry/NPCs/Other.md',
      [
        '---',
        'type: npc',
        'fvtt_uuid: Actor.b',
        'generated_by: someone-else',
        '---',
        'Other tool',
        '',
      ].join('\n')
    );
    await put(
      'AI Tool/Foundry/NPCs/NoUuid.md',
      ['---', 'type: npc', 'generated_by: foundry-ai-tool', '---', 'x', ''].join('\n')
    );
    await put('AI Tool/Foundry/NPCs/Plain.md', '# Just a note\n');
    const scan = await scanCampaign(vault, WORLD);
    expect(scan.mirror.size).toBe(0);
    expect(scan.prep.size).toBe(0);
    expect(scan.stats.size).toBe(0);
    expect(scan.duplicates).toEqual([]);
  });

  it('keeps journal-page notes in `pages`, with their journal uuid', async () => {
    const page: NoteSpec = {
      type: 'journal-page',
      uuid: 'JournalEntry.J1.JournalEntryPage.P1',
      name: 'Arrival',
      journal: 'JournalEntry.J1',
    };
    const journal: NoteSpec = { type: 'journal', uuid: 'JournalEntry.J1', name: 'Barovia' };
    await put('AI Tool/Foundry/Journals/Barovia.md', mirrorText(journal));
    await put('AI Tool/Foundry/Journals/Barovia/Arrival.md', mirrorText(page));
    const scan = await scanCampaign(vault, WORLD);
    expect([...scan.mirror.keys()]).toEqual(['JournalEntry.J1']);
    expect([...scan.pages.entries()]).toEqual([
      [
        'JournalEntry.J1.JournalEntryPage.P1',
        note('AI Tool/Foundry/Journals/Barovia/Arrival.md', page, { inside: true, owned: true }),
      ],
    ]);
    expect(scan.pages.get(page.uuid)?.journalUuid).toBe('JournalEntry.J1');
  });

  it('reads the whole file to tell an unedited note from an edited one, however long', async () => {
    const spec: NoteSpec = { type: 'journal', uuid: 'JournalEntry.Big' };
    const body = `${'Lorem ipsum dolor sit amet. '.repeat(600)}THE END`;
    expect(body.length).toBeGreaterThan(SCAN_HEAD_BYTES * 3);
    const text = mirrorText(spec, body);
    await put('AI Tool/Foundry/Journals/Big.md', text);
    await put('AI Tool/Foundry/Journals/BigEdited.md', text.replace('THE END', 'THE END, edited'));
    const scan = await scanCampaign(vault, WORLD);
    // Same uuid twice: the unedited note wins, the note edited past the 4 KB head loses.
    expect(scan.mirror.get('JournalEntry.Big')?.path).toBe('AI Tool/Foundry/Journals/Big.md');
    expect(scan.mirror.get('JournalEntry.Big')?.owned).toBe(true);
    expect(paths(scan.duplicates)).toEqual(['AI Tool/Foundry/Journals/BigEdited.md']);
    expect(scan.duplicates[0]?.owned).toBe(false);
  });

  it('scans .MD files too, and only files (a folder named like a note is not one)', async () => {
    await put('AI Tool/Foundry/NPCs/Upper.MD', mirrorText({ type: 'npc', uuid: 'Actor.up' }));
    await fsp.mkdir(path.join(root, 'AI Tool', 'Foundry', 'NPCs', 'Folder.md'), {
      recursive: true,
    });
    const scan = await scanCampaign(vault, WORLD);
    expect([...scan.mirror.keys()]).toEqual(['Actor.up']);
    expect(scan.takenPaths.has(pathKey('AI Tool/Foundry/NPCs/Folder.md'))).toBe(false);
  });
});

describe('scanCampaign: which note wins a uuid', () => {
  it('inside and unedited beats inside and edited beats outside; the rest are duplicates', async () => {
    const spec: NoteSpec = { type: 'npc', uuid: 'Actor.x', name: 'X' };
    const good = mirrorText(spec);
    await put('A-outside/X.md', good);
    await put('AI Tool/Foundry/NPCs/A-edited.md', edited(good));
    await put('AI Tool/Foundry/NPCs/Z-owned.md', good);
    const scan = await scanCampaign(vault, WORLD);
    expect(scan.mirror.get('Actor.x')?.path).toBe('AI Tool/Foundry/NPCs/Z-owned.md');
    expect(paths(scan.duplicates)).toEqual(['A-outside/X.md', 'AI Tool/Foundry/NPCs/A-edited.md']);
    expect(scan.movedByGm).toEqual([]); // the outside note lost, so it is not a "moved" note
  });

  it('an edited note inside the fence beats an unedited one outside', async () => {
    const spec: NoteSpec = { type: 'npc', uuid: 'Actor.y' };
    await put('A-outside/Y.md', mirrorText(spec));
    await put('AI Tool/Foundry/NPCs/Y.md', edited(mirrorText(spec)));
    const scan = await scanCampaign(vault, WORLD);
    expect(scan.mirror.get('Actor.y')?.path).toBe('AI Tool/Foundry/NPCs/Y.md');
    expect(paths(scan.duplicates)).toEqual(['A-outside/Y.md']);
  });

  it('ties go to the first path in code-unit order (capitals before lowercase)', async () => {
    const spec: NoteSpec = { type: 'npc', uuid: 'Actor.tie' };
    await put('AI Tool/Foundry/NPCs/a.md', mirrorText(spec));
    await put('AI Tool/Foundry/NPCs/B.md', mirrorText(spec)); // "B" (66) sorts before "a" (97)
    await put('AI Tool/Foundry/PCs/A.md', mirrorText(spec));
    await put('Moved/1.md', mirrorText({ ...spec, uuid: 'Actor.away' }));
    await put('Moved/2.md', mirrorText({ ...spec, uuid: 'Actor.away' }));
    const scan = await scanCampaign(vault, WORLD);
    expect(scan.mirror.get('Actor.tie')?.path).toBe('AI Tool/Foundry/NPCs/B.md');
    expect(scan.mirror.get('Actor.away')?.path).toBe('Moved/1.md');
    expect(paths(scan.duplicates)).toEqual([
      'AI Tool/Foundry/NPCs/a.md',
      'AI Tool/Foundry/PCs/A.md',
      'Moved/2.md',
    ]);
    expect(paths(scan.movedByGm)).toEqual(['Moved/1.md']);
  });

  it('applies the same rules to journal pages, in their own map', async () => {
    const spec: NoteSpec = {
      type: 'journal-page',
      uuid: 'JournalEntry.J.JournalEntryPage.P',
      journal: 'JournalEntry.J',
    };
    await put('Away/Page.md', mirrorText(spec));
    await put('AI Tool/Foundry/Journals/J/Page.md', edited(mirrorText(spec)));
    // The same uuid as a top-level note is a different map: no clash.
    await put(
      'AI Tool/Foundry/Journals/J.md',
      mirrorText({ type: 'journal', uuid: 'JournalEntry.J.JournalEntryPage.P' })
    );
    const scan = await scanCampaign(vault, WORLD);
    expect(scan.pages.get(spec.uuid)?.path).toBe('AI Tool/Foundry/Journals/J/Page.md');
    expect(scan.mirror.get(spec.uuid)?.path).toBe('AI Tool/Foundry/Journals/J.md');
    expect(paths(scan.duplicates)).toEqual(['Away/Page.md']);
  });

  it('a page whose only note lies outside the fence is listed as moved by the GM', async () => {
    const spec: NoteSpec = {
      type: 'journal-page',
      uuid: 'JournalEntry.J.JournalEntryPage.Q',
      journal: 'JournalEntry.J',
    };
    await put('Somewhere/Page Q.md', mirrorText(spec));
    await put('AI Tool/Foundry/NPCs/Wolf.md', mirrorText({ type: 'npc', uuid: 'Actor.w' }));
    const scan = await scanCampaign(vault, WORLD);
    expect(paths(scan.movedByGm)).toEqual(['Somewhere/Page Q.md']);
    expect(scan.pages.get(spec.uuid)?.insideFence).toBe(false);
  });

  it('lists moved notes and duplicates in path order, and the maps too', async () => {
    // uuid order is the reverse of path order on purpose.
    for (const [i, folder] of ['Zoo', 'Yak', 'Xu', 'Wu'].entries()) {
      await put(`${folder}/n.md`, mirrorText({ type: 'npc', uuid: `Actor.${i}` }));
      await put(`${folder}/dup.md`, mirrorText({ type: 'npc', uuid: `Actor.${i}` }));
    }
    const scan = await scanCampaign(vault, WORLD);
    const winners = [...scan.mirror.values()].map(n => n.path);
    expect(winners).toEqual(['Wu/dup.md', 'Xu/dup.md', 'Yak/dup.md', 'Zoo/dup.md']);
    expect(paths(scan.movedByGm)).toEqual(winners);
    expect(paths(scan.duplicates)).toEqual(['Wu/n.md', 'Xu/n.md', 'Yak/n.md', 'Zoo/n.md']);
  });
});

describe('scanCampaign: prep and stats notes', () => {
  it('collects prep notes by uuid, plain or quoted, first path wins, empty uuid skipped', async () => {
    await put(
      'GM/B-Wolf-prep.md',
      ['---', 'type: npc-prep', 'fvtt_uuid: Actor.abc', '---', 'B', ''].join('\n')
    );
    await put(
      'GM/A-Wolf-prep.md',
      ['---', 'type: "npc-prep"', 'fvtt_uuid: "Actor.abc"', '---', 'A', ''].join('\n')
    );
    await put(
      'GM/Plan.md',
      ['---', "type: 'session-plan'", "fvtt_uuid: 'Scene.s1'", '---', 'Plan', ''].join('\n')
    );
    await put(
      'GM/Empty-prep.md',
      ['---', 'type: scene-prep', 'fvtt_uuid: ""', '---', 'x', ''].join('\n')
    );
    await put('GM/NoUuid-prep.md', ['---', 'type: item-prep', '---', 'x', ''].join('\n'));
    await put(
      'GM/Journal-prep.md',
      ['---', 'type: journal-prep', 'fvtt_uuid: JournalEntry.j', '---', 'x', ''].join('\n')
    );
    await put(
      'GM/Other.md',
      ['---', 'type: npc-notes', 'fvtt_uuid: Actor.zzz', '---', 'x', ''].join('\n')
    );
    const scan = await scanCampaign(vault, WORLD);
    expect([...scan.prep.entries()]).toEqual([
      ['Actor.abc', 'GM/A-Wolf-prep.md'],
      ['JournalEntry.j', 'GM/Journal-prep.md'],
      ['Scene.s1', 'GM/Plan.md'],
    ]);
    expect(scan.mirror.size).toBe(0);
  });

  it('collects pc-stats notes without any marker, first path wins', async () => {
    await put(
      'AI Tool/Stats/PCs/Hero.md',
      ['---', 'type: pc-stats', 'fvtt_uuid: Actor.hero', '---', 'Stats', ''].join('\n')
    );
    await put(
      'AI Tool/Stats/PCs/Hero (2).md',
      ['---', 'type: pc-stats', 'fvtt_uuid: Actor.hero', '---', 'Stats', ''].join('\n')
    );
    await put(
      'AI Tool/Stats/PCs/NoUuid.md',
      ['---', 'type: pc-stats', '---', 'Stats', ''].join('\n')
    );
    const scan = await scanCampaign(vault, WORLD);
    expect([...scan.stats.entries()]).toEqual([['Actor.hero', 'AI Tool/Stats/PCs/Hero (2).md']]);
    expect(scan.mirror.size).toBe(0);
    expect(scan.prep.size).toBe(0);
  });

  it('a prep note may also carry the marker without becoming a mirror note', async () => {
    await put(
      'GM/X-prep.md',
      [
        '---',
        'type: npc-prep',
        'fvtt_uuid: Actor.x',
        'generated_by: foundry-ai-tool',
        '---',
        'x',
        '',
      ].join('\n')
    );
    const scan = await scanCampaign(vault, WORLD);
    expect(scan.prep.get('Actor.x')).toBe('GM/X-prep.md');
    expect(scan.mirror.size).toBe(0);
  });
});

describe('scanCampaign: what it skips and never follows', () => {
  it('skips dot folders and .trash, but reads the rest', async () => {
    const spec = (n: string): NoteSpec => ({ type: 'npc', uuid: `Actor.${n}` });
    await put('.trash/Campaigns/x/Old.md', mirrorText(spec('trash')));
    await put('.obsidian/plugins/x.md', mirrorText(spec('obsidian')));
    await put('AI Tool/Foundry/.hidden/Note.md', mirrorText(spec('hidden')));
    await put('AI Tool/Foundry/.dotnote.md', mirrorText(spec('dotnote')));
    await put('AI Tool/Foundry/NPCs/Live.md', mirrorText(spec('live')));
    const scan = await scanCampaign(vault, WORLD);
    expect([...scan.mirror.keys()]).toEqual(['Actor.live']);
    // A dot FILE inside the fence still occupies its name; a dot FOLDER is not entered.
    expect([...scan.takenPaths].sort()).toEqual(
      ['ai tool/foundry/.dotnote.md', 'ai tool/foundry/npcs/live.md'].sort()
    );
    expect(scan.fileCount).toBe(2);
  });

  it('does not follow a junction or symlink to a folder, inside or outside the fence', async ctx => {
    await fsp.writeFile(
      path.join(outside, 'Escaped.md'),
      mirrorText({ type: 'npc', uuid: 'Actor.escaped' }),
      'utf8'
    );
    await put('AI Tool/Foundry/NPCs/Real.md', mirrorText({ type: 'npc', uuid: 'Actor.real' }));
    if (!(await tryDirLink(outside, path.join(root, 'AI Tool', 'Foundry', 'Linked')))) {
      return ctx.skip();
    }
    await tryDirLink(outside, path.join(root, 'Other Linked'));
    const scan = await scanCampaign(vault, WORLD);
    expect([...scan.mirror.keys()]).toEqual(['Actor.real']);
    expect(scan.fileCount).toBe(1);
    expect(scan.errors).toEqual([]);
    // The link inside the fence occupies its name; the one outside does not matter.
    expect(scan.takenPaths.has(pathKey('AI Tool/Foundry/Linked'))).toBe(true);
    expect(scan.takenPaths.has(pathKey('Other Linked'))).toBe(false);
  });

  it('does not follow a campaign folder that is itself a link', async ctx => {
    await fsp.writeFile(
      path.join(outside, 'Escaped.md'),
      mirrorText({ type: 'npc', uuid: 'Actor.escaped' }),
      'utf8'
    );
    if (!(await tryDirLink(outside, root))) return ctx.skip();
    const scan = await scanCampaign(vault, WORLD);
    expect(scan.mirror.size).toBe(0);
    expect(scan.fileCount).toBe(0);
    expect(scan.errors).toEqual([
      { path: '', error: 'The campaign folder is a link; not scanned' },
    ]);
  });

  it('a missing campaign folder, or one that is a file, gives an empty scan', async () => {
    const empty = await scanCampaign(vault, WORLD);
    expect(empty.mirror.size + empty.pages.size + empty.prep.size + empty.stats.size).toBe(0);
    expect(empty.takenPaths.size).toBe(0);
    expect(empty.fileCount).toBe(0);
    expect(empty.errors).toEqual([]);
    expect(empty.limitsHit).toEqual([]);

    await fsp.mkdir(path.dirname(root), { recursive: true });
    await fsp.writeFile(root, 'not a folder', 'utf8');
    const file = await scanCampaign(vault, WORLD);
    expect(file.fileCount).toBe(0);
    expect(file.errors).toEqual([]);
  });

  it('refuses a bad world id', async () => {
    await expect(scanCampaign(vault, '../etc')).rejects.toThrow(/Bad world id/);
    await expect(scanCampaign(vault, '')).rejects.toThrow(/Bad world id/);
  });

  it('records a folder or a note it cannot read and goes on', async () => {
    const spec = (n: string): NoteSpec => ({ type: 'npc', uuid: `Actor.${n}` });
    await put('Locked/Hidden.md', mirrorText(spec('hidden')));
    await put('Fine/Ok.md', mirrorText(spec('ok')));
    await put('Fine/Unreadable.md', mirrorText(spec('unreadable')));
    const realReaddir = fsp.readdir.bind(fsp) as (dir: string) => Promise<string[]>;
    vi.spyOn(fsp, 'readdir').mockImplementation((async (dir: string) => {
      if (String(dir).endsWith('/Locked')) {
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
      }
      return realReaddir(dir);
    }) as never);
    const realOpen = fsp.open.bind(fsp) as (file: string, flags: string) => Promise<unknown>;
    vi.spyOn(fsp, 'open').mockImplementation((async (file: string, flags: string) => {
      if (String(file).endsWith('/Unreadable.md')) {
        throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' });
      }
      return realOpen(file, flags);
    }) as never);

    const scan = await scanCampaign(vault, WORLD);
    expect([...scan.mirror.keys()]).toEqual(['Actor.ok']);
    expect(scan.errors).toEqual([
      { path: 'Locked', error: 'EACCES: permission denied' },
      { path: 'Fine/Unreadable.md', error: 'EBUSY: resource busy' },
    ]);
  });
});

describe('scanCampaign: takenPaths', () => {
  it('holds every file under the fence, whatever it is, and nothing else', async () => {
    await put('AI Tool/Foundry/NPCs/Wolf.md', mirrorText({ type: 'npc', uuid: 'Actor.wolf' }));
    await put('AI Tool/Foundry/NPCs/Wolf.png', 'png');
    await put('AI Tool/Foundry/Scenes/Map.canvas', '{}');
    await put('AI Tool/Foundry/NPCs/Mine.md', '# GM note, no properties\n');
    await put('AI Tool/Foundry/Deep/er/still/Note.txt', 'text');
    await put('AI Tool/Foundry.md', 'A file called Foundry.md next to the fence folder');
    await put('AI Tool/Foundry Extra/Other.md', 'A sibling folder that only starts like the fence');
    await put('AI Tool/Other/Note.md', 'Elsewhere in AI Tool');
    await put('Elsewhere/Wolf.md', 'Outside');
    await fsp.mkdir(path.join(root, 'AI Tool', 'Foundry', 'Empty'), { recursive: true });
    const scan = await scanCampaign(vault, WORLD);
    expect([...scan.takenPaths].sort()).toEqual(
      [
        'ai tool/foundry/npcs/wolf.md',
        'ai tool/foundry/npcs/wolf.png',
        'ai tool/foundry/scenes/map.canvas',
        'ai tool/foundry/npcs/mine.md',
        'ai tool/foundry/deep/er/still/note.txt',
      ].sort()
    );
    expect(scan.fileCount).toBe(9);
  });

  it('compares case-insensitively and after Unicode normalization', async () => {
    const decomposed = `Cafe${String.fromCharCode(0x301)} Owner.md`; // e + combining acute accent
    await put(`AI Tool/Foundry/NPCs/${decomposed}`, '# GM note\n');
    const scan = await scanCampaign(vault, WORLD);
    expect(scan.takenPaths.has(pathKey(`AI Tool/Foundry/NPCs/Caf${EACUTE} Owner.md`))).toBe(true);
    expect(scan.takenPaths.has(pathKey(`ai tool/foundry/npcs/CAF${EACUTE_UPPER} OWNER.MD`))).toBe(
      true
    );
    expect(scan.takenPaths.has(`AI Tool/Foundry/NPCs/Caf${EACUTE} Owner.md`)).toBe(false); // keys, not paths
  });
});

describe('scanCampaign: frontmatter forms', () => {
  const mirrorFields = (lines: string[], eol = '\n'): string =>
    ['---', ...lines, '---', 'Body', ''].join(eol);

  it('reads plain, single-quoted and JSON-quoted scalars', async () => {
    await put(
      'AI Tool/Foundry/a-plain.md',
      mirrorFields([
        'type: npc',
        'name: Plain Wolf  # a comment',
        'fvtt_uuid: Actor.plain',
        'fvtt_sig: abc123',
        'generated_by: foundry-ai-tool',
      ])
    );
    await put(
      'AI Tool/Foundry/b-single.md',
      mirrorFields([
        "type: 'npc'",
        "name: 'It''s a wolf'",
        "fvtt_uuid: 'Actor.single'",
        "generated_by: 'foundry-ai-tool'",
      ])
    );
    await put(
      'AI Tool/Foundry/c-json.md',
      mirrorFields([
        'type: "npc"',
        'name: "Wolf \\"Alpha\\" \\u00e9 \\\\ # not a comment" # a comment',
        'fvtt_uuid: "Actor.json"',
        'generated_by: "foundry-ai-tool"',
      ])
    );
    const scan = await scanCampaign(vault, WORLD);
    expect(scan.mirror.get('Actor.plain')).toMatchObject({
      type: 'npc',
      name: 'Plain Wolf',
      sig: 'abc123',
    });
    expect(scan.mirror.get('Actor.single')?.name).toBe("It's a wolf");
    expect(scan.mirror.get('Actor.json')?.name).toBe(
      `Wolf "Alpha" ${EACUTE} ${BS} # not a comment`
    );
    // Hand-written notes have no valid hash: found, but not "owned".
    expect([...scan.mirror.values()].map(n => n.owned)).toEqual([false, false, false]);
  });

  it('reads CRLF notes and notes with a byte order mark', async () => {
    const BOM = String.fromCharCode(0xfeff);
    const CRLF = String.fromCharCode(13, 10);
    const fieldsFor = (id: string): string[] => [
      'type: "npc"',
      `name: "${id}"`,
      `fvtt_uuid: "Actor.${id}"`,
      'generated_by: "foundry-ai-tool"',
    ];
    await put('AI Tool/Foundry/crlf.md', mirrorFields(fieldsFor('crlf'), CRLF));
    await put('AI Tool/Foundry/bom.md', BOM + mirrorFields(fieldsFor('bom')));
    await put('AI Tool/Foundry/bom-crlf.md', BOM + mirrorFields(fieldsFor('bomcrlf'), CRLF));
    const scan = await scanCampaign(vault, WORLD);
    expect([...scan.mirror.values()].map(n => [n.uuid, n.name, n.path])).toEqual([
      // "-" sorts before ".", so bom-crlf.md comes first.
      ['Actor.bomcrlf', 'bomcrlf', 'AI Tool/Foundry/bom-crlf.md'],
      ['Actor.bom', 'bom', 'AI Tool/Foundry/bom.md'],
      ['Actor.crlf', 'crlf', 'AI Tool/Foundry/crlf.md'],
    ]);
  });

  it('a note whose journal link and signature are absent has them as null', async () => {
    await put(
      'AI Tool/Foundry/x.md',
      mirrorFields(['type: scene', 'fvtt_uuid: Scene.x', 'generated_by: foundry-ai-tool'])
    );
    const scan = await scanCampaign(vault, WORLD);
    expect(scan.mirror.get('Scene.x')).toMatchObject({ sig: null, name: null, journalUuid: null });
  });

  it('ignores a first line that is not exactly the frontmatter fence', async () => {
    const lines = ['type: npc', 'fvtt_uuid: Actor.z', 'generated_by: foundry-ai-tool'];
    await put('AI Tool/Foundry/blank-first.md', `\n${mirrorFields(lines)}`);
    await put('AI Tool/Foundry/spaces-first.md', mirrorFields(lines).replace('---', '--- x'));
    await put('AI Tool/Foundry/no-fence.md', `${lines.join('\n')}\n`);
    const scan = await scanCampaign(vault, WORLD);
    expect(scan.mirror.size).toBe(0);
  });

  it('ignores properties that only appear in the body', async () => {
    await put(
      'AI Tool/Foundry/body.md',
      [
        '---',
        'type: npc',
        '---',
        'fvtt_uuid: Actor.body',
        'generated_by: foundry-ai-tool',
        '',
      ].join('\n')
    );
    const scan = await scanCampaign(vault, WORLD);
    expect(scan.mirror.size).toBe(0);
  });

  it('ignores a block that never closes, small or large', async () => {
    await put(
      'AI Tool/Foundry/small-open.md',
      ['---', 'type: npc', 'fvtt_uuid: Actor.open', 'generated_by: foundry-ai-tool', ''].join('\n')
    );
    const filler = Array.from({ length: 6000 }, (_, i) => `k${i}: value ${i}`);
    expect(filler.join('\n').length).toBeGreaterThan(SCAN_FRONTMATTER_MAX_BYTES);
    await put(
      'AI Tool/Foundry/large-open.md',
      [
        '---',
        'type: npc',
        'fvtt_uuid: Actor.open2',
        'generated_by: foundry-ai-tool',
        ...filler,
        '',
      ].join('\n')
    );
    const scan = await scanCampaign(vault, WORLD);
    expect(scan.mirror.size).toBe(0);
  });
});

describe('scanCampaign: the head of a note', () => {
  it('finds a block that closes after the first 4 KB but within 64 KB', async () => {
    const holders = Array.from(
      { length: 200 },
      (_, i) => `  - "[[Campaigns/${WORLD}/AI Tool/Foundry/PCs/Hero ${i}|Hero ${i}]]"`
    );
    const text = [
      '---',
      'type: "npc"',
      'name: "Big"',
      'fvtt_uuid: "Actor.big"',
      'holders:',
      ...holders,
      'generated_by: "foundry-ai-tool"',
      'generated_hash: ""',
      '---',
      'Body',
      '',
    ].join('\n');
    const closeAt = text.indexOf('\n---\nBody');
    expect(closeAt).toBeGreaterThan(SCAN_HEAD_BYTES);
    expect(closeAt).toBeLessThan(SCAN_FRONTMATTER_MAX_BYTES);
    await put('AI Tool/Foundry/NPCs/Big.md', withGeneratedHash(text));
    const scan = await scanCampaign(vault, WORLD);
    expect(scan.mirror.get('Actor.big')).toMatchObject({ name: 'Big', owned: true });
  });

  it('ignores a block whose marker lies past 64 KB', async () => {
    const filler = Array.from({ length: 2600 }, (_, i) => `note${i}: "${'x'.repeat(30)}"`);
    const text = [
      '---',
      'type: "npc"',
      'fvtt_uuid: "Actor.far"',
      ...filler,
      'generated_by: "foundry-ai-tool"',
      'generated_hash: ""',
      '---',
      'Body',
      '',
    ].join('\n');
    expect(text.indexOf('\n---\nBody')).toBeGreaterThan(SCAN_FRONTMATTER_MAX_BYTES);
    await put('AI Tool/Foundry/NPCs/Far.md', withGeneratedHash(text));
    const scan = await scanCampaign(vault, WORLD);
    expect(scan.mirror.size).toBe(0);
  });

  it('a multi-byte character across the 4 KB boundary does not matter', async () => {
    // One of the two notes has the 4096th byte in the middle of an e-acute.
    for (const shift of [0, 1]) {
      const padding = Array.from({ length: 5 }, (_, i) => `pad${i}: "${EACUTE.repeat(500)}"`);
      const text = withGeneratedHash(
        [
          '---',
          'type: "npc"',
          `fvtt_uuid: "Actor.accents${shift}"`,
          `name: "${'x'.repeat(shift)}"`,
          ...padding,
          'generated_by: "foundry-ai-tool"',
          'generated_hash: ""',
          '---',
          'Body',
          '',
        ].join('\n')
      );
      expect(Buffer.byteLength(text.slice(0, text.indexOf('generated_by')))).toBeGreaterThan(
        SCAN_HEAD_BYTES
      );
      await put(`AI Tool/Foundry/NPCs/Accents${shift}.md`, text);
    }
    const scan = await scanCampaign(vault, WORLD);
    expect([...scan.mirror.keys()]).toEqual(['Actor.accents0', 'Actor.accents1']);
    expect([...scan.mirror.values()].map(n => n.owned)).toEqual([true, true]);
  });
});

describe('scanCampaign: caps', () => {
  it('has the documented default limits', () => {
    expect(SCAN_MAX_DEPTH).toBe(12);
    expect(SCAN_MAX_FILES).toBe(20_000);
    expect(SCAN_HEAD_BYTES).toBe(4096);
    expect(SCAN_FRONTMATTER_MAX_BYTES).toBe(65_536);
  });

  it('stops at the file cap, in path order, and says so', async () => {
    for (const name of ['a', 'b', 'c', 'd', 'e']) {
      await put(`${name}.md`, mirrorText({ type: 'npc', uuid: `Actor.${name}` }));
    }
    const scan = await scanCampaign(vault, WORLD, { maxFiles: 3 });
    expect(scan.fileCount).toBe(3);
    expect(scan.limitsHit).toEqual(['files']);
    expect([...scan.mirror.keys()]).toEqual(['Actor.a', 'Actor.b', 'Actor.c']);
  });

  it('the file cap also stops the walk in later folders', async () => {
    await put('a/1.md', 'x');
    await put('a/2.md', 'x');
    await put('b/3.md', 'x');
    await put('b/4.md', 'x');
    const scan = await scanCampaign(vault, WORLD, { maxFiles: 3 });
    expect(scan.fileCount).toBe(3);
    expect(scan.limitsHit).toEqual(['files']);
  });

  it('exactly as many files as the cap is not a hit', async () => {
    for (const name of ['a', 'b', 'c']) await put(`${name}.md`, 'x');
    const scan = await scanCampaign(vault, WORLD, { maxFiles: 3 });
    expect(scan.fileCount).toBe(3);
    expect(scan.limitsHit).toEqual([]);
  });

  it('stops at the depth cap and says so', async () => {
    const spec = (n: string): NoteSpec => ({ type: 'npc', uuid: `Actor.${n}` });
    await put('zero.md', mirrorText(spec('zero')));
    await put('a/one.md', mirrorText(spec('one')));
    await put('a/b/two.md', mirrorText(spec('two')));
    await put('a/b/c/three.md', mirrorText(spec('three')));
    const scan = await scanCampaign(vault, WORLD, { maxDepth: 2 });
    expect([...scan.mirror.keys()].sort()).toEqual(['Actor.one', 'Actor.two', 'Actor.zero']);
    expect(scan.limitsHit).toEqual(['depth']);
  });

  it('by default reads 12 folders down and refuses the 13th', async () => {
    const spec = (n: string): NoteSpec => ({ type: 'npc', uuid: `Actor.${n}` });
    const twelve = Array.from({ length: 12 }, () => 'd').join('/');
    await put(`${twelve}/twelve.md`, mirrorText(spec('twelve')));
    await put(`${twelve}/d/thirteen.md`, mirrorText(spec('thirteen')));
    const scan = await scanCampaign(vault, WORLD);
    expect([...scan.mirror.keys()]).toEqual(['Actor.twelve']);
    expect(scan.limitsHit).toEqual(['depth']);
  });

  it('reports both limits when both are hit', async () => {
    await put('a/b/c/deep.md', 'x');
    await put('z1.md', 'x');
    await put('z2.md', 'x');
    const scan = await scanCampaign(vault, WORLD, { maxDepth: 1, maxFiles: 1 });
    expect(scan.limitsHit).toEqual(['depth', 'files']);
  });
});

describe('scanCampaign: output', () => {
  it('counts every file it visits, and none in skipped folders', async () => {
    await put('a.md', 'x');
    await put('b.png', 'x');
    await put('sub/c.txt', 'x');
    await put('.trash/d.md', 'x');
    await put('.obsidian/e.json', '{}');
    const scan = await scanCampaign(vault, WORLD);
    expect(scan.fileCount).toBe(3);
  });

  it('is deterministic: the same result for the same notes, however they were created', async () => {
    const entries: Array<[string, string]> = [];
    for (let i = 0; i < 40; i++) {
      const folder = ['Zed', 'AI Tool/Foundry/NPCs', 'Moved/Deep', 'AI Tool/Foundry/PCs'][i % 4];
      const spec: NoteSpec = {
        type: i % 5 === 0 ? 'pc' : 'npc',
        uuid: `Actor.${(i * 7) % 13}`,
        name: `N${i}`,
      };
      // Every third note is edited, so ranks differ within a uuid.
      const text = i % 3 === 0 ? edited(mirrorText(spec)) : mirrorText(spec);
      entries.push([`${folder}/n${String(i % 13).padStart(2, '0')}-${i}.md`, text]);
    }
    for (const [rel, text] of entries) await put(rel, text);
    const first = await scanCampaign(vault, WORLD);
    const second = await scanCampaign(vault, WORLD);

    // The same notes written in the opposite order into another vault.
    const vault2 = path.join(tmp, 'vault2');
    const root2 = campaignDir(vault2, WORLD);
    for (const [rel, text] of [...entries].reverse()) {
      const full = path.join(root2, rel);
      await fsp.mkdir(path.dirname(full), { recursive: true });
      await fsp.writeFile(full, text, 'utf8');
    }
    const third = await scanCampaign(vault2, WORLD);

    expect(first.mirror.size).toBe(13);
    expect(first.duplicates.length).toBe(27);
    for (const other of [second, third]) {
      expect([...other.mirror.entries()]).toEqual([...first.mirror.entries()]);
      expect(other.movedByGm).toEqual(first.movedByGm);
      expect(other.duplicates).toEqual(first.duplicates);
      expect([...other.takenPaths]).toEqual([...first.takenPaths]);
      expect(other.fileCount).toBe(first.fileCount);
    }
    const ordered = [...first.mirror.values()].map(n => n.path);
    expect(ordered).toEqual([...ordered].sort());
  });

  it('keeps every result with its own path when reading many notes at once', async () => {
    const count = 150;
    for (let i = 0; i < count; i++) {
      const name = `n${String(i).padStart(3, '0')}`;
      await put(
        `AI Tool/Foundry/NPCs/${name}.md`,
        mirrorText({ type: 'npc', uuid: `Actor.${name}`, name })
      );
    }
    const scan = await scanCampaign(vault, WORLD);
    expect(scan.mirror.size).toBe(count);
    for (const [uuid, found] of scan.mirror) {
      expect(found.path).toBe(`AI Tool/Foundry/NPCs/${uuid.slice('Actor.'.length)}.md`);
      expect(found.name).toBe(uuid.slice('Actor.'.length));
      expect(found.owned).toBe(true);
    }
  });
});

describe('parseScalar', () => {
  it('reads the scalar forms and returns null for what it does not use', () => {
    expect(parseScalar('plain')).toBe('plain');
    expect(parseScalar('  plain words  # comment')).toBe('plain words');
    expect(parseScalar('a#b')).toBe('a#b');
    expect(parseScalar('"quoted"')).toBe('quoted');
    expect(parseScalar('"a \\"b\\" \\n c" # tail')).toBe('a "b" \n c');
    expect(parseScalar('"a # b"')).toBe('a # b');
    expect(parseScalar("'it''s' # tail")).toBe("it's");
    expect(parseScalar("'a # b'")).toBe('a # b');
    expect(parseScalar('"YAML escape \\_ kept raw"')).toBe('YAML escape \\_ kept raw');
    for (const empty of ['', '   ', '""', "''", '~', 'null', 'Null', '"unterminated', "'open"]) {
      expect(parseScalar(empty)).toBeNull();
    }
    for (const notScalar of [
      '[a, b]',
      '{a: 1}',
      '|',
      '>',
      '&anchor x',
      '*alias',
      '!!str x',
      '# c',
    ]) {
      expect(parseScalar(notScalar)).toBeNull();
    }
    expect(parseScalar('nullable')).toBe('nullable');
  });
});

describe('parseFrontmatter', () => {
  const values = (text: string): unknown => {
    const result = parseFrontmatter(text);
    return result.status === 'ok' ? result.values : result.status;
  };

  it('returns the wanted keys, first occurrence wins, others ignored', () => {
    expect(
      values(
        [
          '---',
          'type: npc',
          'type: pc',
          'title: not wanted',
          'fvtt_uuid: Actor.a',
          'fvtt_sig: s',
          'fvtt_journal: JournalEntry.j',
          'name: A',
          'generated_by: foundry-ai-tool',
          '---',
          'name: from body',
        ].join('\n')
      )
    ).toEqual({
      type: 'npc',
      fvtt_uuid: 'Actor.a',
      fvtt_sig: 's',
      fvtt_journal: 'JournalEntry.j',
      name: 'A',
      generated_by: 'foundry-ai-tool',
    });
  });

  it('only reads top-level keys', () => {
    const result = values(
      [
        '---',
        'features:',
        '  - name: "Nested"',
        '  name: "Also nested"',
        'name: "Top"',
        'holders: [ "a", "b" ]',
        '---',
      ].join('\n')
    );
    expect(result).toMatchObject({ name: 'Top', type: null, fvtt_uuid: null });
  });

  it('reports none when there is no leading fence and open when it is not closed', () => {
    expect(values('# Title\n---\ntype: npc\n---')).toBe('none');
    expect(values('')).toBe('none');
    expect(values('---\ntype: npc\n')).toBe('open');
    expect(values('---')).toBe('open');
  });

  it('accepts ... as the closing line and trailing spaces on the fences', () => {
    expect(values('---  \r\ntype: npc\r\n...  \r\n')).toMatchObject({ type: 'npc' });
  });
});
