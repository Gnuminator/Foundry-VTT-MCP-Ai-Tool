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
