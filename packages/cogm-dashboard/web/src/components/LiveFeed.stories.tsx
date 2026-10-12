import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import type { FeedLog } from '../lib/feed';
import { BRIDGE_STATUS_KEY, FEED_KEY } from '../lib/stream';
import { BRIDGE_AWAY, BRIDGE_UP } from '../storybook/fixtures/combat';
import {
  FEED_CAPPED,
  FEED_FEW,
  FEED_KINDS,
  FEED_LONG,
  FEED_NONE,
} from '../storybook/fixtures/feed';
import { PHONE_VIEW, VEIL } from '../storybook/modes';
import type { DashboardParameters } from '../storybook/withDashboard';

import { useDuringFolds } from './Folds';
import { LiveFeed } from './LiveFeed';

// The Live Feed: the session events in the During view's feed slot, newest first. What the stream
// would have put in the cache (the events, the bridge link) is seeded with `cache`; a story with
// no events entry is the pane before the stream has answered.
const meta = {
  title: 'Components/Live feed',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

interface Setup {
  /** The events the stream brought; omitted for none yet (loading). */
  log?: FeedLog;
  /** The bridge is away (the events on screen may be old). */
  away?: boolean;
}

/** `parameters.dashboard` for a story. */
function seed({ log, away = false }: Setup): { dashboard: DashboardParameters } {
  return {
    dashboard: {
      cache: [
        [BRIDGE_STATUS_KEY, away ? BRIDGE_AWAY : BRIDGE_UP],
        ...(log ? [[FEED_KEY, log] as const] : []),
      ],
    },
  };
}

/** The card in the During view's feed slot, as the page lays it out, as a fold card. */
function Host(): JSX.Element {
  const folds = useDuringFolds({ layout: 'layered', context: 'calm' });
  return (
    <div className="story-app">
      <section className="moment" id="moment-during" data-layout="layered" data-context="calm">
        <div className="slot slot-feed" data-slot="feed">
          <LiveFeed folds={folds} />
        </div>
      </section>
    </div>
  );
}

/** The card on its own, not a fold card (on a phone a fold card starts folded: components/Folds). */
function Plain(): JSX.Element {
  return (
    <div className="story-app" style={{ height: '28rem', padding: '1rem' }}>
      <LiveFeed />
    </div>
  );
}

const render = (): JSX.Element => <Host />;
const plain = (): JSX.Element => <Plain />;

// --- The faces ---------------------------------------------------------------------------------

/** Before the stream has said anything. */
export const Loading: Story = { parameters: seed({}), render };

/** The stream answered and there is nothing yet. */
export const Empty: Story = { parameters: seed({ log: FEED_NONE }), render };

export const FewEvents: Story = { parameters: seed({ log: FEED_FEW }), render };

/** Every kind the module logs, each with its own colour on the rail and the chip. */
export const EveryKind: Story = { parameters: seed({ log: FEED_KINDS }), render };

export const LongLines: Story = { parameters: seed({ log: FEED_LONG }), render };

/** 130 events came in; the newest 120 are on screen, the count says 130. */
export const ManyAtTheCap: Story = {
  name: 'Many events, at the cap',
  parameters: seed({ log: FEED_CAPPED }),
  render,
};

/** Not a fold card: a plain pane, as in any other place the feed may go. */
export const NotAFoldCard: Story = {
  name: 'Not a fold card',
  parameters: seed({ log: FEED_FEW }),
  render: plain,
};

// --- The bridge is away ------------------------------------------------------------------------

/** The events stay, marked: they may not be the latest. */
export const BridgeAway: Story = {
  name: 'The bridge is away',
  parameters: seed({ log: FEED_FEW, away: true }),
  render,
};

export const BridgeAwayNothingYet: Story = {
  name: 'The bridge is away, no events yet',
  parameters: seed({ log: FEED_NONE, away: true }),
  render,
};

export const BridgeAwayLoading: Story = {
  name: 'The bridge is away, stream not answered',
  parameters: seed({ away: true }),
  render,
};

// --- Folded ------------------------------------------------------------------------------------

/** Folded with its button: only the head shows, and the button says how to open it. */
export const Folded: Story = {
  parameters: seed({ log: FEED_FEW }),
  render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Fold Live Feed' }));
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Open Live Feed' })).toBeVisible()
    );
  },
};

// --- Veil and phone ----------------------------------------------------------------------------

export const EveryKindVeil: Story = {
  name: 'Every kind (Veil)',
  tags: ['veil'],
  globals: VEIL,
  parameters: seed({ log: FEED_KINDS }),
  render,
};

export const BridgeAwayVeil: Story = {
  name: 'The bridge is away (Veil)',
  tags: ['veil'],
  globals: VEIL,
  parameters: seed({ log: FEED_FEW, away: true }),
  render,
};

export const EmptyVeil: Story = {
  name: 'Empty (Veil)',
  tags: ['veil'],
  globals: VEIL,
  parameters: seed({ log: FEED_NONE }),
  render,
};

export const FewEventsPhone: Story = {
  name: 'A few events (phone)',
  tags: ['phone'],
  globals: PHONE_VIEW,
  parameters: seed({ log: FEED_FEW }),
  render: plain,
};

export const LongLinesPhone: Story = {
  name: 'Long lines (phone)',
  tags: ['phone'],
  globals: PHONE_VIEW,
  parameters: seed({ log: FEED_LONG }),
  render: plain,
};

export const BridgeAwayPhone: Story = {
  name: 'The bridge is away (phone)',
  tags: ['phone'],
  globals: PHONE_VIEW,
  parameters: seed({ log: FEED_FEW, away: true }),
  render: plain,
};
