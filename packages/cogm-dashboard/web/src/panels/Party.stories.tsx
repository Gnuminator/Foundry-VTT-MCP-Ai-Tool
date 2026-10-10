import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';

import { Opened } from '../storybook/Opened';
import { bridgeDown, fail, gmActionsOff, pending, toolOk, type Reply } from '../storybook/fakeApi';
import {
  PARTY,
  PARTY_EMPTY,
  PARTY_LONG_NAMES,
  PARTY_OF_EIGHT,
  partyOf,
} from '../storybook/fixtures/party';
import { PHONE_VIEW, VEIL } from '../storybook/modes';

import { PartyDrawer } from './Party';

// The party drawer: members at a glance, travel pace, combat and rests. It asks the bridge for
// get-party each time it opens; each story says what the bridge answers.
const answer = (reply: Reply): { dashboard: { api: { tools: Record<string, Reply> } } } => ({
  dashboard: { api: { tools: { 'get-party': reply } } },
});

const meta = {
  title: 'Panels/Party',
  parameters: { layout: 'fullscreen', ...answer(toolOk(PARTY)) },
  render: (): JSX.Element => (
    <Opened>
      {(open, onOpenChange) => <PartyDrawer open={open} onOpenChange={onOpenChange} />}
    </Opened>
  ),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};
export const OneCharacter: Story = { parameters: answer(toolOk(partyOf(1))) };
export const EightCharacters: Story = { parameters: answer(toolOk(PARTY_OF_EIGHT)) };
export const LongNames: Story = { parameters: answer(toolOk(PARTY_LONG_NAMES)) };
export const NoParty: Story = { parameters: answer(toolOk(PARTY_EMPTY)) };
export const Loading: Story = { parameters: answer(pending) };
export const Failed: Story = {
  parameters: answer(fail(500, 'The bridge answered with an error.')),
};
export const BridgeDown: Story = { parameters: answer(bridgeDown) };
export const GatedRead: Story = { parameters: answer(gmActionsOff) };
export const Veil: Story = {
  tags: ['veil'],
  globals: VEIL,
  parameters: answer(toolOk(PARTY_OF_EIGHT)),
};
export const PhoneEightCharacters: Story = {
  tags: ['phone'],
  globals: PHONE_VIEW,
  parameters: answer(toolOk(PARTY_OF_EIGHT)),
};
export const PhoneLongNames: Story = {
  tags: ['veil', 'phone'],
  globals: { ...VEIL, ...PHONE_VIEW },
  parameters: answer(toolOk(PARTY_LONG_NAMES)),
};
