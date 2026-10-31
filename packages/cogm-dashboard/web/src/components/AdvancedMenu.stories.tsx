import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { PHONE_VIEW, VEIL } from '../storybook/modes';
import { Button } from '../ui';

import { AdvancedItem, AdvancedLabel, AdvancedMenu } from './AdvancedMenu';

// The Advanced ▾ menu of the header: a non-modal Radix dropdown whose entries are the old page's
// buttons. The play step opens it, as a click would.
const meta = {
  title: 'Components/AdvancedMenu',
  parameters: { layout: 'fullscreen' },
  render: (): JSX.Element => (
    <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '1rem', minHeight: 360 }}>
      <AdvancedMenu>
        <AdvancedItem onSelect={fn()}>
          <Button id="story-guides">📖 GM guides</Button>
        </AdvancedItem>
        <AdvancedLabel>Panels</AdvancedLabel>
        <AdvancedItem onSelect={fn()}>
          <Button id="story-prep">📋 Prep</Button>
        </AdvancedItem>
        <AdvancedItem onSelect={fn()}>
          <Button id="story-party">🛡 Party</Button>
        </AdvancedItem>
        <AdvancedItem onSelect={fn()}>
          <Button id="story-handouts">📜 Handouts</Button>
        </AdvancedItem>
        <AdvancedLabel>Tools</AdvancedLabel>
        <AdvancedItem onSelect={fn()}>
          <Button id="story-tools">🛠 Tools</Button>
        </AdvancedItem>
        <AdvancedItem onSelect={fn()}>
          <Button id="story-diag">🩺 Module diagnostics</Button>
        </AdvancedItem>
      </AdvancedMenu>
    </div>
  ),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

export const Open: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Advanced/ }));
    // The menu is a lazy chunk: the click opens it as soon as it has arrived.
    await waitFor(() => expect(within(document.body).getByRole('menu')).toBeVisible(), {
      timeout: 10_000,
    });
  },
};

export const OpenVeil: Story = { tags: ['veil'], globals: VEIL, ...Open };
export const OpenPhone: Story = { tags: ['phone'], globals: PHONE_VIEW, ...Open };
