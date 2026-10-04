/**
 * Builds the theme CSS (I-099) for esbuild.config.mjs: the plugin's styles.css (Neutral and The
 * Veil, switched by the plugin's <body> classes) and one snippet per theme for vaults without
 * the plugin (the player vault). Fonts are the dashboard's OFL fonts, embedded as data URLs
 * because Obsidian loads a plugin's styles.css without its folder; their licences ship as
 * FONT-LICENSES.txt beside it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** The dashboard's fonts (packages/cogm-dashboard/public/fonts), as The Veil uses them. */
export const FONTS = [
  { family: 'Gloock', file: 'gloock-400.woff2', weight: '400', style: 'normal' },
  { family: 'Spectral', file: 'spectral-300-italic.woff2', weight: '300', style: 'italic' },
  { family: 'Spectral', file: 'spectral-400.woff2', weight: '400', style: 'normal' },
  { family: 'Spectral', file: 'spectral-500.woff2', weight: '500 700', style: 'normal' },
  { family: 'Red Hat Mono', file: 'red-hat-mono-500.woff2', weight: '400 700', style: 'normal' },
];

export const LICENSE_FILES = ['OFL-Gloock.txt', 'OFL-Spectral.txt', 'OFL-RedHatMono.txt'];

export const THEMES = ['neutral', 'veil'];

/** @font-face rules with the fonts inlined. */
export function fontFaceCss(fontsDir) {
  return FONTS.map(font => {
    const data = readFileSync(path.join(fontsDir, font.file)).toString('base64');
    return (
      `@font-face { font-family: '${font.family}'; ` +
      `src: url(data:font/woff2;base64,${data}) format('woff2'); ` +
      `font-weight: ${font.weight}; font-style: ${font.style}; font-display: swap; }`
    );
  }).join('\n');
}

/** The licence texts, one after another, for FONT-LICENSES.txt. */
export function licenseText(fontsDir) {
  const intro =
    'The Foundry AI Tool Obsidian theme embeds these fonts in styles.css and in the theme ' +
    'snippets. Each is licensed under the SIL Open Font License, Version 1.1:\n';
  const parts = LICENSE_FILES.map(file => readFileSync(path.join(fontsDir, file), 'utf8').trim());
  return `${intro}\n${parts.join('\n\n----------------------------------------\n\n')}\n`;
}

/** One line per font: the copyright notice from its licence file. */
export function copyrightLines(fontsDir) {
  return LICENSE_FILES.map(file => readFileSync(path.join(fontsDir, file), 'utf8').split('\n')[0]);
}

function header(title, fontsDir) {
  if (!fontsDir) return `/* ${title} */`;
  return [
    `/* ${title}`,
    '   Fonts (SIL Open Font License 1.1, full texts in FONT-LICENSES.txt):',
    ...copyrightLines(fontsDir).map(line => `   ${line}`),
    '*/',
  ].join('\n');
}

/** The plugin's styles.css: its own small styles, the fonts and the theme. */
export function pluginCss({ base, theme, fontsDir }) {
  return [
    header('Foundry AI Tool plugin for Obsidian.', fontsDir),
    base.trim(),
    fontFaceCss(fontsDir),
    theme.trim(),
    '',
  ].join('\n\n');
}

/**
 * A snippet for one theme: the plugin classes are taken out, so it applies to the whole vault as
 * soon as it is switched on in Appearance, and the other theme's rules are dropped.
 */
export function snippetCss({ theme, id, fontsDir }) {
  if (!THEMES.includes(id)) throw new Error(`Unknown theme ${id}`);
  const other = THEMES.filter(t => t !== id);
  // The source's opening comment describes the plugin's classes; the snippet has its own header.
  let css = theme.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, '');
  for (const t of other) {
    // Every rule is flat (no nesting), so a rule is "selector { declarations }".
    css = css.replace(
      new RegExp(`[^{}]*\\.aitool-theme-${t}\\b[^{}]*\\{[^{}]*\\}\\s*`, 'g'),
      '\n\n'
    );
  }
  css = css
    .replaceAll(`.aitool-theme-${id}`, '')
    .replaceAll('body.aitool-themed', 'body')
    .replace(/\n{3,}/g, '\n\n');
  const title =
    `Foundry AI Tool Obsidian theme, ${id === 'veil' ? 'The Veil' : 'Neutral'}, as a snippet ` +
    '(for a vault without the plugin: copy it into .obsidian/snippets and switch it on in ' +
    'Settings, Appearance, CSS snippets).';
  const withFonts = id === 'veil';
  const parts = [header(title, withFonts ? fontsDir : null)];
  if (withFonts) parts.push(fontFaceCss(fontsDir));
  parts.push(css.trim());
  return `${parts.join('\n\n')}\n`;
}
