// Preact spike (decision 33): the dashboard build, Storybook and the browser tests run on
// preact/compat in place of react and react-dom. One list, used by vite.config.ts and
// .storybook/main.ts.
export const preactAlias = {
  react: 'preact/compat',
  'react-dom/test-utils': 'preact/test-utils',
  'react-dom/client': 'preact/compat/client',
  'react-dom': 'preact/compat',
  'react/jsx-runtime': 'preact/jsx-runtime',
  'react/jsx-dev-runtime': 'preact/jsx-dev-runtime',
};
