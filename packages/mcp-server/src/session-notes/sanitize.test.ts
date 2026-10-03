import { describe, expect, it } from 'vitest';

import { sanitizeNotesHtml } from './sanitize.js';

describe('sanitizeNotesHtml', () => {
  it('keeps the allowlisted tags without attributes', () => {
    expect(
      sanitizeNotesHtml(
        '<h2 id="a">Recap</h2><p style="x">One <em>two</em> <strong class="b">three</strong><br/>four</p><ul><li>a</li></ul><ol><li>b</li></ol><h3>c</h3>'
      )
    ).toBe(
      '<h2>Recap</h2><p>One <em>two</em> <strong>three</strong><br>four</p><ul><li>a</li></ul><ol><li>b</li></ol><h3>c</h3>'
    );
  });

  it('drops scripts, styles and their content, and unwraps other tags', () => {
    expect(
      sanitizeNotesHtml(
        '<p>a<script>alert(1)</script><style>p{}</style><a href="javascript:x">link</a><img src=x onerror=y><iframe><p>in</p></iframe>b</p>'
      )
    ).toBe('<p>alinkb</p>');
  });

  it('re-escapes text so decoded entities cannot become markup', () => {
    expect(sanitizeNotesHtml('<p>&lt;script&gt;x&lt;/script&gt; &amp; Ireena</p>')).toBe(
      '<p>&lt;script&gt;x&lt;/script&gt; &amp; Ireena</p>'
    );
  });

  it('closes what was left open and ignores stray closing tags', () => {
    expect(sanitizeNotesHtml('<ul><li><em>a</li></ul></p><p>b')).toBe(
      '<ul><li><em>a</em></li></ul><p>b</p>'
    );
  });

  it('keeps Danish letters and quotes as text', () => {
    expect(sanitizeNotesHtml('<p>Æblet "går" i tågen</p>')).toBe('<p>Æblet "går" i tågen</p>');
  });
});
