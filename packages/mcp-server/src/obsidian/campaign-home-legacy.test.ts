import { createHash } from 'crypto';

import { describe, expect, it } from 'vitest';

import { isUntouchedLegacyHome, LEGACY_CAMPAIGN_HOMES } from './campaign-home-legacy.js';
import { renderCampaignHome } from './render.js';

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

describe('legacy Campaign Home templates', () => {
  it('keeps the 2026-09-29 template byte for byte (frozen: never edit it)', () => {
    const v1 = LEGACY_CAMPAIGN_HOMES[0];
    expect(v1).toBeDefined();
    // The hash of renderCampaignHome('ai-tool-test') at main 7677792, before the Adventures section.
    expect(sha256(v1('ai-tool-test'))).toBe(
      '9747a83737bbc539c27840cf642463a91883da5511d6760d27b651864d92977e'
    );
  });

  it('knows an untouched old Home, also with CRLF line endings', () => {
    const old = LEGACY_CAMPAIGN_HOMES[0]('curse-of-strahd');
    expect(isUntouchedLegacyHome('curse-of-strahd', old)).toBe(true);
    expect(isUntouchedLegacyHome('curse-of-strahd', old.replace(/\n/g, '\r\n'))).toBe(true);
  });

  it('treats an edited Home, another world, or the current template as not legacy', () => {
    const old = LEGACY_CAMPAIGN_HOMES[0]('curse-of-strahd');
    expect(isUntouchedLegacyHome('curse-of-strahd', `${old}\nMy note.\n`)).toBe(false);
    expect(isUntouchedLegacyHome('other-world', old)).toBe(false);
    expect(isUntouchedLegacyHome('curse-of-strahd', renderCampaignHome('curse-of-strahd'))).toBe(
      false
    );
  });

  it('gives the current Home an Adventures base on the hubs folder', () => {
    const home = renderCampaignHome('curse-of-strahd');
    expect(home).toContain('## Adventures');
    expect(home).toContain(
      '    - file.inFolder("Campaigns/curse-of-strahd/AI Tool/Foundry/Adventures")'
    );
    expect(home.indexOf('## Adventures')).toBeLessThan(home.indexOf('## Sessions'));
  });
});
