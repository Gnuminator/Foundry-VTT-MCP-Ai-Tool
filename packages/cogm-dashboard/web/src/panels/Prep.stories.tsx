import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';

import { Opened } from '../storybook/Opened';
import { bridgeDown, fail, pending, toolOk, type Reply } from '../storybook/fakeApi';
import { PREP, PREP_BUSY, PREP_FRESH } from '../storybook/fixtures/prep';
import { PHONE_VIEW, VEIL } from '../storybook/modes';

import { PrepDrawer } from './Prep';

// The prep drawer: last session, open threads, next session notes. It asks for get-prep-digest
// each time it opens.
const digest = (reply: Reply): { dashboard: { api: { tools: Record<string, Reply> } } } => ({
  dashboard: { api: { tools: { 'get-prep-digest': reply } } },
});

const meta = {
  title: 'Panels/Prep',
  parameters: { layout: 'fullscreen', ...digest(toolOk(PREP)) },
  render: (): JSX.Element => (
    <Opened>
      {(open, onOpenChange) => (
        <PrepDrawer open={open} onOpenChange={onOpenChange} onOpenPreflight={() => undefined} />
      )}
    </Opened>
  ),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};
export const FreshWorld: Story = { parameters: digest(toolOk(PREP_FRESH)) };
export const WarningsAndLongNames: Story = { parameters: digest(toolOk(PREP_BUSY)) };
export const Loading: Story = { parameters: digest(pending) };
export const Failed: Story = {
  parameters: digest(fail(500, 'The bridge answered with an error.')),
};
export const BridgeDown: Story = { parameters: digest(bridgeDown) };
export const Veil: Story = { tags: ['veil'], globals: VEIL, parameters: digest(toolOk(PREP)) };
export const Phone: Story = {
  tags: ['phone'],
  globals: PHONE_VIEW,
  parameters: digest(toolOk(PREP_BUSY)),
};
