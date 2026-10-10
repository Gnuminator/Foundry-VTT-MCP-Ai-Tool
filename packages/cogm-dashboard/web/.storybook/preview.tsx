// The preview iframe: the same stylesheets as the real page, in the same order (index.html links
// them: the old page's styles.css and moments.css, then the themes), so a story looks as the
// panel does in the dashboard. Vite resolves them from public/, fonts included.
import { withThemeByDataAttribute } from '@storybook/addon-themes';
import type { Decorator, Preview } from '@storybook/react-vite';

import '../../public/styles.css';
import '../../public/moments.css';
import '../../public/themes/brand.css';
import '../../public/themes/veil.css';
import '../src/next.css';
import './preview.css';

import { withDashboard } from '../src/storybook/withDashboard';

const MISTS = ['calm', 'drift', 'clear'] as const;

/** The Veil's mist (<html data-mist>), which theme.ts sets from the viewer's choice in the app. */
const withMist: Decorator = (Story, context) => {
  const mist = String(context.globals['mist'] ?? 'calm');
  document.documentElement.dataset['mist'] = (MISTS as readonly string[]).includes(mist)
    ? mist
    : 'calm';
  return <Story />;
};

const preview: Preview = {
  decorators: [
    // data-theme="neutral" | "veil" on <html>, as theme.ts sets it: the toolbar's Theme.
    withThemeByDataAttribute({
      themes: { neutral: 'neutral', veil: 'veil' },
      defaultTheme: 'neutral',
      attributeName: 'data-theme',
    }),
    withMist,
    withDashboard,
  ],
  initialGlobals: { mist: 'calm' },
  globalTypes: {
    mist: {
      description: 'The mist of The Veil (only the Veil theme shows it)',
      toolbar: {
        title: 'Mist',
        icon: 'cloud',
        dynamicTitle: true,
        items: MISTS.map(value => ({ value, title: `Mist: ${value}` })),
      },
    },
  },
  parameters: {
    // The themes paint the page; the backgrounds addon would paint over them.
    backgrounds: { disabled: true },
    controls: { expanded: true },
    layout: 'padded',
    viewport: {
      options: {
        phone: { name: 'Phone (390)', styles: { width: '390px', height: '844px' }, type: 'mobile' },
        laptop: { name: 'Laptop (1080)', styles: { width: '1080px', height: '800px' }, type: 'desktop' },
        desktop: { name: 'Desktop (1440)', styles: { width: '1440px', height: '900px' }, type: 'desktop' },
      },
    },
    options: {
      storySort: { order: ['Dashboard', ['Overview'], 'UI', 'Components', 'Panels'] },
    },
  },
};

export default preview;
