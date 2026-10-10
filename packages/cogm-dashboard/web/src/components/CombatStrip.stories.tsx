import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import type { CombatState } from '../lib/combat';
import { PREFS_KEY } from '../lib/prefs';
import type { DuringLayout } from '../lib/prefsModel';
import { BRIDGE_STATUS_KEY, COMBAT_KEY, SETTINGS_KEY } from '../lib/stream';
import {
  BRIDGE_AWAY,
  BRIDGE_UP,
  FIGHT,
  FIGHT_BOSS,
  FIGHT_DEATH_SAVES,
  FIGHT_EMPTY,
} from '../storybook/fixtures/combat';
import { PICKED } from '../storybook/fixtures/during';
import { PHONE_VIEW, VEIL } from '../storybook/modes';
import type { DashboardParameters } from '../storybook/withDashboard';

import { CombatStrip } from './CombatStrip';

// The combat strip: the turn order in the During view's strip slot. The fight, the saved Combat
// buttons choice, GM Actions and the bridge link are seeded the way the stream fills them
// (`cache`); Boss prompts is the browser's own switch, set before the story renders. The play
// steps pick rows and tick reactions as a GM would.
const meta = {
  title: 'Components/Combat strip',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = (): void => undefined;

interface Setup {
  /** The fight; omitted for none. */
  fight?: CombatState;
  combatButtons?: boolean;
  gmActions?: boolean;
  /** The bridge is away (the fight on screen may be old). */
  away?: boolean;
  layout?: DuringLayout;
}

/** `parameters.dashboard` for a story: what the stream would have put in the cache. */
function seed({ fight, combatButtons = false, gmActions = true, away = false }: Setup): {
  dashboard: DashboardParameters;
} {
  return {
    dashboard: {
      cache: [
        [PREFS_KEY, { ...PICKED, combatButtons }],
        [SETTINGS_KEY, { gmActionsEnabled: gmActions }],
        [BRIDGE_STATUS_KEY, away ? BRIDGE_AWAY : BRIDGE_UP],
        ...(fight ? [[COMBAT_KEY, fight] as const] : []),
      ],
    },
  };
}

const BOSS_KEY = 'cogm_boss_prompts';

/** Boss prompts on or off in this browser, for the story's length. */
const bossPrompts = (on: boolean) => (): (() => void) => {
  localStorage.setItem(BOSS_KEY, on ? 'on' : 'off');
  return (): void => localStorage.removeItem(BOSS_KEY);
};

/** The strip in the During view's strip slot, as the page lays it out. */
function Host({
  layout = 'layered',
  fight = true,
  sample = false,
}: {
  layout?: DuringLayout;
  fight?: boolean;
  sample?: boolean;
}): JSX.Element {
  return (
    <div className="story-app">
      <section
        className="moment"
        id="moment-during"
        data-layout={layout === 'layered' && !fight ? 'toggle' : layout}
        data-context={fight || sample ? 'combat' : 'calm'}
        {...(layout === 'layered' && !fight ? { 'data-view': 'full' } : {})}
      >
        <div className="slot slot-strip" data-slot="strip">
          <CombatStrip sample={sample} onOpenTool={noop} />
        </div>
      </section>
    </div>
  );
}

const render =
  (props: { layout?: DuringLayout; fight?: boolean; sample?: boolean } = {}) =>
  (): JSX.Element => <Host {...props} />;

type Play = NonNullable<Story['play']>;

/** Picks these combatants in turn (their row button), then waits for the last to show picked. */
const pick =
  (...names: string[]): Play =>
  async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const name of names) {
      await userEvent.click(await canvas.findByRole('button', { name }));
    }
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: names.at(-1) ?? '' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    );
  };

// --- A fight and no fight ---------------------------------------------------------------------

/** Full view with no fight: the strip says so. Cards and Auto hide the slot until a fight starts. */
export const NoFight: Story = { parameters: seed({}), render: render({ fight: false }) };

export const Fight: Story = { parameters: seed({ fight: FIGHT }), render: render() };

export const FightWithNobodyIn: Story = {
  name: 'A fight with nobody in it',
  parameters: seed({ fight: FIGHT_EMPTY }),
  render: render(),
};

/** Auto makes the turn-order boxes bigger in a fight. */
export const FightInAuto: Story = {
  name: 'Fight in Auto',
  parameters: seed({ fight: FIGHT }),
  render: render({ layout: 'auto' }),
};

export const DeathSaves: Story = {
  parameters: seed({ fight: FIGHT_DEATH_SAVES }),
  render: render(),
};

// --- Combat buttons and GM Actions -----------------------------------------------------------

export const CombatButtonsOn: Story = {
  name: 'Combat buttons on, nothing picked',
  parameters: seed({ fight: FIGHT, combatButtons: true }),
  render: render(),
};

export const CombatButtonsPicked: Story = {
  name: 'Combat buttons on, two picked',
  parameters: seed({ fight: FIGHT, combatButtons: true }),
  render: render(),
  play: pick('Ogre Brute', 'Goblin Archer'),
};

export const GmActionsOff: Story = {
  name: 'Combat buttons on, GM Actions off',
  parameters: seed({ fight: FIGHT, combatButtons: true, gmActions: false }),
  render: render(),
};

// --- Boss prompts -----------------------------------------------------------------------------

export const BossFightPromptsOff: Story = {
  name: 'Boss in the fight, Boss prompts off',
  parameters: seed({ fight: FIGHT_BOSS }),
  beforeEach: bossPrompts(false),
  render: render(),
};

export const BossFightPromptsOn: Story = {
  name: 'Boss in the fight, Boss prompts on',
  parameters: seed({ fight: FIGHT_BOSS }),
  beforeEach: bossPrompts(true),
  render: render(),
};

export const BossReactionUsed: Story = {
  name: 'Boss reaction used',
  parameters: seed({ fight: FIGHT_BOSS }),
  beforeEach: bossPrompts(true),
  render: render(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole('button', { name: 'Reaction ready: Ancient Wyrm' })
    );
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Reaction used: Ancient Wyrm' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    );
  },
};

/** The flag is on from an earlier boss fight and this one has none: no R buttons, the switch stays. */
export const PromptsOnNoBoss: Story = {
  name: 'Boss prompts on, no boss in the fight',
  parameters: seed({ fight: FIGHT }),
  beforeEach: bossPrompts(true),
  render: render(),
};

// --- The bridge is away -----------------------------------------------------------------------

export const BridgeAway: Story = {
  name: 'The bridge is away',
  parameters: seed({ fight: FIGHT, combatButtons: true, away: true }),
  render: render(),
};

export const BridgeAwayPicked: Story = {
  name: 'The bridge is away, two picked and a boss',
  parameters: seed({ fight: FIGHT_BOSS, combatButtons: true, away: true }),
  beforeEach: bossPrompts(true),
  render: render(),
  play: pick('Brannoc', 'Mira'),
};

// --- Layout trial -----------------------------------------------------------------------------

/** The trial's Auto step shows a made-up fight when no real one runs. */
export const TrialSampleFight: Story = {
  name: 'Layout trial: the sample fight',
  parameters: seed({ combatButtons: true }),
  render: render({ layout: 'auto', fight: false, sample: true }),
};

// --- Veil and phone -----------------------------------------------------------------------------

export const FightVeil: Story = {
  tags: ['veil'],
  globals: VEIL,
  parameters: seed({ fight: FIGHT, combatButtons: true }),
  render: render(),
  play: pick('Ogre Brute'),
};

export const BossFightVeil: Story = {
  name: 'Boss fight (Veil)',
  tags: ['veil'],
  globals: VEIL,
  parameters: seed({ fight: FIGHT_BOSS }),
  beforeEach: bossPrompts(true),
  render: render(),
};

export const BridgeAwayVeil: Story = {
  name: 'The bridge is away (Veil)',
  tags: ['veil'],
  globals: VEIL,
  parameters: seed({ fight: FIGHT, combatButtons: true, away: true }),
  render: render(),
};

export const FightPhone: Story = {
  tags: ['phone'],
  globals: PHONE_VIEW,
  parameters: seed({ fight: FIGHT, combatButtons: true }),
  render: render(),
  play: pick('Ogre Brute'),
};

export const BossFightPhone: Story = {
  name: 'Boss fight (phone)',
  tags: ['phone'],
  globals: PHONE_VIEW,
  parameters: seed({ fight: FIGHT_BOSS }),
  beforeEach: bossPrompts(true),
  render: render(),
};

export const BridgeAwayPhone: Story = {
  name: 'The bridge is away (phone)',
  tags: ['phone'],
  globals: PHONE_VIEW,
  parameters: seed({ fight: FIGHT, away: true }),
  render: render(),
};
