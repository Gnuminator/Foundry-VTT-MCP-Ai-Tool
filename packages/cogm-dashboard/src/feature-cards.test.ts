/**
 * The dashboard's in-app help (I-064) stays in step with the GM guide pages: each feature card
 * (public/feature-cards.json) is a section of docs/gm/features.md, and every panel's "?"
 * (public/help-links.json) opens a heading that exists.
 */
import { readFileSync } from 'fs';

import { describe, expect, it } from 'vitest';

interface FeatureCard {
  id: string;
  title: string;
  what: string;
  when: string;
  state: Record<string, unknown>;
  guide: string;
}

const cards = JSON.parse(
  readFileSync(new URL('../public/feature-cards.json', import.meta.url), 'utf8')
) as FeatureCard[];
const guide = readFileSync(new URL('../../../docs/gm/features.md', import.meta.url), 'utf8');

/** `## ` headings with their GitHub-style anchors. */
const sections = [...guide.matchAll(/^## (.+)$/gm)].map(m => {
  const title = (m[1] ?? '').trim();
  const anchor = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');
  return { title, anchor };
});

describe('feature cards', () => {
  it('has unique ids and the fields every card shows', () => {
    expect(new Set(cards.map(c => c.id)).size).toBe(cards.length);
    for (const c of cards) {
      expect(c.title && c.what && c.when && c.guide).toBeTruthy();
      expect(Object.keys(c.state)).toHaveLength(1);
      expect(c.what + c.when).not.toContain(String.fromCharCode(0x2014)); // no em dashes
    }
  });

  it('every card is a section of docs/gm/features.md, linked by its anchor', () => {
    for (const c of cards) {
      expect(sections).toContainEqual({ title: c.title, anchor: c.guide });
    }
  });
});

/** GitHub's heading anchor, as scripts/check-links.mjs computes it. */
function slugify(heading: string): string {
  const text = heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[`*~]/g, '')
    .trim()
    .toLowerCase();
  return text.replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/ /g, '-');
}

function anchorsOf(page: string): Set<string> {
  const text = readFileSync(new URL(`../../../docs/gm/${page}.md`, import.meta.url), 'utf8');
  return new Set([...text.matchAll(/^#{1,6}\s+(.*?)\s*$/gm)].map(m => slugify(m[1] ?? '')));
}

describe('panel help links', () => {
  const links = JSON.parse(
    readFileSync(new URL('../public/help-links.json', import.meta.url), 'utf8')
  ) as Array<{ panel: string; help: string }>;

  it('every "?" opens a heading in a GM guide page', () => {
    expect(links.length).toBeGreaterThan(10);
    for (const { help } of links) {
      const [page = '', anchor = ''] = help.split('#');
      expect(anchorsOf(page), help).toContain(anchor);
    }
  });
});
