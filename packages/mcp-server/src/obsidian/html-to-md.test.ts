import { describe, expect, it } from 'vitest';

import { htmlToMarkdown, markdownPageText } from './html-to-md.js';
import { resolveRelativeUuid, rewriteText } from './links.js';
import { codeSpan, escapeLinkLabel, escapeMarkdownText, safeUrl } from './md-escape.js';
import type { LinkContext, LinkTarget } from './mirror-common.js';

const J = 'JournalEntry.jrnl000000000001';
const PAGE = `${J}.JournalEntryPage.page000000000001`;
const PAGE2 = `${J}.JournalEntryPage.page000000000002`;
const WOLF = 'Actor.wolf000000000001';
const MACRO = 'Macro.macr000000000001';
const GONE = 'Scene.gone000000000001';
const FROM = 'AI Tool/Foundry/Journals/Lore/Village.md';

const targets: Record<string, LinkTarget | null> = {
  [WOLF]: { notePath: 'AI Tool/Foundry/NPCs/Wolf.md', name: 'Wolf' },
  [PAGE2]: {
    notePath: 'AI Tool/Foundry/Journals/Lore.md',
    name: 'Tavern',
    blockId: 'p-page000000000002',
  },
  [J]: { notePath: 'AI Tool/Foundry/Journals/Lore.md', name: 'Lore' },
  [MACRO]: { notePath: null, name: null },
  [GONE]: null,
};

function ctx(): LinkContext {
  return {
    pageUuid: PAGE,
    openBase: 'http://localhost:3100',
    fromPath: FROM,
    resolve: uuid => (uuid in targets ? (targets[uuid] ?? null) : { notePath: null, name: null }),
    findByName: (type, name) => (type === 'Actor' && name === 'Wolf' ? WOLF : null),
  };
}

const md = (html: string): string => htmlToMarkdown(html, ctx());

describe('links: section 5 table', () => {
  it('links a mirrored document to its note with the given label', () => {
    expect(md(`<p>A @UUID[${WOLF}]{grey wolf} howls.</p>`)).toBe(
      'A [grey wolf](../../NPCs/Wolf.md) howls.'
    );
  });

  it('uses the current name when there is no label, and drops #hash', () => {
    expect(md(`<p>@UUID[${WOLF}#section]</p>`)).toBe('[Wolf](../../NPCs/Wolf.md)');
  });

  it('links a page to the index block when its text is not mirrored', () => {
    expect(md(`<p>@UUID[${PAGE2}]{the tavern}</p>`)).toBe(
      '[the tavern](../Lore.md#^p-page000000000002)'
    );
  });

  it('resolves relative uuids like Foundry', () => {
    expect(resolveRelativeUuid('.page000000000002', PAGE)).toBe(PAGE2);
    expect(resolveRelativeUuid('..jrnl000000000009', PAGE)).toBe('JournalEntry.jrnl000000000009');
    expect(resolveRelativeUuid('...x', PAGE)).toBeNull();
    expect(md('<p>@UUID[.page000000000002]{next}</p>')).toBe(
      '[next](../Lore.md#^p-page000000000002)'
    );
  });

  it('sends embedded documents to the parent note, keeping the label', () => {
    expect(md(`<p>@UUID[${WOLF}.Item.bite000000000001]{Bite}</p>`)).toBe(
      '[Bite](../../NPCs/Wolf.md)'
    );
  });

  it('opens compendium documents in Foundry; without a type only the label shows', () => {
    expect(md('<p>@UUID[Compendium.dnd5e.monsters.Actor.abcdefABCDEF0123]{a wolf}</p>')).toBe(
      '[a wolf](http://localhost:3100/open?uuid=Compendium.dnd5e.monsters.Actor.abcdefABCDEF0123)'
    );
    expect(md('<p>@UUID[Compendium.dnd5e.monsters.abcdefABCDEF0123]{old}</p>')).toBe('old');
    expect(md('<p>@Compendium[dnd5e.monsters.abcdefABCDEF0123]{older}</p>')).toBe('older');
    expect(md('<p>@Compendium[dnd5e.monsters.Goblin]</p>')).toBe('Goblin');
  });

  it('links compendium documents to their Library notes, legacy links too', () => {
    const SEP = 'Compendium.world.monsters.Actor.quill00000000001';
    const library = {
      byUuid: (uuid: string): { notePath: string; name: string } | null =>
        uuid === SEP
          ? { notePath: 'AI Tool/Library/Monsters/Quillfang.md', name: 'Quillfang' }
          : null,
      legacy: (pack: string, idOrName: string): string | null =>
        pack === 'world.monsters' && (idOrName === 'quill00000000001' || idOrName === 'Quillfang')
          ? SEP
          : null,
    };
    const lib = (html: string): string => htmlToMarkdown(html, { ...ctx(), library });
    const target = '../../../Library/Monsters/Quillfang.md';
    expect(lib(`<p>@UUID[${SEP}]{the killer}</p>`)).toBe(`[the killer](${target})`);
    expect(lib('<p>@Compendium[world.monsters.quill00000000001]{Quillfang}</p>')).toBe(
      `[Quillfang](${target})`
    );
    expect(lib('<p>@Compendium[world.monsters.Quillfang]</p>')).toBe(`[Quillfang](${target})`);
    // In the index of another pack the Library does not hold: open it in Foundry.
    expect(lib('<p>@UUID[Compendium.world.items.Item.ring000000000001]{a ring}</p>')).toBe(
      '[a ring](http://localhost:3100/open?uuid=Compendium.world.items.Item.ring000000000001)'
    );
  });

  it('shows unmirrored documents as an Open in Foundry link and missing ones as their label', () => {
    expect(md(`<p>@UUID[${MACRO}]{Macro}</p>`)).toBe(
      `[Macro](http://localhost:3100/open?uuid=${MACRO})`
    );
    expect(md(`<p>@UUID[${GONE}]{Castle}</p>`)).toBe('Castle');
    expect(htmlToMarkdown(`<p>@UUID[${MACRO}]{Macro}</p>`, { ...ctx(), openBase: '' })).toBe(
      'Macro'
    );
  });

  it('resolves legacy links by id and by exact name', () => {
    expect(md('<p>@Actor[wolf000000000001]{W}</p>')).toBe('[W](../../NPCs/Wolf.md)');
    expect(md('<p>@Actor[Wolf]</p>')).toBe('[Wolf](../../NPCs/Wolf.md)');
    expect(md('<p>@Actor[Nobody]{N}</p>')).toBe('N');
    expect(md('<p>@RollTable[Fish Colors]{Open RollTable}</p>')).toBe('Fish Colors');
  });

  it('never embeds: @Embed becomes "Embedded:" plus a link', () => {
    expect(md(`<p>@Embed[${WOLF} inline]{the wolf}</p>`)).toBe(
      'Embedded: [the wolf](../../NPCs/Wolf.md)'
    );
  });

  it('turns inline rolls and dnd5e enrichers into the words Foundry shows', () => {
    expect(md('<p>Roll [[/r 1d20+2]] and [[/check dex dc=15]] or &Reference[prone].</p>')).toBe(
      'Roll 1d20 + 2 and DC 15 Dexterity or prone.'
    );
    expect(
      md(
        '<p>A [[/save con 22 format=long]], taking [[/damage 20d10 + 70 radiant average=true]] damage.</p>'
      )
    ).toBe('A DC 22 Constitution saving throw, taking 180 (20d10 + 70) radiant damage.');
    expect(
      md(
        '<p>[[/check wis 14 format=long]] [[/check skill=prc dc=12 format=long]] [[/roll 2d6]] [[1d4]]</p>'
      )
    ).toBe('DC 14 Wisdom check DC 12 Wisdom (Perception) check 2d6 1d4');
    expect(
      md(
        '<p>&amp;Reference[prc]{Perception} &amp;Reference[evo] [[/damage 5 type=heal average=false]] hit points</p>'
      )
    ).toBe('Perception evocation 5 hit points');
    expect(md('<p>@Check[dex|dc:15] and @Save[str|dc:12]{a Strength save}</p>')).toBe(
      'DC 15 Dexterity and a Strength save'
    );
    expect(md('<p>[[lookup @name lowercase]] attacks</p>')).toBe('the creature attacks');
    expect(
      htmlToMarkdown('<p>[[lookup @name]] attacks</p>', { ...ctx(), selfName: 'Quillfang' })
    ).toBe('Quillfang attacks');
  });

  it('links only http(s) hrefs and bare URLs', () => {
    expect(md('<p><a href="https://example.com/a(b)">site</a></p>')).toBe(
      '[site](https://example.com/a%28b%29)'
    );
    for (const href of [
      'javascript:alert(1)',
      'obsidian://open?vault=x',
      'file:///c:/x',
      'data:text/html,x',
      '../x.md',
    ]) {
      expect(md(`<p><a href="${href}">click</a></p>`)).toBe('click');
    }
    expect(md('<p>See https://example.com/x.</p>')).toBe(
      'See [https://example.com/x](https://example.com/x).'
    );
  });
});

describe('html structure', () => {
  it('rebuilds blocks from the allowlist', () => {
    const html =
      '<h1>Title</h1><p>One <strong>bold</strong> and <em>it</em><br>two</p>' +
      '<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul><ol><li>x</li><li>y</li></ol>' +
      '<blockquote><p>quoted</p></blockquote><hr><pre>code ``` here</pre>';
    expect(md(html)).toBe(
      [
        '## Title',
        '',
        'One **bold** and *it*',
        'two',
        '',
        '- a',
        '  - b',
        '- c',
        '',
        '1. x',
        '2. y',
        '',
        '> quoted',
        '',
        '---',
        '',
        '````text',
        'code ``` here',
        '````',
      ].join('\n')
    );
  });

  it('turns section.secret into a collapsed callout', () => {
    expect(md('<p>Open.</p><section class="secret"><p>Strahd waits.</p></section>')).toBe(
      'Open.\n\n> [!secret]- GM secret\n> Strahd waits.'
    );
  });

  it('renders every table as a Markdown table, spans expanded', () => {
    expect(md('<table><tr><th>A</th><th>B|C</th></tr><tr><td>1</td><td>2</td></tr></table>')).toBe(
      '| A | B\\|C |\n| --- | --- |\n| 1 | 2 |'
    );
    expect(
      md(
        '<div class="table-overflow-wrapper"><table><caption>Loot</caption><thead><tr><th colspan="2">Roll</th></tr></thead>' +
          '<tbody><tr><td rowspan="2">1</td><td><p>a</p><ul><li>b</li></ul></td></tr><tr><td>c</td></tr></tbody></table></div>'
      )
    ).toBe('**Loot**\n\n| Roll |  |\n| --- | --- |\n| 1 | a - b |\n|  | c |');
  });

  it('renders a D&D Beyond stat block as one callout with an ability table', () => {
    const scores = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']
      .map(
        (k, i) =>
          `<div class="stat-block-ability-scores-stat"><div class="stat-block-ability-scores-heading">${k}</div>` +
          `<div class="stat-block-ability-scores-data"><span class="stat-block-ability-scores-score">${10 + i}</span> ` +
          `<span class="stat-block-ability-scores-modifier">(+${Math.floor(i / 2)})</span></div></div>`
      )
      .join('');
    const html =
      '<div class="Basic-Text-Frame stat-block-finder stat-block-background-1">' +
      '<p class="Stat-Block-Styles_Stat-Block-Title">@UUID[Actor.wolf000000000001]{Snow Weasel}</p>' +
      '<p class="Stat-Block-Styles_Stat-Block-Metadata">Tiny beast, unaligned</p>' +
      '<p class="Stat-Block-Styles_Stat-Block-Data"><strong>Armor Class </strong>13</p>' +
      '<p class="Stat-Block-Styles_Stat-Block-Data"><strong>Hit Points </strong>4 (1d4 + 2)</p>' +
      `<div class="stat-block-ability-scores">${scores}</div>` +
      '<p class="Stat-Block-Styles_Stat-Block-Data-Last"><strong>Challenge </strong>0 (10 XP)</p>' +
      '<p class="Stat-Block-Styles_Stat-Block-Body"><em><strong>Slippery.</strong></em> It squeezes through gaps.</p>' +
      '<p class="Stat-Block-Styles_Stat-Block-Heading">Actions</p>' +
      '<p class="Stat-Block-Styles_Stat-Block-Body"><em><strong>Nip.</strong></em> [[/roll 1d20 + 4]] to hit.</p>' +
      '</div>';
    expect(md(html)).toBe(
      [
        '> [!statblock] [Snow Weasel](../../NPCs/Wolf.md)',
        '> *Tiny beast, unaligned*',
        '>',
        '> **Armor Class** 13',
        '> **Hit Points** 4 (1d4 + 2)',
        '>',
        '> | STR | DEX | CON | INT | WIS | CHA |',
        '> | :-: | :-: | :-: | :-: | :-: | :-: |',
        '> | 10 (+0) | 11 (+0) | 12 (+1) | 13 (+1) | 14 (+2) | 15 (+2) |',
        '>',
        '> **Challenge** 0 (10 XP)',
        '>',
        '> ***Slippery.*** It squeezes through gaps.',
        '>',
        '> ### Actions',
        '>',
        '> ***Nip.*** 1d20 + 4 to hit.',
      ].join('\n')
    );
  });

  it('turns read-aloud boxes, sidebars and figures into callouts and captions', () => {
    expect(md('<aside class="read-aloud-text"><p>The wind howls.</p></aside>')).toBe(
      '> [!quote] Read aloud\n> The wind howls.'
    );
    expect(md('<aside class="block-torn-paper"><p>Legal text.</p></aside>')).toBe(
      '> [!note]\n> Legal text.'
    );
    const withImages: LinkContext = {
      ...ctx(),
      image: (src: string) =>
        src === 'maps/town.webp' ? '![[Campaigns/w/AI Tool/Attachments/maps/town.webp]]' : null,
    };
    expect(
      htmlToMarkdown(
        '<figure><a class="ddb-lightbox-outer"><img src="maps/town.webp" alt=""></a><figcaption>The town</figcaption></figure>',
        withImages
      )
    ).toBe('![[Campaigns/w/AI Tool/Attachments/maps/town.webp]]\n\n*The town*');
    expect(htmlToMarkdown('<p><img src="other.png" alt="x"></p>', withImages)).toBe(
      '\\[image: x\\]'
    );
  });

  it('drops scripts, styles, frames and event handlers; images become text', () => {
    expect(
      md(
        '<p>a<script>alert(1)</script><style>x{}</style><iframe src="x"></iframe>b</p><img src="x" onerror="alert(1)" alt="map">'
      )
    ).toBe('ab\n\n\\[image: map\\]');
  });

  it('keeps markdown-format pages as escaped text', () => {
    expect(markdownPageText(`# Head\n- item\n@UUID[${WOLF}]{w}`, ctx())).toBe(
      `\\# Head\n\\- item\n[w](../../NPCs/Wolf.md)`
    );
  });
});

describe('escaping', () => {
  it('neutralizes every construct data could open', () => {
    const out = escapeMarkdownText(
      'a [[wiki]] ![[embed]] [x](javascript:y) `code` %%c%% #tag ^block $x$ <b> &lt; <% tp %> [^1] ==hi=='
    );
    for (const bad of ['[[', '![[', '`code`', '%%', ' #tag', ' ^block', '$x$', '<b>', '<%']) {
      expect(out).not.toContain(bad);
    }
    // Brackets are escaped, so `\](` is text, never a link.
    expect(out).not.toMatch(/[^\\]\]\(/);
    expect(out).toContain('&lt;b>');
    expect(out).toContain('&amp;lt;');
  });

  it('escapes block markers at line starts only', () => {
    expect(escapeMarkdownText('> q\n- l\n1. o\n    indented\n=\na - b')).toBe(
      '\\> q\n\\- l\n1\\. o\nindented\n\\=\na - b'
    );
  });

  it('builds safe labels, code spans and URLs', () => {
    expect(escapeLinkLabel(' a \n [b] \\ ')).toBe('a \\[b\\] \\\\');
    expect(escapeLinkLabel('x'.repeat(300))).toHaveLength(200);
    expect(codeSpan('a `b` c')).toBe('``a `b` c``');
    expect(codeSpan('`x`')).toBe('`` `x` ``');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('http://user:pw@host/')).toBeNull();
    expect(safeUrl('https://h/a b"c')).toBe('https://h/a%20b%22c');
  });

  it('rewrites a text run without eating spaces around links', () => {
    expect(rewriteText(`x @UUID[${WOLF}]{w} y`, ctx())).toBe('x [w](../../NPCs/Wolf.md) y');
  });
});

describe('canary: hostile page text stays inert', () => {
  it('never produces a live link, embed, code, tag, comment, HTML or Templater tag from data', () => {
    const canary = 'CANARY-7Q2';
    const html =
      `<p>${canary}[[${canary}]] ![[${canary}]] [${canary}](obsidian://x) <a href="javascript:${canary}">${canary}</a>` +
      ` \`${canary}\` %%${canary}%% #${canary} ${canary} ^${canary}</p>` +
      `<p>&lt;% tp.system.prompt("${canary}") %&gt; &lt;script&gt;${canary}&lt;/script&gt;</p>` +
      `<p>@UUID[javascript:${canary}]{${canary}} <code>dice: ${canary}</code></p>`;
    const all = md(html);
    expect(all).toContain(canary);
    // `[[...]]` is an inline roll to Foundry: shown as its (escaped) words, never as code.
    const out = all;
    expect(out).not.toMatch(/(^|[^\\])\[\[/);
    expect(out).not.toMatch(/\]\((?!https?:|\.\.\/|[A-Za-z%])/);
    // Only an unescaped `]` can close a link label.
    expect(out).not.toMatch(/[^\\]\]\((obsidian|javascript):/);
    expect(out).not.toMatch(/(^|[^\\])`/);
    expect(out).not.toContain('%%');
    expect(out).not.toMatch(/(^|\s)#[A-Za-z]/);
    expect(out).not.toMatch(/(^|[^\\])\^[A-Za-z]/);
    expect(out).not.toContain('<%');
    expect(out).not.toContain('<script');
  });
});
