// Tooltip, Tabs and Popover (UI-04): the Radix set, each in the states that matter.
import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent } from 'storybook/test';

import { VEIL } from '../storybook/modes';

import { Button, IconButton } from './Button';
import { Popover } from './Popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './Tabs';
import { Tooltip } from './Tooltip';

const meta = {
  title: 'UI/Radix set',
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** A tooltip opens on keyboard focus: the play step presses Tab, as a person would. */
export const TooltipOpen: Story = {
  render: () => (
    <div style={{ padding: '3rem 6rem' }}>
      <IconButton label="Close player links" tip="Close">
        ✕
      </IconButton>
    </div>
  ),
  play: async () => {
    await userEvent.tab();
  },
};

export const TooltipOnAButton: Story = {
  render: () => (
    <div style={{ padding: '3rem 6rem' }}>
      <Tooltip content="Plans the change first; nothing happens until you confirm" side="bottom">
        <Button>Plan damage</Button>
      </Tooltip>
    </div>
  ),
  play: async () => {
    await userEvent.tab();
  },
};

const TABS = (
  <Tabs defaultValue="seen" style={{ width: 440 }}>
    <TabsList aria-label="Handouts">
      <TabsTrigger value="queue">Queue</TabsTrigger>
      <TabsTrigger value="seen">Seen</TabsTrigger>
      <TabsTrigger value="all">All pages</TabsTrigger>
    </TabsList>
    <TabsContent value="queue">Three handouts are waiting.</TabsContent>
    <TabsContent value="seen">Mara and Tobias have opened the wanted poster.</TabsContent>
    <TabsContent value="all">Every handout page in the world.</TabsContent>
  </Tabs>
);

export const TabsSelected: Story = { render: () => TABS };
export const TabsVeil: Story = { tags: ['veil'], globals: VEIL, render: () => TABS };

export const TabsFocused: Story = {
  render: () => TABS,
  play: async () => {
    await userEvent.tab();
    await userEvent.keyboard('{ArrowLeft}');
  },
};

export const PopoverOpen: Story = {
  render: () => (
    <div style={{ padding: '1rem 8rem 9rem' }}>
      <Popover label="About rests" defaultOpen trigger={<Button>Rests</Button>}>
        <p style={{ margin: 0, maxWidth: 260 }}>
          A short rest request asks the players to spend hit dice. Nothing changes until they
          accept.
        </p>
        <Button size="sm">Send request</Button>
      </Popover>
    </div>
  ),
};

export const PopoverClosed: Story = {
  render: () => (
    <div style={{ padding: '1rem 8rem' }}>
      <Popover label="About rests" trigger={<Button>Rests</Button>}>
        <p>Hidden until opened.</p>
      </Popover>
    </div>
  ),
};

export const PopoverVeil: Story = { tags: ['veil'], globals: VEIL, ...PopoverOpen };
