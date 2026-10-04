import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { pluginCss, snippetCss } from '../theme/build-css.mjs';
import {
  BODY_CLASSES,
  barHeights,
  bodyClasses,
  isD20Header,
  isTheme,
  noteClasses,
  statCards,
  themeFromPayload,
} from './theme.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fontsDir = path.join(here, '..', '..', 'cogm-dashboard', 'public', 'fonts');
const themeCss = readFileSync(path.join(here, '..', 'theme', 'obsidian-theme.css'), 'utf8');

describe('theme classes', () => {
  it('puts the theme on <body> only while it is on', () => {
    expect(bodyClasses('veil', true)).toEqual(['aitool-themed', 'aitool-theme-veil']);
    expect(bodyClasses('neutral', true)).toEqual(['aitool-themed', 'aitool-theme-neutral']);
    expect(bodyClasses('veil', false)).toEqual([]);
    for (const c of bodyClasses('veil', true)) expect(BODY_CLASSES).toContain(c);
  });

  it('knows only the dashboard themes', () => {
    expect(isTheme('veil')).toBe(true);
    expect(isTheme('neutral')).toBe(true);
    expect(isTheme('off')).toBe(false);
    expect(themeFromPayload({ theme: 'veil', themes: ['neutral', 'veil'] })).toBe('veil');
    expect(themeFromPayload({ theme: 'gothic' })).toBeNull();
    expect(themeFromPayload(null)).toBeNull();
  });

  it('turns the front-matter type into a view class, whatever the folder', () => {
    expect(noteClasses({ type: 'library-monster', generated_by: 'foundry-ai-tool' })).toEqual([
      'aitool-type-library-monster',
      'aitool-generated',
    ]);
    expect(noteClasses({ type: 'npc' })).toEqual(['aitool-type-npc']);
    expect(noteClasses({ type: 'My Prep Note!' })).toEqual(['aitool-type-my-prep-note']);
    expect(noteClasses({ type: 42 })).toEqual([]);
    expect(noteClasses(null)).toEqual([]);
    expect(noteClasses(undefined)).toEqual([]);
  });
});

describe('reading view extras', () => {
  it('finds the d20 spread table and scales its bars to the highest count', () => {
    const head = Array.from({ length: 20 }, (_, i) => String(i + 1));
    expect(isD20Header(head)).toBe(true);
    expect(isD20Header(head.slice(0, 19))).toBe(false);
    expect(isD20Header(['Session', ...head.slice(1)])).toBe(false);
    expect(barHeights([0, 2, 4, 1])).toEqual([0, 0.5, 1, 0.25]);
    expect(barHeights([0, 0, 0])).toEqual([0, 0, 0]);
    expect(barHeights([Number.NaN, 3])).toEqual([0, 1]);
  });

  it("reads the session note's stats line as cards", () => {
    const line =
      '12 roll(s), 1 crit(s), 0 fumble(s). Party: 40 damage dealt, 9 damage taken, ' +
      '5 healing. 1 PC down(s), 3 NPC kill(s).';
    expect(statCards(line)).toEqual([
      { label: 'Rolls', value: '12' },
      { label: 'Crits', value: '1' },
      { label: 'Fumbles', value: '0' },
      { label: 'Damage dealt', value: '40' },
      { label: 'Damage taken', value: '9' },
      { label: 'Healing', value: '5' },
      { label: 'Went down', value: '1' },
      { label: 'Kills', value: '3' },
    ]);
    expect(statCards('Highest roll: 27, Brenna.')).toBeNull();
    expect(statCards('12 roll(s), 1 crit(s).')).toBeNull();
  });
});

describe('theme CSS', () => {
  it('keys the look on types and callouts, never on folder paths', () => {
    expect(themeCss).not.toMatch(/data-path|\.nav-folder|Campaigns\//);
    for (const callout of ['statblock', 'secret', 'info', 'quote']) {
      expect(themeCss).toContain(`[data-callout='${callout}']`);
    }
  });

  it('builds the plugin CSS with both themes and the fonts inlined', () => {
    const css = pluginCss({ base: '.x { color: red; }', theme: themeCss, fontsDir });
    expect(css).toContain('.aitool-theme-veil');
    expect(css).toContain('.aitool-theme-neutral');
    expect(css.match(/@font-face/g)).toHaveLength(5);
    expect(css).toContain('data:font/woff2;base64,');
    expect(css).toContain('Copyright 2022 The Gloock Project Authors');
  });

  it('builds one snippet per theme without the plugin classes', () => {
    const veil = snippetCss({ theme: themeCss, id: 'veil', fontsDir });
    const neutral = snippetCss({ theme: themeCss, id: 'neutral', fontsDir });
    for (const css of [veil, neutral]) {
      expect(css).not.toMatch(/aitool-themed|aitool-theme-/);
      expect(css).toContain(".callout[data-callout='statblock']");
      expect(css.split('{').length).toBe(css.split('}').length);
    }
    expect(veil).toContain('#f2d88a');
    expect(veil).not.toContain('#4ea1ff');
    expect(veil.match(/@font-face/g)).toHaveLength(5);
    expect(neutral).toContain('#4ea1ff');
    expect(neutral).not.toContain('#f2d88a');
    expect(neutral).not.toContain('@font-face');
  });
});
