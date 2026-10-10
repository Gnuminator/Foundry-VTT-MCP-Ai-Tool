import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type JSX } from 'react';

import { SETTINGS_KEY } from '../lib/stream';
import { Opened } from '../storybook/Opened';
import { bridgeDown, fail, pending, toolOk, type Reply } from '../storybook/fakeApi';
import { TAROKKA, TAROKKA_NO_READING, TAROKKA_UNAVAILABLE } from '../storybook/fixtures/tarokka';
import { PHONE_VIEW, VEIL } from '../storybook/modes';

import { TarokkaDrawer } from './Tarokka';

// The Tarokka drawer (placeholder cards, not the deck's): the reading, its links and reveal
// state. "Show cards" is off every time the drawer opens; the cards stay veiled until it is ticked.
const reading = (answer: Reply): { dashboard: { api: { tools: Record<string, Reply> } } } => ({
  dashboard: { api: { tools: { 'get-tarokka-reading': answer } } },
});

function Drawer({ cardsShown = false }: { cardsShown?: boolean }): JSX.Element {
  const [shown, setShown] = useState(cardsShown);
  return (
    <Opened>
      {(open, onOpenChange) => (
        <TarokkaDrawer
          open={open}
          onOpenChange={onOpenChange}
          showCards={shown}
          onShowCardsChange={setShown}
        />
      )}
    </Opened>
  );
}

const meta = {
  title: 'Panels/Tarokka',
  parameters: { layout: 'fullscreen', ...reading(toolOk(TAROKKA)) },
  render: (): JSX.Element => <Drawer />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const CardsVeiled: Story = {};
export const CardsShown: Story = { render: () => <Drawer cardsShown /> };
export const NoReadingYet: Story = { parameters: reading(toolOk(TAROKKA_NO_READING)) };
export const NotAvailable: Story = { parameters: reading(toolOk(TAROKKA_UNAVAILABLE)) };
export const Loading: Story = { parameters: reading(pending) };
export const Failed: Story = {
  parameters: reading(fail(500, 'The bridge answered with an error.')),
};
export const BridgeDown: Story = { parameters: reading(bridgeDown) };
export const WithObsidianLink: Story = {
  parameters: {
    dashboard: {
      api: { tools: { 'get-tarokka-reading': toolOk(TAROKKA) } },
      cache: [[SETTINGS_KEY, { gmActionsEnabled: true, obsidian: { vault: 'Story vault' } }]],
    },
  },
};
export const VeilCardsShown: Story = {
  tags: ['veil'],
  globals: VEIL,
  render: () => <Drawer cardsShown />,
};
export const PhoneCardsShown: Story = {
  tags: ['phone'],
  globals: PHONE_VIEW,
  render: () => <Drawer cardsShown />,
};
