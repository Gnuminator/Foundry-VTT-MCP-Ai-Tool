import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';

import { Opened } from '../storybook/Opened';
import { PHONE_VIEW, VEIL } from '../storybook/modes';
import { EmptyState } from '../ui';

import { OverlayPane } from './OverlayPane';

// A panel over the page (player links, diagnostics, help): a non-modal dialog the Escape key and
// its ✕ close. `Opened` puts a "Reopen" button on the page once it is closed.
const meta = {
  title: 'Components/OverlayPane',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const pane = (
  props: {
    title?: string;
    meta?: string;
    state?: 'loading' | 'empty' | 'error' | 'bridge-down' | 'gated';
  } = {}
): JSX.Element => (
  <Opened>
    {(open, onOpenChange) => (
      <OverlayPane
        open={open}
        onOpenChange={onOpenChange}
        title={props.title ?? 'Player links'}
        meta={props.meta ?? 'read-only character sheets'}
        closeLabel="Close pane"
        help="dashboard#player-links"
        {...(props.state ? { state: props.state } : {})}
      >
        <EmptyState>The pane's content goes here.</EmptyState>
      </OverlayPane>
    )}
  </Opened>
);

export const Open: Story = { render: () => pane() };
export const Loading: Story = { render: () => pane({ state: 'loading' }) };
export const Failed: Story = { render: () => pane({ state: 'error' }) };
export const BridgeDown: Story = { render: () => pane({ state: 'bridge-down' }) };
export const LongTitle: Story = {
  render: () =>
    pane({
      title: 'A pane title long enough that the head has to wrap it',
      meta: 'and a meta text that is long as well',
    }),
};
export const VeilTheme: Story = { tags: ['veil'], globals: VEIL, render: () => pane() };
export const Phone: Story = { tags: ['phone'], globals: PHONE_VIEW, render: () => pane() };
