import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { fail, pending } from '../storybook/fakeApi';
import { VEIL } from '../storybook/modes';
import { Panel } from '../ui';

// The "?" next to a panel title, and the help pane it opens (HelpProvider, which the preview wraps
// every story in). The guide page comes from the fake /api/help route.
const meta = {
  title: 'Components/Help',
  parameters: { layout: 'fullscreen' },
  render: (): JSX.Element => (
    <div style={{ padding: '1rem', maxWidth: 520 }}>
      <Panel title="Party" help="dashboard#party">
        <p>Click the ? to open the guide at this panel's heading.</p>
      </Panel>
    </div>
  ),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const open = async ({ canvasElement }: { canvasElement: HTMLElement }): Promise<void> => {
  await userEvent.click(within(canvasElement).getByRole('button', { name: 'Help for this panel' }));
};

export const HelpButton: Story = {};

export const PaneOpen: Story = {
  play: async context => {
    await open(context);
    await waitFor(() =>
      expect(within(document.body).getByText('Before the session')).toBeVisible()
    );
  },
};

export const PaneLoading: Story = {
  parameters: { dashboard: { api: { routes: { '/api/help/*': pending } } } },
  play: open,
};

export const PaneFailed: Story = {
  parameters: {
    dashboard: { api: { routes: { '/api/help/*': fail(404, 'No guide page with that name.') } } },
  },
  play: async context => {
    await open(context);
    await waitFor(() => expect(within(document.body).getByText(/No guide page/)).toBeVisible());
  },
};

export const PaneVeil: Story = { tags: ['veil'], globals: VEIL, ...PaneOpen };
