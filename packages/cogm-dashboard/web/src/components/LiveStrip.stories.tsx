import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import type { CombatState } from '../lib/combat';
import { BRIDGE_STATUS_KEY, COMBAT_KEY, SETTINGS_KEY } from '../lib/stream';
import { toolOk } from '../storybook/fakeApi';
import { BRIDGE_UP, FIGHT, FIGHT_DEATH_SAVES, FIGHT_TIMED } from '../storybook/fixtures/combat';
import { AI_CHANGES } from '../storybook/fixtures/changes';
import { HANDOUTS, SCENES } from '../storybook/fixtures/handouts';
import { PHONE_VIEW, VEIL } from '../storybook/modes';
import type { DashboardParameters } from '../storybook/withDashboard';

import { LiveStrip } from './LiveStrip';

// The live strip: the one component live screens A and B share. The fight, GM Actions and the
// bridge link are seeded the way the stream fills them; the changes, scenes and handout queue
// are answered by the fake bridge. The play steps pick a creature the way a GM would.
const meta = {
  title: 'Components/Live strip',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function seed(fight?: CombatState): { dashboard: DashboardParameters } {
  return {
    dashboard: {
      cache: [
        [SETTINGS_KEY, { gmActionsEnabled: true }],
        [BRIDGE_STATUS_KEY, BRIDGE_UP],
        ...(fight ? [[COMBAT_KEY, fight] as const] : []),
      ],
      api: {
        tools: {
          'list-recent-changes': toolOk(AI_CHANGES),
          'list-revealed-pages': toolOk(HANDOUTS),
          'list-scenes': toolOk(SCENES),
        },
      },
    },
  };
}

const render = (): JSX.Element => (
  <div className="story-app">
    <LiveStrip />
  </div>
);

type Play = NonNullable<Story['play']>;

const pickOgre: Play = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole('button', { name: 'Ogre Brute' }));
  await waitFor(() =>
    expect(canvas.getByRole('button', { name: 'Ogre Brute' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  );
};

export const NoFight: Story = { parameters: seed(), render };

export const Fight: Story = { parameters: seed(FIGHT), render };

export const DownAndDying: Story = { parameters: seed(FIGHT_DEATH_SAVES), render };

/** A timed condition says how long it has left; one whose time is up says "ended". */
export const TimedConditions: Story = { parameters: seed(FIGHT_TIMED), render };

/** One picked with "1 round" on: the next condition added lasts one round. */
export const OneRoundOn: Story = {
  parameters: seed(FIGHT),
  render,
  play: async context => {
    await pickOgre(context);
    const toggle = within(context.canvasElement).getByRole('button', { name: /1 round/ });
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-pressed', 'true'));
  },
};

/** One picked: the pick bar names them and the Damage / Heal form is open under it. */
export const OnePicked: Story = { parameters: seed(FIGHT), render, play: pickOgre };

export const FightVeil: Story = {
  name: 'Fight (Veil)',
  tags: ['veil'],
  globals: VEIL,
  parameters: seed(FIGHT),
  render,
  play: pickOgre,
};

export const FightPhone: Story = {
  name: 'Fight (phone)',
  tags: ['phone'],
  globals: PHONE_VIEW,
  parameters: seed(FIGHT),
  render,
  play: pickOgre,
};

export const FightVeilPhone: Story = {
  name: 'Fight (Veil, phone)',
  tags: ['veil', 'phone'],
  globals: { ...VEIL, ...PHONE_VIEW },
  parameters: seed(FIGHT),
  render,
};
