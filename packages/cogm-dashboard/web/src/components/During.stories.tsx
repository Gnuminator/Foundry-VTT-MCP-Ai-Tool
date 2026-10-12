import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { PREFS_KEY } from '../lib/prefs';
import type { DuringPrefs } from '../lib/prefsModel';
import { COMBAT_KEY } from '../lib/stream';
import { FIGHT } from '../storybook/fixtures/combat';
import { HandoutsDrawer } from '../panels/Handouts';
import { PartyDrawer } from '../panels/Party';
import { reply, toolOk } from '../storybook/fakeApi';
import {
  NOT_PICKED,
  PICKED,
  PLAY_SESSION_STARTED,
  setPrefsEcho,
} from '../storybook/fixtures/during';
import { HANDOUTS, PLAYERS, SCENES } from '../storybook/fixtures/handouts';
import { PARTY_OF_EIGHT } from '../storybook/fixtures/party';
import { PHONE_VIEW, VEIL } from '../storybook/modes';
import type { DashboardParameters } from '../storybook/withDashboard';

import { AdvancedMenu } from './AdvancedMenu';
import {
  DuringBar,
  DuringMenuItems,
  LayoutTourGuide,
  LayoutTrialCard,
  useDuringLayout,
} from './During';
import { DockContext } from './Drawer';
import { FoldScope } from './Folds';
import { MomentViews, useDocks, type Moment } from './Moments';

// The During layouts: the bar with its switch, the Before card and the guide of the layout trial,
// the two Advanced menu entries, and the whole During view in each layout. The saved choice is
// seeded the way the stream fills it (`cache`); a click saves to a fake `set-prefs` that answers
// like the server, so the stories react. The play steps start the trial and press its buttons.
const meta = {
  title: 'Components/During layouts',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = (): void => undefined;

interface Setup {
  /** The saved choices; omitted until the world is known. */
  prefs?: DuringPrefs;
  /** A fight runs (the `combat` stream event). */
  combat?: boolean;
  /** An open session with a start time, which the hint needs. */
  session?: boolean;
}

/** `parameters.dashboard` for a story: the cache the stream would fill and the fake set-prefs. */
function bridge({ prefs, combat = false, session = false }: Setup): {
  dashboard: DashboardParameters;
} {
  return {
    dashboard: {
      cache: [
        ...(prefs ? [[PREFS_KEY, prefs] as const] : []),
        ...(combat ? [[COMBAT_KEY, FIGHT] as const] : []),
      ],
      api: {
        routes: {
          'POST /api/control': setPrefsEcho(prefs ?? NOT_PICKED),
          '/api/preflight': reply({ ready: true, checks: [], scan: null }),
          '/api/player/names': reply(PLAYERS),
        },
        tools: {
          ...(session ? { 'get-play-session': toolOk(PLAY_SESSION_STARTED) } : {}),
          'get-party': toolOk(PARTY_OF_EIGHT),
          'list-revealed-pages': toolOk(HANDOUTS),
          'list-scenes': toolOk(SCENES),
        },
      },
    },
  };
}

/** The During bar in its view, the Before card above it, and the trial's guide in the corner. */
function Host({
  card = false,
  moment = 'during',
}: {
  card?: boolean;
  moment?: Moment;
}): JSX.Element {
  const during = useDuringLayout(moment, noop);
  const { screen } = during;
  return (
    // A transform makes the guide's `position: fixed` relative to this box, so it is in the shot.
    <div style={{ padding: '1rem', minHeight: 440, transform: 'translate(0)' }}>
      {card && (
        <section className="moment" style={{ marginBottom: '1rem' }}>
          <LayoutTrialCard during={during} />
        </section>
      )}
      <section
        className="moment"
        id="moment-during"
        data-layout={screen.layout}
        data-context={screen.context}
        data-view={screen.view}
      >
        <DuringBar during={during} />
      </section>
      <LayoutTourGuide during={during} />
    </div>
  );
}

const render =
  (props: { card?: boolean } = {}) =>
  (): JSX.Element => <Host {...props} />;

export const BarCards: Story = { parameters: bridge({ prefs: PICKED }), render: render() };
export const BarSimple: Story = {
  parameters: bridge({ prefs: { ...PICKED, duringLayout: 'toggle' } }),
  render: render(),
};
export const BarFull: Story = {
  parameters: bridge({ prefs: { ...PICKED, duringLayout: 'toggle', duringFull: true } }),
  render: render(),
};
export const BarAuto: Story = {
  parameters: bridge({ prefs: { ...PICKED, duringLayout: 'auto' } }),
  render: render(),
};
export const BarAutoInCombat: Story = {
  parameters: bridge({ prefs: { ...PICKED, duringLayout: 'auto' }, combat: true }),
  render: render(),
};
export const BarWithHint: Story = {
  parameters: bridge({ prefs: NOT_PICKED, session: true }),
  render: render(),
};
export const BarWaitingForTheWorld: Story = {
  name: 'Bar: the world is not known yet',
  parameters: bridge({}),
  render: render(),
};
export const BarSimpleVeil: Story = {
  tags: ['veil'],
  globals: VEIL,
  parameters: bridge({ prefs: { ...PICKED, duringLayout: 'toggle' } }),
  render: render(),
};
export const BarHintPhone: Story = {
  tags: ['phone'],
  globals: PHONE_VIEW,
  parameters: bridge({ prefs: NOT_PICKED, session: true }),
  render: render(),
};

/** Presses these buttons in turn, as a GM would. */
const press =
  (...names: (string | RegExp)[]) =>
  async ({ canvasElement }: { canvasElement: HTMLElement }): Promise<void> => {
    const canvas = within(canvasElement);
    for (const name of names) {
      await userEvent.click(await canvas.findByRole('button', { name }));
    }
    await waitFor(() => expect(canvasElement.querySelector('#layout-tour')).toBeVisible());
  };

export const TrialCard: Story = {
  name: 'Trial: the card in Before',
  parameters: bridge({ prefs: NOT_PICKED }),
  render: render({ card: true }),
};
export const TrialCardVeil: Story = {
  name: 'Trial: the card in Before (Veil)',
  tags: ['veil'],
  globals: VEIL,
  parameters: bridge({ prefs: NOT_PICKED }),
  render: render({ card: true }),
};
export const TrialCardPhone: Story = {
  name: 'Trial: the card in Before (phone)',
  tags: ['phone'],
  globals: PHONE_VIEW,
  parameters: bridge({ prefs: NOT_PICKED }),
  render: render({ card: true }),
};
export const TrialStep1Cards: Story = {
  name: 'Trial: step 1, Cards',
  parameters: bridge({ prefs: NOT_PICKED }),
  render: render({ card: true }),
  play: press('Try the layouts'),
};
export const TrialStep2Simple: Story = {
  name: 'Trial: step 2, Simple/Full',
  parameters: bridge({ prefs: NOT_PICKED }),
  render: render({ card: true }),
  play: press('Try the layouts', 'Next'),
};
export const TrialStep2Full: Story = {
  name: 'Trial: step 2, Full preview',
  parameters: bridge({ prefs: NOT_PICKED }),
  render: render({ card: true }),
  play: press('Try the layouts', 'Next', 'Show everything'),
};
export const TrialStep3Auto: Story = {
  name: 'Trial: step 3, Auto with the sample fight',
  parameters: bridge({ prefs: NOT_PICKED }),
  render: render({ card: true }),
  play: press('Try the layouts', 'Next', 'Next'),
};
export const TrialStep3Veil: Story = {
  name: 'Trial: step 3 (Veil)',
  tags: ['veil'],
  globals: VEIL,
  parameters: bridge({ prefs: NOT_PICKED }),
  render: render({ card: true }),
  play: press('Try the layouts', 'Next', 'Next'),
};
export const TrialStep2Phone: Story = {
  name: 'Trial: step 2 (phone)',
  tags: ['phone'],
  globals: PHONE_VIEW,
  parameters: bridge({ prefs: NOT_PICKED }),
  render: render({ card: true }),
  play: press('Try the layouts', 'Next'),
};
/** The Advanced menu with the During group. */
function MenuHost(): JSX.Element {
  const during = useDuringLayout('during', noop);
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '1rem', minHeight: 360 }}>
      <AdvancedMenu>
        <DuringMenuItems during={during} />
      </AdvancedMenu>
    </div>
  );
}

const openMenu = async ({ canvasElement }: { canvasElement: HTMLElement }): Promise<void> => {
  await userEvent.click(within(canvasElement).getByRole('button', { name: /Advanced/ }));
  await waitFor(() => expect(within(document.body).getByRole('menu')).toBeVisible());
};

export const MenuOpen: Story = {
  parameters: bridge({ prefs: PICKED }),
  render: (): JSX.Element => <MenuHost />,
  play: openMenu,
};
export const MenuCombatButtonsOn: Story = {
  parameters: bridge({ prefs: { ...PICKED, combatButtons: true } }),
  render: (): JSX.Element => <MenuHost />,
  play: openMenu,
};
export const MenuWaitingForTheWorld: Story = {
  name: 'Menu: the world is not known yet',
  parameters: bridge({}),
  render: (): JSX.Element => <MenuHost />,
  play: openMenu,
};
export const MenuOpenVeil: Story = {
  tags: ['veil'],
  globals: VEIL,
  parameters: bridge({ prefs: PICKED }),
  render: (): JSX.Element => <MenuHost />,
  play: openMenu,
};
export const MenuOpenPhone: Story = {
  tags: ['phone'],
  globals: PHONE_VIEW,
  parameters: bridge({ prefs: PICKED }),
  render: (): JSX.Element => <MenuHost />,
  play: openMenu,
};

/** The whole During view with the layout on, Party and Handouts docked, as the page shows it. */
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
      <LayoutTourGuide during={during} />
    </div>
  );
}

const page = (): JSX.Element => <Page />;

export const PageCards: Story = { parameters: bridge({ prefs: PICKED }), render: page };
export const PageSimple: Story = {
  parameters: bridge({ prefs: { ...PICKED, duringLayout: 'toggle' } }),
  render: page,
};
export const PageFull: Story = {
  parameters: bridge({ prefs: { ...PICKED, duringLayout: 'toggle', duringFull: true } }),
  render: page,
};
export const PageAutoCalm: Story = {
  parameters: bridge({ prefs: { ...PICKED, duringLayout: 'auto' } }),
  render: page,
};
export const PageAutoInCombat: Story = {
  parameters: bridge({ prefs: { ...PICKED, duringLayout: 'auto' }, combat: true }),
  render: page,
};
export const PageAutoInCombatVeil: Story = {
  tags: ['veil'],
  globals: VEIL,
  parameters: bridge({ prefs: { ...PICKED, duringLayout: 'auto' }, combat: true }),
  render: page,
};
export const PageAutoInCombatPhone: Story = {
  tags: ['phone'],
  globals: PHONE_VIEW,
  parameters: bridge({ prefs: { ...PICKED, duringLayout: 'auto' }, combat: true }),
  render: page,
};
export const PageCardsPhone: Story = {
  tags: ['phone'],
  globals: PHONE_VIEW,
  parameters: bridge({ prefs: PICKED }),
  render: page,
};
