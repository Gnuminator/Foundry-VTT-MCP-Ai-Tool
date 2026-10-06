import { describe, expect, it } from 'vitest';

import { htmlToMarkdown, neutralizeMarkdownText } from './html-md.js';

describe('htmlToMarkdown: the sanitizer allowlist', () => {
  it('paragraphs are separated by a blank line', () => {
    expect(htmlToMarkdown('<p>One</p><p>Two</p>')).toBe('One\n\nTwo');
  });

  it('headings h1 to h6', () => {
    const html = [1, 2, 3, 4, 5, 6].map(n => `<h${n}>H${n}</h${n}>`).join('');
    expect(htmlToMarkdown(html)).toBe(
      ['# H1', '## H2', '### H3', '#### H4', '##### H5', '###### H6'].join('\n\n')
    );
  });

  it('br is a hard line break', () => {
    expect(htmlToMarkdown('<p>a<br>b</p>')).toBe('a  \nb');
  });

  it('strong, b, em, i, s and del', () => {
    expect(htmlToMarkdown('<p><strong>a</strong> <b>b</b> <em>c</em> <i>d</i></p>')).toBe(
      '**a** **b** *c* *d*'
    );
    expect(htmlToMarkdown('<p><s>x</s> <del>y</del></p>')).toBe('~~x~~ ~~y~~');
  });

  it('emphasis keeps edge whitespace outside the marks', () => {
    expect(htmlToMarkdown('<p>a<strong> b </strong>c</p>')).toBe('a **b** c');
  });

  it('u, sup and sub keep only their text', () => {
    expect(htmlToMarkdown('<p><u>under</u> x<sup>2</sup> H<sub>2</sub>O</p>')).toBe('under x2 H2O');
  });

  it('unordered and ordered lists, nested', () => {
    expect(htmlToMarkdown('<ul><li>a</li><li>b<ul><li>c</li></ul></li></ul>')).toBe(
      '- a\n- b\n  - c'
    );
    expect(htmlToMarkdown('<ol><li>one</li><li>two<ol><li>deep</li></ol></li></ol>')).toBe(
      '1. one\n2. two\n   1. deep'
    );
  });

  it('blockquote prefixes every line, also across paragraphs', () => {
    expect(htmlToMarkdown('<blockquote><p>a</p><p>b</p></blockquote>')).toBe('> a\n>\n> b');
  });

  it('hr', () => {
    expect(htmlToMarkdown('<p>a</p><hr><p>b</p>')).toBe('a\n\n---\n\nb');
  });

  it('a regular table becomes a pipe table', () => {
    const html =
      '<table><thead><tr><th>Name</th><th>HP</th></tr></thead>' +
      '<tbody><tr><td>Ireena</td><td>9</td></tr><tr><td>Ismark</td><td>12</td></tr></tbody></table>';
    expect(htmlToMarkdown(html)).toBe(
      ['| Name | HP |', '| --- | --- |', '| Ireena | 9 |', '| Ismark | 12 |'].join('\n')
    );
  });

  it('a table without thead uses the first row as header, tfoot rows are kept', () => {
    const html =
      '<table><tr><td>a</td><td>b</td></tr><tfoot><tr><td>c</td><td>d</td></tr></tfoot></table>';
    expect(htmlToMarkdown(html)).toBe(['| a | b |', '| --- | --- |', '| c | d |'].join('\n'));
  });

  it('an irregular table falls back to bullet rows', () => {
    const html = '<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>';
    expect(htmlToMarkdown(html)).toBe('- a \\| b\n- c');
  });

  it('a pipe inside a table cell is escaped', () => {
    const md = htmlToMarkdown('<table><tr><td>a|b</td><td><code>x|y</code></td></tr></table>');
    expect(md.split('\n')[0]).toBe('| a\\|b | `x\\|y` |');
  });

  it('pre becomes a fence without a language, code keeps its newlines', () => {
    expect(htmlToMarkdown('<pre><code>line 1\nline 2</code></pre>')).toBe(
      '```\nline 1\nline 2\n```'
    );
  });

  it('a pre that holds backticks gets a longer fence', () => {
    expect(htmlToMarkdown('<pre>a\n```\nb</pre>')).toBe('````\na\n```\nb\n````');
  });

  it('inline code', () => {
    expect(htmlToMarkdown('<p>Use <code>1d20</code> now</p>')).toBe('Use `1d20` now');
  });

  it('inline code that holds a backtick gets a longer delimiter', () => {
    expect(htmlToMarkdown('<p><code>a`b</code></p>')).toBe('``a`b``');
  });
});

describe('htmlToMarkdown: attributes, entities and unknown tags', () => {
  it('drops every attribute and turns links into their text', () => {
    const md = htmlToMarkdown(
      '<p class="x" style="color:red" onclick="evil()">Go <a href="https://example.com/x">here</a></p>'
    );
    expect(md).toBe('Go here');
    expect(md).not.toContain('example.com');
  });

  it('drops images and active tags with their content', () => {
    expect(htmlToMarkdown('<p>a<img src="x.png" alt="pic">b<script>alert(1)</script>c</p>')).toBe(
      'abc'
    );
  });

  it('decodes entities in text', () => {
    expect(
      htmlToMarkdown('<p>Tom &amp; Jerry &quot;quoted&quot; &#39;x&#39; caf&eacute;</p>')
    ).toBe('Tom & Jerry "quoted" \'x\' café');
  });

  it('keeps the text of unknown tags and treats div as a block', () => {
    expect(htmlToMarkdown('<span>a</span><custom-tag>b</custom-tag>')).toBe('ab');
    expect(htmlToMarkdown('<div>one</div><div>two</div>')).toBe('one\n\ntwo');
  });

  it('bare text and an empty input', () => {
    expect(htmlToMarkdown('just text')).toBe('just text');
    expect(htmlToMarkdown('')).toBe('');
    expect(htmlToMarkdown('<p></p><br>')).toBe('');
  });

  it('collapses 3 or more blank lines to 2 and trims', () => {
    expect(htmlToMarkdown('<p>a</p><p> </p><p></p><br><br><p>b</p>')).toBe('a\n\nb');
  });

  it('never throws on malformed or deeply nested HTML', () => {
    const deep = `${'<div>'.repeat(300)}x${'</div>'.repeat(300)}`;
    expect(htmlToMarkdown(deep)).toContain('x');
    expect(() => htmlToMarkdown('<p><b>unclosed <i>tags')).not.toThrow();
  });
});

describe('htmlToMarkdown: neutralization', () => {
  it('escapes wikilinks', () => {
    const md = htmlToMarkdown('<p>See [[Secret Room]] and ![[image.png]] and [[[x]]]</p>');
    expect(md).not.toContain('[[');
    expect(md).not.toContain(']]');
    expect(md).toContain('\\[\\[Secret Room\\]\\]');
  });

  it('writes no raw HTML: < becomes &lt;', () => {
    const md = htmlToMarkdown('<p>1 &lt; 2 and &lt;b&gt;bold&lt;/b&gt;</p>');
    expect(md).not.toContain('<');
    expect(md).toContain('&lt;');
  });

  it('turns Templater tags into &lt;%', () => {
    const md = htmlToMarkdown('<p>&lt;% tp.file.title %&gt;</p><pre>&lt;%* await x %&gt;</pre>');
    expect(md).not.toContain('<%');
    expect(md).toContain('&lt;% tp.file.title');
  });

  it('neutralizes obsidian: links in any case, in text and in code', () => {
    const md = htmlToMarkdown(
      '<p>obsidian://open?vault=x and OBSIDIAN://x</p><pre>obsidian://run</pre><p><code>obsidian:foo</code></p>'
    );
    expect(md.toLowerCase()).not.toContain('obsidian:');
    expect(md).toContain('obsidian&#58;//open');
    expect(md).toContain('OBSIDIAN&#58;//x');
  });

  it('writes Dataview inline queries as plain text, not as code', () => {
    const a = htmlToMarkdown('<p><code>= this.file.name</code></p>');
    const b = htmlToMarkdown('<p><code>$= dv.pages().length</code></p>');
    const c = htmlToMarkdown('<p><code>  = this.x</code></p>');
    for (const md of [a, b, c]) expect(md).not.toContain('`');
    expect(a).toContain('this.file.name');
    expect(b).toContain('dv.pages');
  });

  it('an ordinary inline code that merely contains = is kept as code', () => {
    expect(htmlToMarkdown('<p><code>a = b</code></p>')).toBe('`a = b`');
  });

  it('a pre whose text starts with dataviewjs gets a fence without a language', () => {
    const md = htmlToMarkdown('<pre>dataviewjs\ndv.paragraph("x")</pre>');
    expect(md).toBe('```\ndataviewjs\ndv.paragraph("x")\n```');
    expect(md).not.toMatch(/```\w/);
  });

  it('text that looks like a fenced block cannot open one', () => {
    const md = htmlToMarkdown('<p>```dataview<br>TABLE file.name<br>```</p>');
    expect(md).not.toMatch(/(^|\n)\s*`{3}/);
    expect(md).not.toMatch(/(^|\n)\s*~{3}/);
    const md2 = htmlToMarkdown('<p>~~~dataviewjs</p>');
    expect(md2).not.toMatch(/(^|\n)\s*~{3}/);
  });

  it('text that looks like markdown structure stays text', () => {
    expect(htmlToMarkdown('<p># not a heading</p>')).toBe('\\# not a heading');
    expect(htmlToMarkdown('<p>- not a list</p>')).toBe('\\- not a list');
    expect(htmlToMarkdown('<p>1. not a list</p>')).toBe('1\\. not a list');
    expect(htmlToMarkdown('<p>*stars* and _under_</p>')).toBe('\\*stars\\* and \\_under\\_');
  });

  it('entity-like text is not decoded a second time by Markdown', () => {
    expect(htmlToMarkdown('<p>&amp;lt;</p>')).toBe('&amp;lt;');
  });

  it('a blockquote and a list cannot smuggle a wikilink either', () => {
    const md = htmlToMarkdown(
      '<blockquote>[[a]]</blockquote><ul><li>[[b]]</li></ul><pre>[[c]]</pre>'
    );
    expect(md).not.toContain('[[');
    expect(md).not.toContain(']]');
  });
});

describe('neutralizeMarkdownText', () => {
  it('applies the same escaping to plain text, on one line', () => {
    const out = neutralizeMarkdownText('Hi [[x]] <% tp %> obsidian://a\nsecond `code`');
    expect(out).not.toContain('[[');
    expect(out).not.toContain('<');
    expect(out).not.toContain('\n');
    expect(out.toLowerCase()).not.toContain('obsidian:');
  });

  it('leaves ordinary text readable', () => {
    expect(neutralizeMarkdownText('Ireena Kolyana')).toBe('Ireena Kolyana');
    expect(neutralizeMarkdownText('  padded  ')).toBe('padded');
  });

  it('escapes a leading list marker and a heading mark', () => {
    expect(neutralizeMarkdownText('- item')).toBe('\\- item');
    expect(neutralizeMarkdownText('# Title')).toBe('\\# Title');
  });

  it('copes with empty and odd input', () => {
    expect(neutralizeMarkdownText('')).toBe('');
    expect(neutralizeMarkdownText(undefined as unknown as string)).toBe('');
  });
});
