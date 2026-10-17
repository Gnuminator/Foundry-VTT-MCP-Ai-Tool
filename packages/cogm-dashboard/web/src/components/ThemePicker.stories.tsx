import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { PHONE_VIEW, VEIL } from '../storybook/modes';
import { fail, reply } from '../storybook/fakeApi';

import { ThemePicker } from './ThemePicker';

// The theme picker in the header: the look for this world (Neutral or The Veil). The page itself
// changes look in App (useWorldTheme); here only the picker and its saving are shown.
const meta = {
  title: 'Components/Theme picker',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The header's controls, as the page lays them out. */
function Header(): JSX.Element {
  return (
    <div className="story-app">
      <header className="topbar">
        <div className="brand">
          <div>
            <h1>
              Foundry <span className="wordmark-ai">AI</span> Tool
            </h1>
            <p className="subtitle">New dashboard (preview)</p>
          </div>
        </div>
        <div className="controls">
          <ThemePicker />
        </div>
      </header>
    </div>
  );
}

const render = (): JSX.Element => <Header />;

/** The world uses the neutral look. */
export const Neutral: Story = {
  parameters: { dashboard: { api: { routes: { '/api/theme': reply({ theme: 'neutral' }) } } } },
  render,
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(within(canvasElement).getByRole('combobox', { name: /Theme/ })).toHaveValue('neutral')
    );
  },
};

/** The world uses The Veil. */
export const TheVeil: Story = {
  parameters: { dashboard: { api: { routes: { '/api/theme': reply({ theme: 'veil' }) } } } },
  render,
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(within(canvasElement).getByRole('combobox', { name: /Theme/ })).toHaveValue('veil')
    );
  },
};

/** Picking The Veil saves it and the picker shows what the server answered. */
export const PicksTheVeil: Story = {
  parameters: {
    dashboard: {
      api: {
        routes: {
          '/api/theme': reply({ theme: 'neutral' }),
          'POST /api/control': reply({ theme: 'veil', themes: ['neutral', 'veil'] }),
        },
      },
    },
  },
  render,
  play: async ({ canvasElement }) => {
    const picker = await within(canvasElement).findByRole('combobox', { name: /Theme/ });
    await userEvent.selectOptions(picker, 'veil');
    await waitFor(() => expect(picker).toHaveValue('veil'));
  },
};

/** The server cannot save it: the toast says why and the picker goes back to the showing theme. */
export const SaveFails: Story = {
  parameters: {
    dashboard: {
      api: {
        routes: {
          '/api/theme': reply({ theme: 'neutral' }),
          'POST /api/control': fail(500, 'Could not save the theme.'),
        },
      },
    },
  },
  render,
  play: async ({ canvasElement }) => {
    const picker = await within(canvasElement).findByRole('combobox', { name: /Theme/ });
    await userEvent.selectOptions(picker, 'veil');
    await waitFor(() =>
      expect(
        within(document.body).getAllByText('✗ Theme: Could not save the theme.')
      ).not.toHaveLength(0)
    );
    await waitFor(() => expect(picker).toHaveValue('neutral'));
  },
};

/** The same header in The Veil theme on a phone. */
export const VeilOnAPhone: Story = {
  tags: ['veil', 'phone'],
  globals: { ...VEIL, ...PHONE_VIEW },
  parameters: { dashboard: { api: { routes: { '/api/theme': reply({ theme: 'veil' }) } } } },
  render,
};
