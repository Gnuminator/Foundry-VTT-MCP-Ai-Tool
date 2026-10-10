import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';

import { Opened } from '../storybook/Opened';
import { fail, pending, reply, type Reply } from '../storybook/fakeApi';
import { MANY_PLAYER_LINKS, PLAYER_LINKS } from '../storybook/fixtures/links';
import { PHONE_VIEW, VEIL } from '../storybook/modes';

import { PlayerLinksPane } from './PlayerLinks';

// Player links: each player's private link to their own character sheet. Read each time the pane
// opens (GET /api/player-links).
const links = (answer: Reply): { dashboard: { api: { routes: Record<string, Reply> } } } => ({
  dashboard: { api: { routes: { '/api/player-links': answer } } },
});

const meta = {
  title: 'Panels/PlayerLinks',
  parameters: { layout: 'fullscreen', ...links(reply({ players: PLAYER_LINKS })) },
  render: (): JSX.Element => (
    <Opened>
      {(open, onOpenChange) => <PlayerLinksPane open={open} onOpenChange={onOpenChange} />}
    </Opened>
  ),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};
export const SixPlayersOneLongName: Story = {
  parameters: links(reply({ players: MANY_PLAYER_LINKS })),
};
export const NoPlayers: Story = { parameters: links(reply({ players: [] })) };
export const Loading: Story = { parameters: links(pending) };
export const Failed: Story = {
  parameters: links(fail(500, 'The dashboard could not read the links.')),
};
export const Veil: Story = {
  tags: ['veil'],
  globals: VEIL,
  parameters: links(reply({ players: PLAYER_LINKS })),
};
export const Phone: Story = {
  tags: ['phone'],
  globals: PHONE_VIEW,
  parameters: links(reply({ players: MANY_PLAYER_LINKS })),
};
