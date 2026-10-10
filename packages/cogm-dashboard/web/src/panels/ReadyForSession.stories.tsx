import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';

import { Panel } from '../ui';
import { fail, pending, reply, type Reply } from '../storybook/fakeApi';
import {
  SWITCHES_ERROR,
  SWITCHES_OFF,
  SWITCHES_READY,
  SWITCHES_TONIGHT,
} from '../storybook/fixtures/preflight';
import { PHONE_VIEW, VEIL } from '../storybook/modes';

import { ReadyBlock } from './ReadyForSession';

// "Ready for session", the block at the top of Pre-flight: the AI Tool's write switches, turned on
// for tonight and off again when the session ends. Read when it mounts (GET /api/session/switches).
const switches = (answer: Reply): { dashboard: { api: { routes: Record<string, Reply> } } } => ({
  dashboard: { api: { routes: { '/api/session/switches': answer } } },
});

const meta = {
  title: 'Panels/ReadyForSession',
  parameters: switches(reply(SWITCHES_READY)),
  render: (): JSX.Element => (
    <div style={{ maxWidth: 520 }}>
      <Panel title="✈ Pre-flight">
        <ReadyBlock onChanged={() => undefined} />
      </Panel>
    </div>
  ),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const SomeSwitchesOn: Story = {};
export const AllOff: Story = { parameters: switches(reply(SWITCHES_OFF)) };
export const ReadyForTonight: Story = { parameters: switches(reply(SWITCHES_TONIGHT)) };
export const FailedToLoad: Story = { parameters: switches(reply(SWITCHES_ERROR)) };
export const RouteFailed: Story = {
  parameters: switches(fail(500, 'The dashboard could not read the switches.')),
};
export const Loading: Story = { parameters: switches(pending) };
export const Veil: Story = {
  tags: ['veil'],
  globals: VEIL,
  parameters: switches(reply(SWITCHES_TONIGHT)),
};
export const Phone: Story = {
  tags: ['phone'],
  globals: PHONE_VIEW,
  parameters: switches(reply(SWITCHES_READY)),
};
