import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';

import { Opened } from '../storybook/Opened';
import { fail, toolOk, type FakeRequest, type Reply } from '../storybook/fakeApi';
import { PHONE_VIEW } from '../storybook/modes';

import { StatblockTwinDrawer } from './StatblockTwin';

// The 2024 twin of a monster. Made-up numbers; no book text. The tools answer by name.
const actor = (
  name: string,
  cr: number,
  ac: number,
  hp: number,
  features: string[]
): Record<string, unknown> => ({
  name,
  fullData: {
    name,
    system: {
      attributes: { ac: { override: ac }, hp: { max: hp }, movement: { speeds: { walk: '30' } } },
      details: { cr, type: { value: 'undead' } },
      traits: { size: 'med' },
      abilities: {
        str: { value: 16 },
        dex: { value: 16 },
        con: { value: 16 },
        int: { value: 11 },
        wis: { value: 10 },
        cha: { value: 12 },
      },
    },
    items: features.map(f => ({ name: f })),
  },
});

const OLD = 'Compendium.dnd5e.monsters.Actor.old0000000000001';
const NAMED = 'Compendium.dnd5e.monsters.Actor.named00000000001';

function answerFor(request: FakeRequest): Reply {
  const args = request.tool?.args ?? {};
  switch (request.tool?.name) {
    case 'get-compendium-item':
      if (args['itemId'] === 'old0000000000001')
        return toolOk(actor('Vampire Spawn', 4, 13, 60, ['Bite', 'Claws', 'Regeneration']));
      if (args['itemId'] === 'named00000000001')
        return toolOk(actor('Strahd von Zarovich', 9, 12, 99, ['Legendary Actions']));
      return toolOk(actor('Vampire Spawn', 5, 14, 70, ['Multiattack', 'Claw', 'Bite']));
    case 'list-ref-choices':
      return args['query'] === 'vampire'
        ? toolOk({
            choices: [
              { id: 'new0000000000001', name: 'Vampire Spawn' },
              { id: 'new0000000000002', name: 'Vampire' },
            ],
          })
        : toolOk({ choices: [] });
    default:
      return fail(404, 'No answer in this story.');
  }
}

const meta = {
  title: 'Panels/StatblockTwin',
  parameters: {
    layout: 'fullscreen',
    dashboard: {
      api: {
        tools: {
          'get-compendium-item': answerFor,
          'list-ref-choices': answerFor,
          'open-in-foundry': toolOk({}),
        },
      },
    },
  },
  render: (_args, { parameters }): JSX.Element => (
    <Opened>
      {(open, onOpenChange) => (
        <StatblockTwinDrawer
          open={open}
          onOpenChange={onOpenChange}
          initialUuid={String(parameters['uuid'] ?? '')}
        />
      )}
    </Opened>
  ),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const NothingPicked: Story = {};
export const HasATwin: Story = { parameters: { uuid: OLD } };
export const NoClearTwin: Story = { parameters: { uuid: NAMED } };
export const Phone: Story = { parameters: { uuid: OLD, ...PHONE_VIEW } };
