import { escapeHtml } from './html.js';

describe('escapeHtml', () => {
  it('escapes the five HTML characters, ampersand first', () => {
    expect(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;'
    );
  });
});
