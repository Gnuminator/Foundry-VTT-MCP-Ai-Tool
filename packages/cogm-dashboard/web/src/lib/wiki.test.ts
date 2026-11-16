import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { helpLang, wikiUrl } from '../lib/wiki';

const GM = 'https://gnuminator.github.io/Foundry-VTT-MCP-Ai-Tool/gm/';

describe('wikiUrl', () => {
  it('sends the guide index to the GM section', () => {
    expect(wikiUrl('README', '')).toBe(GM);
  });

  it('gives a page its own directory, as the wiki builds it', () => {
    expect(wikiUrl('dashboard', '')).toBe(`${GM}dashboard/`);
  });

  it('sends a Foundry basics page to the foundry section', () => {
    const FOUNDRY = 'https://gnuminator.github.io/Foundry-VTT-MCP-Ai-Tool/foundry/';
    expect(wikiUrl('foundry-combat', 'x')).toBe(`${FOUNDRY}combat/#x`);
    expect(wikiUrl('foundry-README', '')).toBe(FOUNDRY);
  });

  it('keeps the heading anchor, which the wiki slugs the same way', () => {
    expect(wikiUrl('dashboard', 'module-diagnostics')).toBe(`${GM}dashboard/#module-diagnostics`);
  });

  it('sends Danish to the da section, to the page and not a heading', () => {
    const DA = 'https://gnuminator.github.io/Foundry-VTT-MCP-Ai-Tool/da/gm/';
    expect(wikiUrl('README', '', 'da')).toBe(DA);
    expect(wikiUrl('dashboard', 'module-diagnostics', 'da')).toBe(`${DA}dashboard/`);
  });

  it('keeps a Foundry basics page in English, which has no Danish twin', () => {
    const FOUNDRY = 'https://gnuminator.github.io/Foundry-VTT-MCP-Ai-Tool/foundry/';
    expect(wikiUrl('foundry-combat', 'x', 'da')).toBe(`${FOUNDRY}combat/#x`);
  });
});

describe('helpLang', () => {
  // The web tests run in node: stand in for the two browser globals.
  const store = new Map<string, string>();
  const language = (value: string): void => {
    vi.stubGlobal('navigator', { language: value });
  };
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('follows a Danish browser, English otherwise', () => {
    language('da-DK');
    expect(helpLang()).toBe('da');
    language('en-US');
    expect(helpLang()).toBe('en');
  });

  it('lets the stored choice win over the browser', () => {
    language('en-US');
    localStorage.setItem('cogm.help.lang', 'da');
    expect(helpLang()).toBe('da');
    localStorage.setItem('cogm.help.lang', 'en');
    language('da');
    expect(helpLang()).toBe('en');
  });
});
