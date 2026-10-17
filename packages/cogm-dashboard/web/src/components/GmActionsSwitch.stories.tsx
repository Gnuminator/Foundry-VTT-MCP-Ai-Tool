import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { SETTINGS_KEY } from '../lib/stream';
import { PHONE_VIEW, VEIL } from '../storybook/modes';
import { fail, reply } from '../storybook/fakeApi';
import type { DashboardParameters } from '../storybook/withDashboard';

import { GmActionsSwitch } from './GmActionsSwitch';

// The GM Actions master switch in the header: red and "on" while game-changing actions are allowed.
// A click asks the server to flip it (toggle-gm-actions) and shows what the server answers.
const meta = {
  title: 'Components/GM Actions switch',
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
          <GmActionsSwitch />
        </div>
      </header>
    </div>
  );
}

const render = (): JSX.Element => <Header />;

const seed = (
  gmActionsEnabled: boolean,
  control?: DashboardParameters['api']
): { dashboard: DashboardParameters } => ({
  dashboard: {
    ...(control ? { api: control } : {}),
    cache: [[SETTINGS_KEY, { gmActionsEnabled }]],
  },
});

/** GM Actions are off: nothing the dashboard writes to the game goes through. */
export const Off: Story = {
  parameters: seed(false),
  render,
  play: async ({ canvasElement }) => {
    const button = await within(canvasElement).findByRole('button', { name: '⚔ GM Actions: off' });
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await expect(button).not.toHaveClass('on');
  },
};

/** GM Actions are on: the button is lit. */
export const On: Story = {
  parameters: seed(true),
  render,
  play: async ({ canvasElement }) => {
    const button = await within(canvasElement).findByRole('button', { name: '⚔ GM Actions: on' });
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(button).toHaveClass('on');
  },
};

/** A click turns them on, as far as the server's answer says. */
export const TurnsOn: Story = {
  parameters: seed(false, {
    routes: { 'POST /api/control': reply({ gmActionsEnabled: true }) },
  }),
  render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: '⚔ GM Actions: off' }));
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: '⚔ GM Actions: on' })).toBeVisible()
    );
  },
};

/** The server cannot be reached: the toast says why and the switch stays as it was. */
export const ClickFails: Story = {
  parameters: seed(false, {
    routes: { 'POST /api/control': fail(500, 'The dashboard server is not answering.') },
  }),
  render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: '⚔ GM Actions: off' }));
    await waitFor(() =>
      expect(within(document.body).getAllByText(/^✗ GM Actions: /)).not.toHaveLength(0)
    );
    await expect(canvas.getByRole('button', { name: '⚔ GM Actions: off' })).toBeEnabled();
  },
};

/** The same switch, on, in The Veil theme on a phone. */
export const OnInTheVeilOnAPhone: Story = {
  tags: ['veil', 'phone'],
  globals: { ...VEIL, ...PHONE_VIEW },
  parameters: seed(true),
  render,
};
