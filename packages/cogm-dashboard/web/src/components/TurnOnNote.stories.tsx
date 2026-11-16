import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';
import { expect, within } from 'storybook/test';

import { useLivePlay } from '../lib/livePlay';
import { ROLL_NEEDS, offReason } from '../lib/liveSwitches';
import { SWITCHES_KEY } from '../lib/sessionSwitches';
import { SETTINGS_KEY } from '../lib/stream';
import { PHONE_VIEW, VEIL } from '../storybook/modes';
import { SWITCHES_READY } from '../storybook/fixtures/preflight';
import { Button } from '../ui';

import { TurnOnNote } from './TurnOnNote';

// A control that live play gates: disabled with the one-line reason and a Turn on beside it.
const meta = {
  title: 'Components/Turn on note',
  parameters: { layout: 'padded' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function GatedButton(): JSX.Element {
  const live = useLivePlay();
  const off = live.off(ROLL_NEEDS);
  return (
    <div>
      <Button
        id="gated-roll"
        aria-disabled={off.length > 0 ? 'true' : undefined}
        title={off.length > 0 ? offReason(off) : undefined}
      >
        Ask the party
      </Button>
      <TurnOnNote live={live} off={off} />
    </div>
  );
}

const seed = {
  dashboard: {
    cache: [
      [SETTINGS_KEY, { gmActionsEnabled: false }],
      [SWITCHES_KEY, SWITCHES_READY],
    ],
  },
};

/** GM Actions are off: the button is disabled and says why. */
export const Gated: Story = {
  parameters: seed,
  render: () => <GatedButton />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('button', { name: 'Ask the party' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    await expect(await canvas.findByRole('button', { name: 'Turn on' })).toBeVisible();
  },
};

/** The same note in The Veil theme on a phone. */
export const GatedInTheVeilOnAPhone: Story = {
  tags: ['veil', 'phone'],
  globals: { ...VEIL, ...PHONE_VIEW },
  parameters: seed,
  render: () => <GatedButton />,
};
