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

  it('opens compendium documents in Foundry; a typeless compendium uuid is code', () => {
    expect(md('<p>@UUID[Compendium.dnd5e.monsters.Actor.abcdefABCDEF0123]{a wolf}</p>')).toBe(
      '[a wolf](http://localhost:3100/open?uuid=Compendium.dnd5e.monsters.Actor.abcdefABCDEF0123)'
    );
    expect(md('<p>@UUID[Compendium.dnd5e.monsters.abcdefABCDEF0123]{old}</p>')).toBe(
      'old `Compendium.dnd5e.monsters.abcdefABCDEF0123`'
    );
    expect(md('<p>@Compendium[dnd5e.monsters.abcdefABCDEF0123]{older}</p>')).toBe(
      'older `@Compendium[dnd5e.monsters.abcdefABCDEF0123]`'
    );
  });

  it('shows unmirrored and missing documents as label plus code', () => {
    expect(md(`<p>@UUID[${MACRO}]{Macro}</p>`)).toBe(`Macro \`${MACRO}\``);
    expect(md(`<p>@UUID[${GONE}]{Castle}</p>`)).toBe(`Castle \`${GONE} (not found)\``);
  });

  it('resolves legacy links by id and by exact name', () => {
    expect(md('<p>@Actor[wolf000000000001]{W}</p>')).toBe('[W](../../NPCs/Wolf.md)');
    expect(md('<p>@Actor[Wolf]</p>')).toBe('[Wolf](../../NPCs/Wolf.md)');
    expect(md('<p>@Actor[Nobody]{N}</p>')).toBe('N `@Actor[Nobody]`');
  });

  it('never embeds: @Embed becomes "Embedded:" plus a link', () => {
    expect(md(`<p>@Embed[${WOLF} inline]{the wolf}</p>`)).toBe(
      'Embedded: [the wolf](../../NPCs/Wolf.md)'
    );
  });

  it('keeps inline rolls and dnd5e enrichers as code', () => {
    expect(md('<p>Roll [[/r 1d20+2]] and [[/check dex dc=15]] or &Reference[prone].</p>')).toBe(
      'Roll `[[/r 1d20+2]]` and `[[/check dex dc=15]]` or `&Reference[prone]`.'
    );
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

  it('renders simple tables and flattens complex ones', () => {
    expect(md('<table><tr><th>A</th><th>B|C</th></tr><tr><td>1</td><td>2</td></tr></table>')).toBe(
      '| A | B\\|C |\n| --- | --- |\n| 1 | 2 |'
    );
    expect(md('<table><tr><td colspan="2">wide</td></tr></table>')).toBe('wide');
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
    // `[[...]]` is an inline roll to Foundry: shown as inline code (design section 5).
    expect(all).toContain(`\`[[${canary}]]\``);
    const out = all.replace(/`\[\[[^`]*\]\]`/g, '');
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
