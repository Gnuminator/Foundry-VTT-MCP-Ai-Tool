import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';
import { expect, within } from 'storybook/test';

import type { CombatState, Combatant } from '../lib/combat';
import { FIGHT, FIGHT_BOSS, FIGHT_DEATH_SAVES, combatant } from '../storybook/fixtures/combat';
import { PHONE_VIEW, VEIL } from '../storybook/modes';

import { InitiativeRibbon } from './InitiativeRibbon';

// The initiative ribbon (UI-07): the turn order as one strip. It only reads a fight, so the
// stories hand it one directly; the Combat strip stories show it inside the panel.
const meta = {
  title: 'Components/Initiative ribbon',
  parameters: { layout: 'padded' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** A fight of `n` made-up creatures, the one at `turn` up. */
function crowd(n: number, turn: number): CombatState {
  const names = ['Ash', 'Bram', 'Cinder', 'Dova', 'Edda', 'Fenn', 'Gale', 'Hob', 'Ivo', 'Juno'];
  const list: Combatant[] = Array.from({ length: n }, (_, i) =>
    combatant(`c${i}`, `${names[i % names.length]} ${i + 1}`, {
      initiative: 30 - i,
      isCurrentTurn: i === turn,
      isPC: i % 3 === 0,
      category: i % 3 === 0 ? 'pc' : i % 3 === 1 ? 'enemy' : 'npc',
      hp: { value: 20 - (i % 4) * 6, max: 20, temp: 0 },
      conditions: i === 1 ? ['Concentrating: Bless', 'Prone'] : [],
    })
  );
  return { active: true, round: 2, turn, current: list[turn] ?? null, combatants: list };
}

function Show({ combat }: { combat: CombatState }): JSX.Element {
  return (
    <div style={{ background: 'var(--bg-panel)', borderRadius: 'var(--r-md)' }}>
      <InitiativeRibbon combat={combat} />
    </div>
  );
}

export const Five: Story = {
  render: () => <Show combat={FIGHT} />,
  play: async ({ canvasElement }) => {
    const list = within(canvasElement).getByRole('list', { name: /Brannoc is up, then/ });
    await expect(list).toBeVisible();
    await expect(canvasElement.querySelector('[data-role="current"]')).toHaveTextContent('Brannoc');
  },
};

/** A made-up round portrait as an inline image, so the baseline needs no server. */
const portrait = (fill: string, letter: string): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${fill}"/><text x="32" y="42" font-size="30" text-anchor="middle" fill="white" font-family="sans-serif">${letter}</text></svg>`
  )}`;

/** Portraits on some creatures (a click pans Foundry to the token); the rest keep their initials. */
export const WithPortraits: Story = {
  render: () => (
    <Show
      combat={{
        ...FIGHT,
        combatants: FIGHT.combatants.map((c, i) => ({
          ...c,
          img:
            i % 2 === 0
              ? portrait(['#7a4', '#a47', '#47a'][i % 3] ?? '#777', c.name.charAt(0))
              : null,
          tokenUuid: i === 3 ? null : `Scene.sceneAAAAAAAAAAAA.Token.token${i}AAAAAAAAAA`,
        })),
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('img')).not.toBeNull();
    await expect(
      within(canvasElement).getByRole('button', { name: 'Pan to Brannoc' })
    ).toBeVisible();
  },
};

export const Two: Story = { render: () => <Show combat={crowd(2, 1)} /> };

export const Eight: Story = { render: () => <Show combat={crowd(8, 3)} /> };

export const Twenty: Story = { render: () => <Show combat={crowd(20, 17)} /> };

export const WithLairAndBoss: Story = { render: () => <Show combat={FIGHT_BOSS} /> };

export const SomeoneDown: Story = {
  render: () => <Show combat={{ ...FIGHT_DEATH_SAVES, turn: 1 }} />,
};

export const Phone: Story = {
  render: () => <Show combat={crowd(8, 0)} />,
  tags: ['phone'],
  globals: PHONE_VIEW,
};

export const PhoneVeil: Story = {
  render: () => <Show combat={crowd(8, 0)} />,
  tags: ['veil', 'phone'],
  globals: { ...VEIL, ...PHONE_VIEW },
};
