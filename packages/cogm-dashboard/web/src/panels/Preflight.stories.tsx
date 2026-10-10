import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';

import { Opened } from '../storybook/Opened';
import { bridgeDown, fail, pending, reply, type Reply } from '../storybook/fakeApi';
import {
  PREFLIGHT_CLEAN,
  PREFLIGHT_OK,
  PREFLIGHT_VERSION_MISMATCH,
  SWITCHES_ERROR,
  SWITCHES_OFF,
  SWITCHES_READY,
  SWITCHES_TONIGHT,
} from '../storybook/fixtures/preflight';
import { PHONE_VIEW, VEIL } from '../storybook/modes';

import { PreflightButton, PreflightDrawer, VersionBanner } from './Preflight';

// Pre-flight: the checks before the players join, with "Ready for session" (the switches that
// turn the AI Tool's writes on for the night) at the top. Both are read each time it opens.
const bridge = (
  check: Reply,
  switches: Reply = reply(SWITCHES_READY)
): { dashboard: { api: { routes: Record<string, Reply> } } } => ({
  dashboard: { api: { routes: { '/api/preflight': check, '/api/session/switches': switches } } },
});

const drawer = (tarokkaShown = false): JSX.Element => (
  <Opened>
    {(open, onOpenChange) => (
      <PreflightDrawer
        open={open}
        onOpenChange={onOpenChange}
        tarokkaShown={tarokkaShown}
        onHideTarokka={() => undefined}
      />
    )}
  </Opened>
);

const meta = {
  title: 'Panels/Preflight',
  parameters: { layout: 'fullscreen', ...bridge(reply(PREFLIGHT_OK)) },
  render: (): JSX.Element => drawer(),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const WarningsToLookAt: Story = {};
export const AllClear: Story = { parameters: bridge(reply(PREFLIGHT_CLEAN)) };
export const VersionsDoNotMatch: Story = { parameters: bridge(reply(PREFLIGHT_VERSION_MISMATCH)) };
export const TarokkaCardsShown: Story = { render: () => drawer(true) };
export const Loading: Story = { parameters: bridge(pending) };
export const Failed: Story = {
  parameters: bridge(fail(500, 'The bridge answered with an error.')),
};
export const BridgeDown: Story = { parameters: bridge(bridgeDown) };
export const WritesOff: Story = {
  parameters: bridge(reply(PREFLIGHT_OK), reply(SWITCHES_OFF)),
};
export const ReadyForTonight: Story = {
  parameters: bridge(reply(PREFLIGHT_OK), reply(SWITCHES_TONIGHT)),
};
export const SwitchesFailedToLoad: Story = {
  parameters: bridge(reply(PREFLIGHT_OK), reply(SWITCHES_ERROR)),
};
export const Veil: Story = {
  tags: ['veil'],
  globals: VEIL,
  parameters: bridge(reply(PREFLIGHT_VERSION_MISMATCH)),
};
export const Phone: Story = {
  tags: ['phone'],
  globals: PHONE_VIEW,
  parameters: bridge(reply(PREFLIGHT_OK)),
};

/** The header button and the page-wide banner read the last run's result from the query cache. */
const lastRun = (result: unknown): { dashboard: { cache: [[string[], unknown]] } } => ({
  dashboard: { cache: [[['preflight'], result]] },
});

export const HeaderButtonReady: Story = {
  parameters: lastRun(PREFLIGHT_CLEAN),
  render: () => (
    <div style={{ padding: '1rem' }}>
      <PreflightButton open={false} onToggle={() => undefined} />
    </div>
  ),
};

export const HeaderButtonToFix: Story = {
  parameters: lastRun(PREFLIGHT_VERSION_MISMATCH),
  render: () => (
    <div style={{ padding: '1rem' }}>
      <PreflightButton open={false} onToggle={() => undefined} />
    </div>
  ),
};

export const HeaderButtonNotRunYet: Story = {
  render: () => (
    <div style={{ padding: '1rem' }}>
      <PreflightButton open={false} onToggle={() => undefined} />
    </div>
  ),
};

export const VersionBannerShowing: Story = {
  parameters: lastRun(PREFLIGHT_VERSION_MISMATCH),
  render: () => <VersionBanner />,
};
