import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';
import { fn } from 'storybook/test';

import { PHONE_VIEW, VEIL } from '../storybook/modes';

import { Button, IconButton, Pill } from '.';
import { Panel } from './Panel';

const meta = {
  title: 'UI/Panel',
  component: Panel,
  tags: ['autodocs'],
  args: {
    title: 'Party',
    status: '3 members',
    children: <p>Whatever the panel shows when it is ready goes here.</p>,
  },
  decorators: [
    (Story): JSX.Element => (
      <div style={{ maxWidth: 520 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Panel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};

export const WithHelpAndActions: Story = {
  args: {
    help: 'dashboard#party',
    sub: 'GM only.',
    actions: (
      <IconButton label="Close" tip="Close">
        ✕
      </IconButton>
    ),
    foot: <Button size="sm">Refresh</Button>,
  },
};

export const Drawer: Story = {
  args: {
    as: 'aside',
    variant: 'drawer',
    id: 'story-drawer',
    title: 'Handouts',
    sub: 'What the players have seen.',
    status: undefined,
    actions: (
      <IconButton label="Close" tip="Close">
        ✕
      </IconButton>
    ),
    children: (
      <>
        <Pill tone="on">on</Pill> <Pill tone="off">off</Pill>{' '}
        <Pill variant="condition">Poisoned</Pill>
      </>
    ),
  },
};

export const Loading: Story = { args: { state: 'loading' } };
export const Empty: Story = {
  args: { state: 'empty', stateMessage: 'No party yet. Add characters to the group in Foundry.' },
};
export const Failed: Story = {
  args: {
    state: 'error',
    stateMessage: 'Couldn’t load the party: HTTP 500',
    onRetry: fn(),
  },
};
export const BridgeDown: Story = { args: { state: 'bridge-down', onRetry: fn() } };
export const Gated: Story = { args: { state: 'gated' } };

export const LongTitle: Story = {
  args: {
    title: 'A panel title that is much longer than the head has room for on one line',
    status: 'a long status text beside it',
  },
};

export const VeilTheme: Story = {
  tags: ['veil'],
  globals: VEIL,
  args: { help: 'dashboard#party' },
};
export const Phone: Story = {
  tags: ['phone'],
  globals: PHONE_VIEW,
  args: { state: 'error', onRetry: fn() },
};
