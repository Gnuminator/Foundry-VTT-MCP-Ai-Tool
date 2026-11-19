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
  var key = 'quest:' + location.pathname + ':' + boxes.length;
  var saved = [];
  try { saved = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) {}
  var bar = document.createElement('p');
  bar.className = 'quest-progress';
  bar.setAttribute('aria-live', 'polite');
  host.insertBefore(bar, host.firstChild);
  function show() {
    var n = boxes.filter(function (b) { return b.checked; }).length;
    var da = document.documentElement.lang === 'da';
    bar.textContent = da
      ? n + ' af ' + boxes.length + ' færdige' + (n === boxes.length ? '. Quest fuldført.' : '')
      : n + ' of ' + boxes.length + ' done' + (n === boxes.length ? '. Quest complete.' : '');
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

// Home page loops (docs/wiki/index.md): a <video data-src> shows its poster, loads and plays when
// it scrolls into view and pauses when it leaves. With reduced motion, or without
// IntersectionObserver, nothing loads until the visitor presses play (the controls stay on).
const loopScript = `
document.addEventListener('DOMContentLoaded', function () {
  var clips = Array.prototype.slice.call(document.querySelectorAll('video[data-src]'));
  if (!clips.length) return;
  function load(v) {
    if (!v.getAttribute('src')) v.setAttribute('src', v.getAttribute('data-src'));
  }
  var still = !('IntersectionObserver' in window) ||
    (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (still) {
    clips.forEach(function (v) { v.addEventListener('play', function () { load(v); }, { once: true }); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      var v = e.target;
      if (e.isIntersecting) {
        load(v);
        v.removeAttribute('controls');
        var p = v.play();
        if (p && p.catch) p.catch(function () { v.setAttribute('controls', ''); });
      } else {
        v.pause();
      }
    });
  }, { threshold: 0.4 });
  clips.forEach(function (v) { io.observe(v); });
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
      // English at the root; the Danish GM and player guides under /da/ (docs/da/README.md).
      // A page with no Danish version (the GM side's Foundry basics) shows its English page under
      // /da/; the Foundry basics for players have Danish twins (docs/da/foundry/).
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        da: { label: 'Dansk', lang: 'da' },
      },
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
      head: [
        { tag: 'script', content: questScript },
        { tag: 'script', content: loopScript },
      ],
      sidebar,
      // Keeps the sidebar of the visitor's side only (player or GM).
      routeMiddleware: './src/routeData.mjs',
      // Every link and anchor must resolve, as `mkdocs --strict` did. The coach zip is in public/,
      // so it is checked too. Storybook is copied into the site after this build: a relative link
      // to it would need the exclude below (the home page uses an absolute URL, which is skipped).
      plugins: [
        starlightLinksValidator({
          // /da/foundry/ (the GM side's Foundry basics) holds Starlight's fallback pages (the
          // English page under /da/); the validator does not know them, but the build writes them.
          // The player side's /da/player/foundry/ pages are real Danish twins.
          exclude: [
            '/Foundry-VTT-MCP-Ai-Tool/storybook/**',
            '/Foundry-VTT-MCP-Ai-Tool/da/foundry/**',
          ],
        }),
      ],
    }),
  ],
});
