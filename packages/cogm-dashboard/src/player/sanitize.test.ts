import { describe, expect, it } from 'vitest';

import { resolveFoundrySyntax, sanitizeHandoutHtml } from './sanitize.js';

const SECRET = 'CANARY-GM-SECRET';
const REVEALED = 'JournalEntry.aaaaaaaaaaaaaaaa.JournalEntryPage.bbbbbbbbbbbbbbbb';
const HIDDEN = 'JournalEntry.cccccccccccccccc.JournalEntryPage.dddddddddddddddd';

describe('sanitizeHandoutHtml', () => {
  it('drops GM secret blocks with everything inside them', () => {
    const html = `<p>The letter reads:</p><section class="secret" id="secret-1"><p>${SECRET}</p></section><div class="gm-only">${SECRET}</div>`;
    const out = sanitizeHandoutHtml(html, []);
    expect(out).toBe('<p>The letter reads:</p>');
  });

  it('keeps simple formatting without any attributes', () => {
    const html =
      '<h2 style="color:red">Title</h2><p class="x" onclick="alert(1)"><strong>Bold</strong> and <em>it</em></p><ul><li>one</li></ul>';
    expect(sanitizeHandoutHtml(html, [])).toBe(
      '<h2>Title</h2><p><strong>Bold</strong> and <em>it</em></p><ul><li>one</li></ul>'
    );
  });

  it('drops scripts, styles, frames, images and forms with their contents', () => {
    const html = `<p>a</p><script>${SECRET}</script><style>${SECRET}</style><iframe src="x">${SECRET}</iframe><img src="worlds/${SECRET}.webp" alt="${SECRET}"><form><input value="${SECRET}"></form><svg><text>${SECRET}</text></svg>`;
    expect(sanitizeHandoutHtml(html, [])).toBe('<p>a</p>');
  });

  it('unwraps links and unknown tags to their text, never keeping an href', () => {
    const html = '<p><a href="javascript:alert(1)">click</a> <span data-x="1">here</span></p>';
    expect(sanitizeHandoutHtml(html, [])).toBe('<p>click here</p>');
  });

  it('escapes text, so markup inside text cannot come alive', () => {
    const html = '<p>&lt;img src=x onerror=alert(1)&gt; &amp; "q"</p>';
    expect(sanitizeHandoutHtml(html, [])).toBe(
      '<p>&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot;</p>'
    );
  });

  it('keeps a content link label only when the link targets a revealed page', () => {
    const html = `<p>See @UUID[${REVEALED}]{the letter} and @UUID[${HIDDEN}]{${SECRET}} and @UUID[Actor.eeeeeeeeeeeeeeee]{${SECRET}}.</p>`;
    expect(sanitizeHandoutHtml(html, [REVEALED])).toBe('<p>See the letter and  and .</p>');
  });

  it('drops inline rolls, embeds and lookups; other enrichers keep only their label', () => {
    expect(resolveFoundrySyntax('Roll [[/r 1d20+5]]{attack} now [[2d6]].', new Set())).toBe(
      'Roll  now .'
    );
    expect(resolveFoundrySyntax(`@Embed[${HIDDEN}] @Lookup[@name]`, new Set())).toBe(' ');
    expect(resolveFoundrySyntax('Make a @Check[dex|dc:15]{Dexterity check}.', new Set())).toBe(
      'Make a Dexterity check.'
    );
  });

  it('drops comments and survives malformed markup', () => {
    const html = `<p>ok<!-- ${SECRET} --><b>unclosed <i>nested</p><section class="secret">${SECRET}`;
    const out = sanitizeHandoutHtml(html, []);
    expect(out).not.toContain(SECRET);
    expect(out).not.toMatch(/<(?!\/?(p|b|i)>)/);
  });
});
