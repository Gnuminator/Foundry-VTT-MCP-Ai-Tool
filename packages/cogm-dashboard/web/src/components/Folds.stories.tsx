import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { PREFS_KEY } from '../lib/prefs';
import type { DuringPrefs } from '../lib/prefsModel';
import { COMBAT_KEY, FEED_KEY } from '../lib/stream';
import { FIGHT } from '../storybook/fixtures/combat';
import { FEED_FEW } from '../storybook/fixtures/feed';
import { HandoutsDrawer } from '../panels/Handouts';
import { PartyDrawer } from '../panels/Party';
import { reply, toolOk } from '../storybook/fakeApi';
import { PICKED, PLAY_SESSION_STARTED, setPrefsEcho } from '../storybook/fixtures/during';
import { HANDOUTS, PLAYERS, SCENES } from '../storybook/fixtures/handouts';
import { PARTY_OF_EIGHT } from '../storybook/fixtures/party';
import { PHONE_VIEW, VEIL } from '../storybook/modes';
import type { DashboardParameters } from '../storybook/withDashboard';

import { DuringBar, useDuringLayout } from './During';
import { DockContext } from './Drawer';
import { FoldScope } from './Folds';
import { MomentViews, useDocks } from './Moments';

// The folds of the During cards: Live Feed, Recent Changes, Handouts and Party, each with a fold
// button first in its head. The whole During view is on screen, as the page shows it, with the
// layout on; the play steps press the fold buttons the way a GM would (the side set on a wide
// screen, the title click, no side set on a phone). Recent Changes is still a placeholder
// here, with the same head and button.
const meta = {
  title: 'Components/During folds',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = (): void => undefined;

/** `parameters.dashboard` for a story: the saved layout, a fight or not, and the fake bridge. */
function bridge(prefs: DuringPrefs, combat = false): { dashboard: DashboardParameters } {
  return {
    dashboard: {
      cache: [
        [PREFS_KEY, prefs] as const,
        [FEED_KEY, FEED_FEW] as const,
        ...(combat ? [[COMBAT_KEY, FIGHT] as const] : []),
      ],
      api: {
        routes: {
          'POST /api/control': setPrefsEcho(prefs),
          '/api/preflight': reply({ ready: true, checks: [], scan: null }),
          '/api/player/names': reply(PLAYERS),
        },
        tools: {
          'get-play-session': toolOk(PLAY_SESSION_STARTED),
          'get-party': toolOk(PARTY_OF_EIGHT),
          'list-revealed-pages': toolOk(HANDOUTS),
          'list-scenes': toolOk(SCENES),
        },
      },
    },
  };
}

/** The whole During view with Party and Handouts docked in it. */
function Page(): JSX.Element {
  const during = useDuringLayout('during', noop);
  const { slotRefs, dockOf } = useDocks('during');
  const dock = (name: 'party' | 'handouts', panel: JSX.Element): JSX.Element => (
    <DockContext.Provider value={dockOf(name)}>
      <FoldScope card={name} folds={during.folds} active>
        {panel}
      </FoldScope>
    </DockContext.Provider>
  );
  return (
    <div className="story-app">
      <header className="topbar">
        <div className="brand">
          <h1>
            Foundry <span className="wordmark-ai">AI</span> Tool
          </h1>
        </div>
      </header>
      <MomentViews
        moment="during"
        slotRefs={slotRefs}
        duringScreen={during.screen}
        duringBar={<DuringBar during={during} />}
        duringFolds={during.folds}
      />
      {dock('party', <PartyDrawer open onOpenChange={noop} />)}
      {dock('handouts', <HandoutsDrawer open onOpenChange={noop} onQueuePage={noop} />)}
    </div>
  );
}

const page = (): JSX.Element => <Page />;

type Play = NonNullable<Story['play']>;

/** Presses these fold buttons in turn (by their name), then waits for the last to change. */
const press =
  (...names: string[]): Play =>
  async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const name of names) {
      await userEvent.click(await canvas.findByRole('button', { name }));
    }
    const last = names.at(-1) ?? '';
    const flipped = last.startsWith('Fold ') ? `Open ${last.slice(5)}` : `Fold ${last.slice(5)}`;
    await waitFor(() => expect(canvas.getByRole('button', { name: flipped })).toBeVisible());
  };

/** Cards, wide: the Live Feed and Recent Changes open, Handouts and Party folded. */
export const CardsDefault: Story = { parameters: bridge(PICKED), render: page };

/** Opening Handouts folds the other side cards: Recent Changes stays folded with Party. */
export const CardsOpenHandouts: Story = {
  parameters: bridge(PICKED),
  render: page,
  play: press('Open Handouts'),
};

/** Opening Party after that folds Handouts again. */
export const CardsOpenParty: Story = {
  parameters: bridge(PICKED),
  render: page,
  play: press('Open Handouts', 'Open Party'),
};

/** The feed folded too: the head stays with its title. */
export const CardsFeedFolded: Story = {
  parameters: bridge(PICKED),
  render: page,
  play: press('Fold Live Feed'),
};

/** Simple/Full on Full: all four open, no side set. */
export const FullEverythingOpen: Story = {
  parameters: bridge({ ...PICKED, duringLayout: 'toggle', duringFull: true }),
  render: page,
};
export const FullPartyFolded: Story = {
  parameters: bridge({ ...PICKED, duringLayout: 'toggle', duringFull: true }),
  render: page,
  play: press('Fold Party'),
};

/** Auto in a fight: the feed is folded, Party is open in the big column. */
export const AutoInCombat: Story = {
  parameters: bridge({ ...PICKED, duringLayout: 'auto' }, true),
  render: page,
};
export const AutoInCombatOpenFeed: Story = {
  parameters: bridge({ ...PICKED, duringLayout: 'auto' }, true),
  render: page,
  play: press('Open Live Feed'),
};

export const CardsOpenHandoutsVeil: Story = {
  tags: ['veil'],
  globals: VEIL,
  parameters: bridge(PICKED),
  render: page,
  play: press('Open Handouts'),
};

/** On a phone the Live Feed starts folded and Recent Changes comes first. */
export const CardsPhone: Story = {
  tags: ['phone'],
  globals: PHONE_VIEW,
  parameters: bridge(PICKED),
  render: page,
};
/** On a phone opening a card leaves the others as they are. */
export const CardsPhoneOpenParty: Story = {
  tags: ['phone'],
  globals: PHONE_VIEW,
  parameters: bridge(PICKED),
  render: page,
  play: press('Open Party', 'Open Live Feed'),
};
