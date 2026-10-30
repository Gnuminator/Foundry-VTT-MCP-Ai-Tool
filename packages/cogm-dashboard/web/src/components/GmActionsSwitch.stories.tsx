import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { SWITCHES_KEY } from '../lib/sessionSwitches';
import { SETTINGS_KEY } from '../lib/stream';
import { PHONE_VIEW, VEIL } from '../storybook/modes';
import { reply } from '../storybook/fakeApi';
import { SWITCHES_READY, SWITCHES_TONIGHT } from '../storybook/fixtures/preflight';
import type { DashboardParameters } from '../storybook/withDashboard';

import { LivePlayLine } from './GmActionsSwitch';

// The live play line in the header: "Live play on: all set" or what is off with a Turn on. Start
// session is the only switch; the line shows the state and its list holds one Turn on.
const meta = {
  title: 'Components/Live play line',
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
          <LivePlayLine />
        </div>
      </header>
    </div>
  );
}

const render = (): JSX.Element => <Header />;

const seed = (
  gmActionsEnabled: boolean,
  read: unknown,
  control?: DashboardParameters['api']
): { dashboard: DashboardParameters } => ({
  dashboard: {
    ...(control ? { api: control } : {}),
    cache: [
      [SETTINGS_KEY, { gmActionsEnabled }],
      [SWITCHES_KEY, read],
    ],
  },
});

/** Live play is off: the line names what is off. */
export const Off: Story = {
  parameters: seed(false, SWITCHES_READY),
  render,
  play: async ({ canvasElement }) => {
    const button = await within(canvasElement).findByRole('button', { name: /GM Actions.*off/ });
    await expect(button).not.toHaveClass('on');
  },
};

/** Everything is on after Start session. */
export const AllSet: Story = {
  parameters: seed(true, SWITCHES_TONIGHT),
  render,
  play: async ({ canvasElement }) => {
    const button = await within(canvasElement).findByRole('button', {
      name: 'Live play on: all set',
    });
    await expect(button).toHaveClass('on');
  },
};

/** The list opens with one Turn on; a click turns everything on. */
export const TurnsOn: Story = {
  parameters: seed(false, SWITCHES_READY, {
    routes: {
      'POST /api/session/switches': reply({
        switches: SWITCHES_TONIGHT.switches,
        gmActionsEnabled: true,
        gmActionsChanged: true,
        ok: true,
      }),
    },
  }),
  render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: /GM Actions.*off/ }));
    const list = await within(document.body).findByRole('list', { name: 'Live play switches' });
    await expect(list).toBeVisible();
    await userEvent.click(within(document.body).getByRole('button', { name: 'Turn on' }));
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Live play on: all set' })).toBeVisible()
    );
  },
};

/** The same line, all set, in The Veil theme on a phone. */
export const AllSetInTheVeilOnAPhone: Story = {
  tags: ['veil', 'phone'],
  globals: { ...VEIL, ...PHONE_VIEW },
  parameters: seed(true, SWITCHES_TONIGHT),
  render,
};
