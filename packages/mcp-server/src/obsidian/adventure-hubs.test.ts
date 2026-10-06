import { describe, expect, it } from 'vitest';

import {
  ADVENTURES_FOLDER,
  collectAdventureHubs,
  HUB_SECTIONS,
  matchBookNote,
  type HubSourceNote,
} from './adventure-hubs.js';

const J = 'AI Tool/Foundry/Journals';
const S = 'AI Tool/Foundry/Scenes';
const N = 'AI Tool/Foundry/NPCs';
const P = 'AI Tool/Foundry/PCs';
const I = 'AI Tool/Foundry/Items';

function note(
  type: string,
  path: string,
  name: string | null = null,
  insideFence = true
): HubSourceNote {
  return { path, type, name, insideFence };
}

/** The smallest valid adventure: one journal and one scene. */
function basic(adventure = 'Adventure X'): HubSourceNote[] {
  return [
    note('journal', `${J}/${adventure}/Intro.md`, 'Intro'),
    note('scene', `${S}/${adventure}/Hall.md`, 'Hall'),
  ];
}

describe('collectAdventureHubs: which folders count', () => {
  it('makes a hub of a folder with a journal and a scene', () => {
    const hubs = collectAdventureHubs(basic());
    expect(hubs).toHaveLength(1);
    expect(hubs[0]?.name).toBe('Adventure X');
    expect(hubs[0]?.path).toBe(`${ADVENTURES_FOLDER}/Adventure X.md`);
    expect(hubs[0]?.members.journal.map(m => m.name)).toEqual(['Intro']);
    expect(hubs[0]?.members.scene.map(m => m.name)).toEqual(['Hall']);
  });

  it('puts the hubs in AI Tool/Foundry/Adventures', () => {
    expect(ADVENTURES_FOLDER).toBe('AI Tool/Foundry/Adventures');
  });

  it('skips a folder with only journals', () => {
    expect(collectAdventureHubs([note('journal', `${J}/Lore/A.md`, 'A')])).toEqual([]);
  });

  it('skips a folder with only scenes', () => {
    expect(collectAdventureHubs([note('scene', `${S}/Maps/A.md`, 'A')])).toEqual([]);
  });

  it('skips a folder with journals and NPCs but no scene', () => {
    const hubs = collectAdventureHubs([
      note('journal', `${J}/Lore/A.md`, 'A'),
      note('npc', `${N}/Lore/Wolf.md`, 'Wolf'),
    ]);
    expect(hubs).toEqual([]);
  });

  it('skips notes outside the fence', () => {
    const hubs = collectAdventureHubs([
      note('journal', `${J}/Adventure X/Intro.md`, 'Intro'),
      note('scene', `${S}/Adventure X/Hall.md`, 'Hall', false),
    ]);
    expect(hubs).toEqual([]);
  });

  it('leaves an outside-the-fence note out of an otherwise valid hub', () => {
    const [hub] = collectAdventureHubs([
      ...basic(),
      note('npc', `${N}/Adventure X/Moved.md`, 'Moved', false),
    ]);
    expect(hub?.members.npc).toEqual([]);
    expect(hub?.folders).not.toContain(`${N}/Adventure X`);
  });

  it('skips notes directly in a kind folder (no adventure)', () => {
    const hubs = collectAdventureHubs([
      note('journal', `${J}/Lore.md`, 'Lore'),
      note('scene', `${S}/Arena.md`, 'Arena'),
    ]);
    expect(hubs).toEqual([]);
  });

  it('skips types a hub does not list, such as journal pages', () => {
    const hubs = collectAdventureHubs([
      note('journal-page', `${J}/Adventure X/Lore/Page.md`, 'Page'),
      note('scene', `${S}/Adventure X/Hall.md`, 'Hall'),
    ]);
    expect(hubs).toEqual([]);
    expect(HUB_SECTIONS.map(s => s.type)).not.toContain('journal-page');
  });

  it('skips a note whose path is not under its kind folder', () => {
    const hubs = collectAdventureHubs([
      note('journal', `${S}/Adventure X/Intro.md`, 'Intro'),
      note('scene', `${S}/Adventure X/Hall.md`, 'Hall'),
    ]);
    expect(hubs).toEqual([]);
  });

  it('returns nothing for no notes', () => {
    expect(collectAdventureHubs([])).toEqual([]);
  });

  it('accepts any iterable, such as a Set or a generator', () => {
    function* gen(): Generator<HubSourceNote> {
      yield* basic();
    }
    expect(collectAdventureHubs(gen())).toHaveLength(1);
    expect(collectAdventureHubs(new Set(basic()))).toHaveLength(1);
  });
});

describe('collectAdventureHubs: grouping', () => {
  it('groups the kind folders of one adventure case-insensitively', () => {
    const hubs = collectAdventureHubs([
      note('journal', `${J}/Curse of Strahd/Intro.md`, 'Intro'),
      note('scene', `${S}/curse of strahd/Hall.md`, 'Hall'),
      note('npc', `${N}/CURSE OF STRAHD/Strahd.md`, 'Strahd'),
    ]);
    expect(hubs).toHaveLength(1);
    // The first spelling seen names the hub.
    expect(hubs[0]?.name).toBe('Curse of Strahd');
    expect(hubs[0]?.members.npc.map(m => m.name)).toEqual(['Strahd']);
  });

  it('matches the kind folder prefix case-insensitively', () => {
    const hubs = collectAdventureHubs([
      note('journal', 'ai tool/foundry/journals/Adventure X/Intro.md', 'Intro'),
      note('scene', `${S}/Adventure X/Hall.md`, 'Hall'),
    ]);
    expect(hubs).toHaveLength(1);
  });

  it('makes one hub per adventure, sorted by name', () => {
    const hubs = collectAdventureHubs([...basic('Zeta'), ...basic('Alpha'), ...basic('Mid')]);
    expect(hubs.map(h => h.name)).toEqual(['Alpha', 'Mid', 'Zeta']);
    expect(hubs.map(h => h.path)).toEqual([
      `${ADVENTURES_FOLDER}/Alpha.md`,
      `${ADVENTURES_FOLDER}/Mid.md`,
      `${ADVENTURES_FOLDER}/Zeta.md`,
    ]);
  });

  it('keeps one adventure apart from another that lacks a scene', () => {
    const hubs = collectAdventureHubs([
      ...basic('Alpha'),
      note('journal', `${J}/Beta/Only.md`, 'Only'),
    ]);
    expect(hubs.map(h => h.name)).toEqual(['Alpha']);
  });

  it('collects npcs, pcs and items into their sections', () => {
    const [hub] = collectAdventureHubs([
      ...basic(),
      note('npc', `${N}/Adventure X/Wolf.md`, 'Wolf'),
      note('pc', `${P}/Adventure X/Hero.md`, 'Hero'),
      note('story-item', `${I}/Adventure X/Sword.md`, 'Sword'),
    ]);
    expect(hub?.members.npc.map(m => m.name)).toEqual(['Wolf']);
    expect(hub?.members.pc.map(m => m.name)).toEqual(['Hero']);
    expect(hub?.members['story-item'].map(m => m.name)).toEqual(['Sword']);
  });

  it('records the subfolders between the adventure folder and the note', () => {
    const [hub] = collectAdventureHubs([
      note('journal', `${J}/Adventure X/Chapter 4/Maps/Deep.md`, 'Deep'),
      note('journal', `${J}/Adventure X/Top.md`, 'Top'),
      note('scene', `${S}/Adventure X/Hall.md`, 'Hall'),
    ]);
    const byName = Object.fromEntries((hub?.members.journal ?? []).map(m => [m.name, m]));
    expect(byName['Deep']?.subfolder).toBe('Chapter 4/Maps');
    expect(byName['Top']?.subfolder).toBe('');
    expect(byName['Top']?.path).toBe(`${J}/Adventure X/Top.md`);
  });
});

describe('collectAdventureHubs: names, order and folders', () => {
  it('falls back to the file name without .md when the name is null', () => {
    const [hub] = collectAdventureHubs([
      note('journal', `${J}/Adventure X/Chapter One.md`, null),
      note('scene', `${S}/Adventure X/Hall.MD`, null),
    ]);
    expect(hub?.members.journal[0]?.name).toBe('Chapter One');
    expect(hub?.members.scene[0]?.name).toBe('Hall');
  });

  it('prefers the name over the file name', () => {
    const [hub] = collectAdventureHubs([
      note('journal', `${J}/Adventure X/file-name.md`, 'Display Name'),
      note('scene', `${S}/Adventure X/Hall.md`, 'Hall'),
    ]);
    expect(hub?.members.journal[0]?.name).toBe('Display Name');
  });

  it('sorts members by name with numbers in numeric order', () => {
    const [hub] = collectAdventureHubs([
      note('journal', `${J}/Adventure X/c10.md`, 'Chapter 10'),
      note('journal', `${J}/Adventure X/c2.md`, 'Chapter 2'),
      note('journal', `${J}/Adventure X/c1.md`, 'Chapter 1'),
      note('scene', `${S}/Adventure X/Hall.md`, 'Hall'),
    ]);
    expect(hub?.members.journal.map(m => m.name)).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 10']);
  });

  it('sorts by subfolder first, then by name', () => {
    const [hub] = collectAdventureHubs([
      note('journal', `${J}/Adventure X/B/Alpha.md`, 'Alpha'),
      note('journal', `${J}/Adventure X/A/Zulu.md`, 'Zulu'),
      note('journal', `${J}/Adventure X/Root.md`, 'Root'),
      note('journal', `${J}/Adventure X/A/Beta.md`, 'Beta'),
      note('scene', `${S}/Adventure X/Hall.md`, 'Hall'),
    ]);
    expect(hub?.members.journal.map(m => `${m.subfolder}|${m.name}`)).toEqual([
      '|Root',
      'A|Beta',
      'A|Zulu',
      'B|Alpha',
    ]);
  });

  it('sorts subfolders numerically too', () => {
    const [hub] = collectAdventureHubs([
      note('journal', `${J}/Adventure X/Chapter 10/A.md`, 'A'),
      note('journal', `${J}/Adventure X/Chapter 2/A.md`, 'A'),
      note('scene', `${S}/Adventure X/Hall.md`, 'Hall'),
    ]);
    expect(hub?.members.journal.map(m => m.subfolder)).toEqual(['Chapter 2', 'Chapter 10']);
  });

  it('breaks a tie on equal subfolder and name by path', () => {
    const [hub] = collectAdventureHubs([
      note('journal', `${J}/Adventure X/b.md`, 'Same'),
      note('journal', `${J}/Adventure X/a.md`, 'Same'),
      note('scene', `${S}/Adventure X/Hall.md`, 'Hall'),
    ]);
    expect(hub?.members.journal.map(m => m.path)).toEqual([
      `${J}/Adventure X/a.md`,
      `${J}/Adventure X/b.md`,
    ]);
  });

  it('lists the journal folder first, then scenes, NPCs, PCs and items', () => {
    // Fed in the reverse order of the sections.
    const [hub] = collectAdventureHubs([
      note('story-item', `${I}/Adventure X/Sword.md`, 'Sword'),
      note('pc', `${P}/Adventure X/Hero.md`, 'Hero'),
      note('npc', `${N}/Adventure X/Wolf.md`, 'Wolf'),
      note('scene', `${S}/Adventure X/Hall.md`, 'Hall'),
      note('journal', `${J}/Adventure X/Intro.md`, 'Intro'),
    ]);
    expect(hub?.folders).toEqual([
      `${J}/Adventure X`,
      `${S}/Adventure X`,
      `${N}/Adventure X`,
      `${P}/Adventure X`,
      `${I}/Adventure X`,
    ]);
  });

  it('lists a folder once however many notes it holds, and only kinds that have notes', () => {
    const [hub] = collectAdventureHubs([
      ...basic(),
      note('journal', `${J}/Adventure X/Two.md`, 'Two'),
      note('journal', `${J}/Adventure X/Sub/Three.md`, 'Three'),
    ]);
    expect(hub?.folders).toEqual([`${J}/Adventure X`, `${S}/Adventure X`]);
  });
});

describe('matchBookNote', () => {
  const BOOKS = new Map([
    ['Curse of Strahd', 'AI Tool/Library/Books/Curse of Strahd.md'],
    ["Player's Handbook (2024)", "AI Tool/Library/Books/Player's Handbook (2024).md"],
  ]);

  it('finds a book with the same title', () => {
    expect(matchBookNote('Curse of Strahd', BOOKS)).toEqual({
      title: 'Curse of Strahd',
      path: 'AI Tool/Library/Books/Curse of Strahd.md',
    });
  });

  it('ignores case', () => {
    expect(matchBookNote('CURSE OF STRAHD', BOOKS)?.title).toBe('Curse of Strahd');
    expect(matchBookNote('curse of strahd', BOOKS)?.title).toBe('Curse of Strahd');
  });

  it('ignores punctuation and spacing', () => {
    expect(matchBookNote('Curse-of  Strahd!', BOOKS)?.title).toBe('Curse of Strahd');
    expect(matchBookNote("Player's  handbook, 2024", BOOKS)?.title).toBe(
      "Player's Handbook (2024)"
    );
  });

  it('ignores accents', () => {
    const books = new Map([['Café Adventure', 'AI Tool/Library/Books/Cafe.md']]);
    expect(matchBookNote('Cafe Adventure', books)?.path).toBe('AI Tool/Library/Books/Cafe.md');
  });

  it('misses when no title matches', () => {
    expect(matchBookNote('Rime of the Frostmaiden', BOOKS)).toBeNull();
  });

  it('does not match a partial title', () => {
    expect(matchBookNote('Curse', BOOKS)).toBeNull();
    expect(matchBookNote('Curse of Strahd Expanded', BOOKS)).toBeNull();
  });

  it('misses on an empty or punctuation-only name, even against an empty title', () => {
    const books = new Map([['!!!', 'AI Tool/Library/Books/x.md']]);
    expect(matchBookNote('', books)).toBeNull();
    expect(matchBookNote('???', books)).toBeNull();
  });

  it('misses with no books', () => {
    expect(matchBookNote('Curse of Strahd', new Map())).toBeNull();
  });
});
