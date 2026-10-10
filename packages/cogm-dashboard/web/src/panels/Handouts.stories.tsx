import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';

import { Opened } from '../storybook/Opened';
import { bridgeDown, fail, pending, reply, toolOk, type Reply } from '../storybook/fakeApi';
import { HANDOUTS, HANDOUTS_EMPTY, PLAYERS, SCENES } from '../storybook/fixtures/handouts';
import { PHONE_VIEW, VEIL } from '../storybook/modes';

import { HandoutsDrawer } from './Handouts';

// The handouts drawer: the queue of pages to reveal and who has opened what. It reads the queue
// (list-revealed-pages), the scenes and the player names when it opens.
const bridge = (
  pages: Reply
): { dashboard: { api: { routes: Record<string, Reply>; tools: Record<string, Reply> } } } => ({
  dashboard: {
    api: {
      routes: { '/api/player/names': reply(PLAYERS) },
      tools: { 'list-revealed-pages': pages, 'list-scenes': toolOk(SCENES) },
    },
  },
});

const meta = {
  title: 'Panels/Handouts',
  parameters: { layout: 'fullscreen', ...bridge(toolOk(HANDOUTS)) },
  render: (): JSX.Element => (
    <Opened>
      {(open, onOpenChange) => (
        <HandoutsDrawer open={open} onOpenChange={onOpenChange} onQueuePage={() => undefined} />
      )}
    </Opened>
  ),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};
export const NothingQueued: Story = { parameters: bridge(toolOk(HANDOUTS_EMPTY)) };
export const OnlyQueue: Story = {
  parameters: bridge(toolOk({ ...HANDOUTS, pages: [] })),
};
export const Loading: Story = { parameters: bridge(pending) };
export const Failed: Story = {
  parameters: bridge(fail(500, 'The bridge answered with an error.')),
};
export const BridgeDown: Story = { parameters: bridge(bridgeDown) };
export const Veil: Story = { tags: ['veil'], globals: VEIL, parameters: bridge(toolOk(HANDOUTS)) };
export const Phone: Story = {
  tags: ['phone'],
  globals: PHONE_VIEW,
  parameters: bridge(toolOk(HANDOUTS)),
};
