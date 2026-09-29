import { describe, expect, it } from 'vitest';

import { stripSecretBlocks } from './strip-secrets.js';

const strip = (html: string): string => stripSecretBlocks(html).html;

describe('stripSecretBlocks', () => {
  it('removes a section.secret with everything inside it and keeps the rest', () => {
    expect(
      stripSecretBlocks(
        '<p>Before.</p><section class="secret" id="secret-a1"><p>Hidden.</p></section><p>After.</p>'
      )
    ).toEqual({ html: '<p>Before.</p><p>After.</p>', removed: 1 });
  });

  it('removes revealed secret blocks too (still secret blocks in the source)', () => {
    expect(
      strip('<section class="secret revealed" id="s"><p>Shown once.</p></section><p>x</p>')
    ).toBe('<p>x</p>');
  });

  it('removes nested and wrapped secrets, any tag, any secret-like class, any case', () => {
    const html =
      '<div><section class="secret"><h2>A</h2></section><p>keep</p></div>' +
      '<secret-block><section class="secret"><p>B</p></section></secret-block>' +
      '<p class="gm-only">C</p><span class="Secret">D</span><p class="note secret">E</p>' +
      '<div class="gmnote">F</div><div class="gm-note">G</div><div class="gmonly">H</div>';
    const out = stripSecretBlocks(html);
    expect(out.html).toBe('<div><p>keep</p></div>');
    expect(out.removed).toBe(8);
  });

  it('cuts a secret at its own end tag, not at an inner one', () => {
    expect(
      strip(
        '<section class="secret"><section><p>inner</p></section><p>still secret</p></section><p>out</p>'
      )
    ).toBe('<p>out</p>');
  });

  it('counts a secret inside a secret once', () => {
    expect(
      stripSecretBlocks('<section class="secret"><div class="secret">x</div></section>').removed
    ).toBe(1);
  });

  it('drops an unclosed secret block with everything after it', () => {
    expect(strip('<p>ok</p><section class="secret"><p>never closed')).toBe('<p>ok</p>');
  });

  it('drops HTML comments', () => {
    expect(strip('<p>a<!-- GM: the wine is poisoned --></p>')).toBe('<p>a</p>');
  });

  it('keeps classes that only contain the word', () => {
    expect(strip('<p class="secretary">Ms. Smith</p>')).toBe('<p class="secretary">Ms. Smith</p>');
  });

  it('keeps formatting, links, images, enrichers and entities as they were', () => {
    const html =
      '<h2>Title</h2><p><strong>Bold</strong> &amp; <em>it</em> &lt;tag&gt;&nbsp;Café</p>' +
      '<p>@UUID[JournalEntry.abc.JournalEntryPage.def]{the map} [[/r 1d20]]</p>' +
      '<p><a href="https://example.com/x?a=1&amp;b=2">link</a><img src="maps/a.webp" alt="A"><br></p>' +
      '<table><tbody><tr><td>1</td></tr></tbody></table>';
    expect(strip(html)).toBe(html);
  });

  it('handles empty input', () => {
    expect(stripSecretBlocks('')).toEqual({ html: '', removed: 0 });
  });
});
