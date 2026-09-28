import { describe, expect, it } from 'vitest';

import { pathKey } from './mirror-common.js';
import {
  allocateNotePaths,
  MAX_NOTE_PATH_CHARS,
  pageNoteFolder,
  type PathRequest,
} from './mirror-paths.js';

const NPCS = 'AI Tool/Foundry/NPCs';

function req(id: string, name: string, extra: Partial<PathRequest> = {}): PathRequest {
  return { uuid: `Actor.${id}`, id, folder: NPCS, name, created: 1, ...extra };
}

/** Sixteen characters, ending in `tail`. */
function id16(head: string, tail: string): string {
  return `${head}${'0'.repeat(16 - head.length - tail.length)}${tail}`;
}

const NONE = new Map<string, string>();
const EMPTY = new Set<string>();

function lonelySurrogates(text: string): boolean {
  return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);
}

describe('allocateNotePaths', () => {
  it('names a note after its document', () => {
    const out = allocateNotePaths([req('a000000000000001', 'Wolf')], NONE, EMPTY);
    expect(out.get('Actor.a000000000000001')).toBe(`${NPCS}/Wolf.md`);
  });

  it('cleans file names: hostile characters, reserved device names, empty names', () => {
    const out = allocateNotePaths(
      [
        req('a000000000000001', '[[Bad|Name]] #1 ^x'),
        req('a000000000000002', 'CON'),
        req('a000000000000003', '   '),
        req('a000000000000004', 'Line\nBreak <%= tp %>'),
        req('a000000000000005', 'Ends with dots...'),
      ],
      NONE,
      EMPTY
    );
    expect(out.get('Actor.a000000000000001')).toBe(`${NPCS}/Bad Name 1 x.md`);
    expect(out.get('Actor.a000000000000002')).toBe(`${NPCS}/_CON.md`);
    expect(out.get('Actor.a000000000000003')).toBe(`${NPCS}/_untitled.md`);
    expect(out.get('Actor.a000000000000004')).toBe(`${NPCS}/Line Break = tp.md`);
    expect(out.get('Actor.a000000000000005')).toBe(`${NPCS}/Ends with dots.md`);
  });

  it('separates collisions by case, oldest document first, whatever the request order', () => {
    const older = req('b000000000000111', 'Wolf', { created: 10 });
    const newer = req('a000000000000222', 'wolf', { created: 20 });
    const forward = allocateNotePaths([older, newer], NONE, EMPTY);
    const backward = allocateNotePaths([newer, older], NONE, EMPTY);
    expect(forward.get(older.uuid)).toBe(`${NPCS}/Wolf.md`);
    expect(forward.get(newer.uuid)).toBe(`${NPCS}/wolf (000222).md`);
    expect([...backward.entries()].sort()).toEqual([...forward.entries()].sort());
  });

  it('breaks a created-time tie by id and puts a missing created time last', () => {
    const a = req('a000000000000001', 'Same', { created: 5 });
    const b = req('b000000000000002', 'Same', { created: 5 });
    const c = req('0000000000000003', 'Same', { created: null });
    const out = allocateNotePaths([c, b, a], NONE, EMPTY);
    expect(out.get(a.uuid)).toBe(`${NPCS}/Same.md`);
    expect(out.get(b.uuid)).toBe(`${NPCS}/Same (000002).md`);
    expect(out.get(c.uuid)).toBe(`${NPCS}/Same (000003).md`);
  });

  it('tries the last six characters of the id, then the full id', () => {
    const first = req(id16('aaaa', '123456'), 'Twin', { created: 1 });
    const second = req(id16('bbbb', '123456'), 'Twin', { created: 2 });
    const third = req(id16('cccc', '123456'), 'Twin', { created: 3 });
    const out = allocateNotePaths([first, second, third], NONE, EMPTY);
    expect(out.get(first.uuid)).toBe(`${NPCS}/Twin.md`);
    expect(out.get(second.uuid)).toBe(`${NPCS}/Twin (123456).md`);
    expect(out.get(third.uuid)).toBe(`${NPCS}/Twin (${third.id}).md`);
  });

  it('ends with a counter when even the full id is taken', () => {
    const only = req(id16('dddd', '654321'), 'Twin');
    const taken = new Set([
      pathKey(`${NPCS}/Twin.md`),
      pathKey(`${NPCS}/Twin (654321).md`),
      pathKey(`${NPCS}/Twin (${only.id}).md`),
    ]);
    const out = allocateNotePaths([only], NONE, taken);
    expect(out.get(only.uuid)).toBe(`${NPCS}/Twin (${only.id}) 2.md`);
  });

  it('keeps an existing note at its path, and steers new documents around it', () => {
    const known = req('a000000000000001', 'Renamed in Foundry');
    const fresh = req('a000000000000002', 'Old name');
    const existing = new Map([[known.uuid, `${NPCS}/Old name.md`]]);
    const out = allocateNotePaths([fresh, known], existing, EMPTY);
    expect(out.get(known.uuid)).toBe(`${NPCS}/Old name.md`);
    expect(out.get(fresh.uuid)).toBe(`${NPCS}/Old name (000002).md`);
  });

  it('avoids files that are already on disk, by normalized case-insensitive key', () => {
    const one = req('a000000000000001', 'Wolf');
    const taken = new Set([pathKey(`${NPCS}/WOLF.md`)]);
    expect(allocateNotePaths([one], NONE, taken).get(one.uuid)).toBe(`${NPCS}/Wolf (000001).md`);
  });

  it('treats composed and decomposed accents as the same file', () => {
    const composed = req('a000000000000001', 'Café', { created: 1 });
    const decomposed = req('a000000000000002', 'Café', { created: 2 });
    const out = allocateNotePaths([composed, decomposed], NONE, EMPTY);
    expect(out.get(composed.uuid)).toBe(`${NPCS}/Café.md`);
    expect(out.get(decomposed.uuid)).toBe(`${NPCS}/Café (000002).md`);
  });

  it('does not let folders collide with each other', () => {
    const npc = req('a000000000000001', 'Strahd');
    const pc = req('a000000000000002', 'Strahd', { folder: 'AI Tool/Foundry/PCs' });
    const out = allocateNotePaths([npc, pc], NONE, EMPTY);
    expect(out.get(npc.uuid)).toBe(`${NPCS}/Strahd.md`);
    expect(out.get(pc.uuid)).toBe('AI Tool/Foundry/PCs/Strahd.md');
  });

  it('ignores a repeated uuid and is stable across runs', () => {
    const requests = [
      req('a000000000000001', 'Wolf', { created: 1 }),
      req('a000000000000002', 'Wolf', { created: 2 }),
      req('a000000000000001', 'Ignored duplicate', { created: 3 }),
    ];
    const run1 = allocateNotePaths(requests, NONE, EMPTY);
    expect(run1.size).toBe(2);
    expect(run1.get('Actor.a000000000000001')).toBe(`${NPCS}/Wolf.md`);
    // Second run: the pump hands the first run's paths back as existing notes.
    const run2 = allocateNotePaths([...requests].reverse(), run1, new Set());
    expect([...run2.entries()].sort()).toEqual([...run1.entries()].sort());
    // A third document arrives later and steers around both.
    const late = req('a000000000000003', 'Wolf', { created: 0 });
    const run3 = allocateNotePaths([late, ...requests], run1, EMPTY);
    expect(run3.get(late.uuid)).toBe(`${NPCS}/Wolf (000003).md`);
    expect(run3.get('Actor.a000000000000001')).toBe(`${NPCS}/Wolf.md`);
  });

  it('strips characters from the id that a file name should not carry', () => {
    const odd = req('ab/c\\d..e|f', 'Wolf');
    const first = req('a000000000000001', 'Wolf', { created: 0 });
    const out = allocateNotePaths([first, odd], NONE, EMPTY);
    expect(out.get(odd.uuid)).toBe(`${NPCS}/Wolf (abcdef).md`);
  });

  describe('long paths', () => {
    const journalFolder = pageNoteFolder(`AI Tool/Foundry/Journals/${'J'.repeat(120)}.md`);

    it('cuts the stem so the campaign-relative path stays within the limit', () => {
      const page = req('a000000000000001', 'P'.repeat(300), { folder: journalFolder });
      const path = allocateNotePaths([page], NONE, EMPTY).get(page.uuid) ?? '';
      expect(path.length).toBeLessThanOrEqual(MAX_NOTE_PATH_CHARS);
      expect(path.startsWith(`${journalFolder}/PPP`)).toBe(true);
      expect(path.endsWith('.md')).toBe(true);
    });

    it('never cuts the collision suffix', () => {
      const one = req('a000000000000001', 'P'.repeat(300), { folder: journalFolder, created: 1 });
      const two = req('a0000000000abcdef', 'P'.repeat(300), { folder: journalFolder, created: 2 });
      const out = allocateNotePaths([one, two], NONE, EMPTY);
      const path = out.get(two.uuid) ?? '';
      expect(path.length).toBeLessThanOrEqual(MAX_NOTE_PATH_CHARS);
      expect(path.endsWith(' (abcdef).md')).toBe(true);
      expect(out.get(one.uuid)).not.toBe(path);
    });

    it('does not split a surrogate pair when it cuts', () => {
      const name = '\u{1F600}'.repeat(60);
      const results: string[] = [];
      // Vary the folder length by one character so the cut lands on both halves of a pair.
      for (let extra = 0; extra < 4; extra++) {
        const page = req('a000000000000001', name, {
          folder: `${journalFolder}${'x'.repeat(extra)}`,
        });
        const path = allocateNotePaths([page], NONE, EMPTY).get(page.uuid) ?? '';
        expect(path.length).toBeLessThanOrEqual(MAX_NOTE_PATH_CHARS);
        expect(lonelySurrogates(path)).toBe(false);
        results.push(path);
      }
      expect(results.every(path => path.endsWith('.md'))).toBe(true);
    });

    it('leaves a short path alone and gives a device name a leading underscore after a cut', () => {
      const short = req('a000000000000001', 'Short', { folder: journalFolder });
      expect(allocateNotePaths([short], NONE, EMPTY).get(short.uuid)).toBe(
        `${journalFolder}/Short.md`
      );
      // A folder so long that only 3 characters of the stem fit: the cut `Con` would be a
      // Windows device name, and its `_Con` fix would not fit, so the stem is cut once more.
      const folder = 'F'.repeat(MAX_NOTE_PATH_CHARS - 1 - 3 - 3);
      const device = req('a000000000000001', 'Console log', { folder });
      const path = allocateNotePaths([device], NONE, EMPTY).get(device.uuid) ?? '';
      expect(path.length).toBeLessThanOrEqual(MAX_NOTE_PATH_CHARS);
      expect(path).toBe(`${folder}/Co.md`);
    });
  });
});

describe('pageNoteFolder', () => {
  it('is the index note path without .md', () => {
    expect(pageNoteFolder('AI Tool/Foundry/Journals/Barovia.md')).toBe(
      'AI Tool/Foundry/Journals/Barovia'
    );
  });

  it('leaves a path without the extension unchanged', () => {
    expect(pageNoteFolder('AI Tool/Foundry/Journals/Barovia')).toBe(
      'AI Tool/Foundry/Journals/Barovia'
    );
  });
});
