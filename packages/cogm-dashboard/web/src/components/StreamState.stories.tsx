import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';
import { expect, within } from 'storybook/test';

import { STREAM_LINK_KEY, type StreamLink } from '../lib/stream';
import { PHONE_VIEW, VEIL } from '../storybook/modes';
import type { DashboardParameters } from '../storybook/withDashboard';
import { Button } from '../ui';

import { StreamState } from './StreamState';

// The mark in the header for the live stream itself: nothing while it is fine, one pill for every
// panel when the page has lost its link to the dashboard server. `since: 0` is a stream that has
// been down for a long time, so the grace period is over and the mark shows at once.
const meta = {
  title: 'Components/Stream state',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const seed = (link: StreamLink | null): { dashboard: DashboardParameters } => ({
  dashboard: { cache: link ? [[STREAM_LINK_KEY, link]] : [] },
});

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
          <StreamState />
          <Button>✈ Pre-flight: ready</Button>
          <Button>More</Button>
        </div>
      </header>
    </div>
  );
}

const render = (): JSX.Element => <Header />;

/** The stream is connected: the header shows nothing extra. */
export const Connected: Story = {
  parameters: seed({ state: 'open', since: 0 }),
  render,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByText(/Connection/)).toBeNull();
  },
};

/** Not answered yet (the first connect): nothing to say. */
export const Connecting: Story = { parameters: seed(null), render };

/** It dropped a moment ago: inside the grace the header stays quiet, so a quick reconnect is not seen. */
export const DroppedJustNow: Story = {
  name: 'Dropped just now (still quiet)',
  parameters: seed({ state: 'dropped', since: Date.now() }),
  render,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByText(/Connection/)).toBeNull();
  },
};

/** The stream has been down past the grace: one mark in the header, for all panels. */
export const Dropped: Story = {
  parameters: seed({ state: 'dropped', since: 0 }),
  render,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Connection lost, reconnecting…')).toBeVisible();
  },
};

/** The browser gave up: only a reload helps, and the mark says so. */
export const Closed: Story = {
  parameters: seed({ state: 'closed', since: 0 }),
  render,
};

export const DroppedVeil: Story = {
  name: 'Dropped (Veil)',
  tags: ['veil'],
  globals: VEIL,
  parameters: seed({ state: 'dropped', since: 0 }),
  render,
};

export const DroppedPhone: Story = {
  name: 'Dropped (phone)',
  tags: ['phone'],
  globals: PHONE_VIEW,
  parameters: seed({ state: 'dropped', since: 0 }),
  render,
};

export const ClosedPhone: Story = {
  name: 'Closed (phone)',
  tags: ['phone'],
  globals: PHONE_VIEW,
  parameters: seed({ state: 'closed', since: 0 }),
  render,
};
