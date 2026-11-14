import { describe, expect, it } from 'vitest';

import { RECORD_COMMAND } from './bot.js';
import { bi } from './i18n.js';
import { sessionPostMessage } from './session-post.js';

describe('bot language', () => {
  it('bi puts Danish first and English below', () => {
    expect(bi('hej', 'hi')).toBe('hej\nhi');
  });

  it('the session post is bilingual and ends with the link alone', () => {
    const text = sessionPostMessage('https://example.test/player');
    expect(text).toContain('Sessionen er slut');
    expect(text).toContain('The session is over');
    expect(text.split('\n').pop()).toBe('https://example.test/player');
  });

  it('/record and its subcommands have Danish descriptions', () => {
    const json = RECORD_COMMAND.toJSON();
    expect(json.description_localizations?.da).toBeTruthy();
    for (const sub of json.options ?? []) {
      expect(
        (sub as { description_localizations?: { da?: string } }).description_localizations?.da
      ).toBeTruthy();
    }
  });
});
