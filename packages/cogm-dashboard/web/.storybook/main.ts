// Storybook for the React dashboard (UI-03). Dev dependencies of this package only: the app build
// (web/vite.config.ts) never imports a story, so nothing here reaches dist/, the Docker image or
// the bundle budget. Run it with `npm run storybook`, build it with `npm run build-storybook`
// (see the dashboard README, "Stories").
//
// Storybook runs its own Vite from the package folder, where there is no vite.config.* (the
// dashboard's lives in web/), so the app's `base: '/next/'` does not apply: the build uses
// relative URLs and can be published under any path (the wiki serves it at /storybook/).
import type { StorybookConfig } from '@storybook/react-vite';

import { PREACT_ALIASES } from '../preact-alias';

const config: StorybookConfig = {
  // Stories sit next to the component they show; the overview page and later whole-screen
  // prototypes (design round 3) live under src/storybook/.
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y', '@storybook/addon-themes'],
  framework: { name: '@storybook/react-vite', options: {} },
  core: { disableTelemetry: true },
  typescript: {
    // The stories already hold the props they use; skipping the docgen pass keeps the build quick.
    reactDocgen: false,
  },
  // Preact spike: the stories render with preact/compat, as the app build does (../preact-alias.ts).
  viteFinal: config => {
    const own = config.resolve?.alias ?? [];
    const list = Array.isArray(own)
      ? own
      : Object.entries(own).map(([find, replacement]) => ({ find, replacement }));
    return { ...config, resolve: { ...config.resolve, alias: [...PREACT_ALIASES, ...list] } };
  },
};

export default config;
