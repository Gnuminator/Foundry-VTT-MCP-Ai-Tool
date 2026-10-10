import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type JSX } from 'react';

import { HandoutsDrawer } from '../panels/Handouts';
import { PartyDrawer } from '../panels/Party';
import { PreflightDrawer } from '../panels/Preflight';
import { PrepDrawer } from '../panels/Prep';
import { reply, toolOk } from '../storybook/fakeApi';
import { HANDOUTS, PLAYERS, SCENES } from '../storybook/fixtures/handouts';
import { PARTY_OF_EIGHT } from '../storybook/fixtures/party';
import { PREFLIGHT_OK, SWITCHES_READY } from '../storybook/fixtures/preflight';
import { PREP } from '../storybook/fixtures/prep';
import { PHONE_VIEW, VEIL } from '../storybook/modes';

import { DockContext } from './Drawer';
import { MomentTabs, MomentViews, useDocks, type DockName, type Moment } from './Moments';

const meta = {
  title: 'Components/Moments',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The three tabs on their own. */
function Tabs({ moment }: { moment: Moment | null }): JSX.Element {
  const [picked, setPicked] = useState(moment);
  return (
    <div style={{ padding: '1rem' }}>
      <MomentTabs moment={picked} onPick={setPicked} />
      {/* The views the tabs control (MomentViews on the real page), empty here. */}
      {(['before', 'during', 'after'] as const).map(m => (
        <div key={m} id={`moment-${m}`} role="tabpanel" aria-labelledby={`tab-${m}`} hidden />
      ))}
    </div>
  );
}

export const TabsBefore: Story = { render: (): JSX.Element => <Tabs moment="before" /> };
export const TabsDuring: Story = { render: (): JSX.Element => <Tabs moment="during" /> };
export const TabsAfter: Story = { render: (): JSX.Element => <Tabs moment="after" /> };
export const TabsUnknown: Story = {
  name: 'Tabs: moment not known yet',
  render: (): JSX.Element => <Tabs moment={null} />,
};

/**
 * The moment views with the panels docked in their slots, as the page shows them. The tabs work:
 * pick another moment and the panels move to its slots. A panel that does not dock in the moment
 * on screen stays closed here (in the app a button opens it over the page).
 */
function Page({ initial }: { initial: Moment | null }): JSX.Element {
  const [moment, pick] = useState(initial);
  const { slotRefs, dockOf } = useDocks(moment);
  const dock = (name: DockName, panel: (open: boolean) => JSX.Element): JSX.Element => (
    <DockContext.Provider value={dockOf(name)}>{panel(dockOf(name) !== null)}</DockContext.Provider>
  );
  const noop = (): void => undefined;
  return (
    <div className="story-app">
      <header className="topbar">
        <div className="brand">
          <h1>
            Foundry <span className="wordmark-ai">AI</span> Tool
          </h1>
        </div>
        <MomentTabs moment={moment} onPick={pick} />
      </header>
      <MomentViews moment={moment} slotRefs={slotRefs} />
      {dock('preflight', open => (
        <PreflightDrawer
          open={open}
          onOpenChange={noop}
          tarokkaShown={false}
          onHideTarokka={noop}
        />
      ))}
      {dock('prep', open => (
        <PrepDrawer open={open} onOpenChange={noop} onOpenPreflight={noop} />
      ))}
      {dock('party', open => (
        <PartyDrawer open={open} onOpenChange={noop} />
      ))}
      {dock('handouts', open => (
        <HandoutsDrawer open={open} onOpenChange={noop} onQueuePage={noop} />
      ))}
    </div>
  );
}

const bridge = {
  api: {
    routes: {
      '/api/preflight': reply(PREFLIGHT_OK),
      '/api/session/switches': reply(SWITCHES_READY),
      '/api/player/names': reply(PLAYERS),
    },
    tools: {
      'get-prep-digest': toolOk(PREP),
      'get-party': toolOk(PARTY_OF_EIGHT),
      'list-revealed-pages': toolOk(HANDOUTS),
      'list-scenes': toolOk(SCENES),
    },
  },
};

export const PageBefore: Story = {
  parameters: { dashboard: bridge },
  render: (): JSX.Element => <Page initial="before" />,
};
export const PageDuring: Story = {
  parameters: { dashboard: bridge },
  render: (): JSX.Element => <Page initial="during" />,
};
export const PageAfter: Story = {
  parameters: { dashboard: bridge },
  render: (): JSX.Element => <Page initial="after" />,
};
export const PageDuringVeil: Story = {
  tags: ['veil'],
  globals: VEIL,
  parameters: { dashboard: bridge },
  render: (): JSX.Element => <Page initial="during" />,
};
export const PageDuringPhone: Story = {
  tags: ['phone'],
  globals: PHONE_VIEW,
  parameters: { dashboard: bridge },
  render: (): JSX.Element => <Page initial="during" />,
};
export const PageChecking: Story = {
  name: 'Page: checking the play session',
  parameters: { dashboard: bridge },
  render: (): JSX.Element => <Page initial={null} />,
};
