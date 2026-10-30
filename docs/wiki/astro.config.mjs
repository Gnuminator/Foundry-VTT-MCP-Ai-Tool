// The wiki (Astro Starlight). scripts/wiki/stage.mjs fills src/content/docs, public/ and
// src/sidebar.generated.json from docs/gm, docs/player and docs/foundry before this builds.
import { readFileSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';

const BASE = '/Foundry-VTT-MCP-Ai-Tool';
const sidebar = JSON.parse(
  readFileSync(new URL('./src/sidebar.generated.json', import.meta.url), 'utf8')
);

// Quest pages (docs/gm/*-quest.md): markdown task lists render as disabled boxes. On a page whose
// path ends in -quest/, enable them, keep the ticks in localStorage per page (viewer-local, so
// the dashboard help panel keeps static boxes) and show "N of M done" at the top.
const questScript = `
document.addEventListener('DOMContentLoaded', function () {
  if (!/-quest\\/$/.test(location.pathname)) return;
  var boxes = Array.prototype.slice.call(document.querySelectorAll('.sl-markdown-content input[type=checkbox]'));
  var host = document.querySelector('.sl-markdown-content');
  if (!boxes.length || !host) return;
  var key = 'quest:' + location.pathname;
  var saved = [];
  try { saved = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) {}
  var bar = document.createElement('p');
  bar.className = 'quest-progress';
  bar.setAttribute('aria-live', 'polite');
  host.insertBefore(bar, host.firstChild);
  function show() {
    var n = boxes.filter(function (b) { return b.checked; }).length;
    bar.textContent = n + ' of ' + boxes.length + ' done' + (n === boxes.length ? '. Quest complete.' : '');
  }
  boxes.forEach(function (b, i) {
    b.disabled = false;
    b.checked = saved.indexOf(i) !== -1;
    b.addEventListener('change', function () {
      var on = [];
      boxes.forEach(function (x, j) { if (x.checked) on.push(j); });
      try { localStorage.setItem(key, JSON.stringify(on)); } catch (e) {}
      show();
    });
  });
  show();
});
`;

export default defineConfig({
  site: 'https://gnuminator.github.io',
  base: BASE,
  outDir: '../../build/wiki/site',
  trailingSlash: 'always',
  integrations: [
    starlight({
      title: 'Foundry AI Tool',
      description:
        'Guides for the GM and the players of a Foundry VTT game run with Foundry AI Tool.',
      logo: { src: './src/assets/logo.svg', alt: '' },
      favicon: '/favicon.png',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool',
        },
      ],
      customCss: [
        '@fontsource/spectral/500.css',
        '@fontsource/spectral/700.css',
        '@fontsource/source-sans-3/400.css',
        '@fontsource/source-sans-3/600.css',
        './src/styles/field-guide.css',
      ],
      head: [{ tag: 'script', content: questScript }],
      sidebar,
      // Every link and anchor must resolve, as `mkdocs --strict` did. The coach zip is in public/,
      // so it is checked too. Storybook is copied into the site after this build: a relative link
      // to it would need the exclude below (the home page uses an absolute URL, which is skipped).
      plugins: [
        starlightLinksValidator({
          exclude: ['/Foundry-VTT-MCP-Ai-Tool/storybook/**'],
        }),
      ],
    }),
  ],
});
