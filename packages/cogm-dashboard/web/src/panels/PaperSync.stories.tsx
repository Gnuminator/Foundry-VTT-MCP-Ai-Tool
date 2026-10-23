import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';

import { Opened } from '../storybook/Opened';
import { bridgeDown, fail, pending, reply, toolOk, type Reply } from '../storybook/fakeApi';
import {
  PAPER_PLAN,
  PAPER_PLAN_REMOVES,
  PAPER_SHEETS,
  PAPER_SHEETS_EMPTY,
  PAPER_SHEETS_FOUR,
  PAPER_SHEETS_UNREADABLE,
} from '../storybook/fixtures/paper';
import { PHONE_VIEW, VEIL } from '../storybook/modes';

import { PaperSyncDrawer } from './PaperSync';

// After a paper night: one card per player character, from /api/party-sheets. Plan asks
// plan-paper-sync; each story says what the sheets route and the planner answer.
const answer = (
  sheets: Reply,
  plan: Reply = toolOk(PAPER_PLAN)
): {
  dashboard: { api: { routes: Record<string, Reply>; tools: Record<string, Reply> } };
} => ({
  dashboard: {
    api: {
      routes: { '/api/party-sheets': sheets },
      tools: { 'plan-paper-sync': plan, 'mark-play-session': toolOk({ success: true }) },
    },
  },
});

const meta = {
  title: 'Panels/PaperSync',
  parameters: { layout: 'fullscreen', ...answer(reply(PAPER_SHEETS)) },
  render: (): JSX.Element => (
    <Opened>
      {(open, onOpenChange) => <PaperSyncDrawer open={open} onOpenChange={onOpenChange} />}
    </Opened>
  ),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};
export const FourCharacters: Story = { parameters: answer(reply(PAPER_SHEETS_FOUR)) };
export const SomeUnreadable: Story = { parameters: answer(reply(PAPER_SHEETS_UNREADABLE)) };
export const NoCharacters: Story = { parameters: answer(reply(PAPER_SHEETS_EMPTY)) };
export const Loading: Story = { parameters: answer(pending) };
export const Failed: Story = {
  parameters: answer(fail(500, 'The bridge answered with an error.')),
};
export const BridgeDown: Story = { parameters: answer(bridgeDown) };
export const PlannerRefuses: Story = {
  parameters: answer(
    reply(PAPER_SHEETS),
    fail(400, 'Not planned: HP: 30 is more than the maximum 24')
  ),
};
export const RemovesAnItem: Story = {
  parameters: answer(reply(PAPER_SHEETS), toolOk(PAPER_PLAN_REMOVES)),
};
export const Veil: Story = {
  tags: ['veil'],
  globals: VEIL,
  parameters: answer(reply(PAPER_SHEETS_FOUR)),
};
export const PhoneFourCharacters: Story = {
  tags: ['phone'],
  globals: PHONE_VIEW,
  parameters: answer(reply(PAPER_SHEETS_FOUR)),
};
