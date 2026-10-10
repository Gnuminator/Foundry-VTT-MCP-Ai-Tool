import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type JSX } from 'react';

import { Opened } from '../storybook/Opened';
import { PHONE_VIEW, VEIL } from '../storybook/modes';
import { Button, EmptyState } from '../ui';

import { DockContext, Drawer, DrawerClose } from './Drawer';

// A drawer is a non-modal Radix dialog fixed to the right edge of the window. `Opened` holds the
// open state and puts a "Reopen" button on the page once the ✕ or Escape closes it.
const meta = {
  title: 'Components/Drawer',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const body = (
  <>
    <p>The drawer's body scrolls on its own; the head and the bar under it stay put.</p>
    <p className="empty">Rows, forms and lists of the panel go here.</p>
  </>
);

interface Shape {
  title?: string;
  sub?: string;
  state?: 'ready' | 'loading' | 'empty' | 'error' | 'bridge-down' | 'gated';
  stateMessage?: string;
  withBar?: boolean;
  id?: string;
}

function Demo({
  title = 'Handouts',
  sub,
  state,
  stateMessage,
  withBar,
  id = 'story-drawer',
}: Shape): JSX.Element {
  return (
    <Opened>
      {(open, onOpenChange) => (
        <Drawer
          open={open}
          onOpenChange={onOpenChange}
          id={id}
          title={title}
          {...(sub !== undefined ? { sub } : {})}
          help="dashboard#handouts"
          close={<DrawerClose />}
          {...(state !== undefined ? { state } : {})}
          {...(stateMessage !== undefined ? { stateMessage } : {})}
          {...(withBar
            ? {
                actions: (
                  <>
                    <Button size="sm">Refresh</Button> <Button size="sm">+ Queue a page</Button>
                  </>
                ),
              }
            : {})}
        >
          {body}
        </Drawer>
      )}
    </Opened>
  );
}

export const Open: Story = {
  render: () => <Demo sub="What the players have seen." withBar />,
};

export const Loading: Story = { render: () => <Demo state="loading" /> };
export const Empty: Story = {
  render: () => <Demo state="empty" stateMessage="Nothing queued yet." />,
};
export const Failed: Story = {
  render: () => <Demo state="error" stateMessage="Couldn’t load the handouts: HTTP 500" />,
};
export const BridgeDown: Story = { render: () => <Demo state="bridge-down" /> };
export const Gated: Story = { render: () => <Demo state="gated" /> };

export const LongTitle: Story = {
  render: () => (
    <Demo
      title="A drawer title that is long enough to need a second line in the head"
      sub="And a line under it that is also too long to sit on one line of the head, for emphasis."
      withBar
    />
  ),
};

/** Two drawers open: the one opened last is on top, as in the app. */
export const TwoOpen: Story = {
  render: () => (
    <>
      <Demo title="Party" id="story-drawer-a" />
      <Opened>
        {(open, onOpenChange) => (
          <Drawer
            open={open}
            onOpenChange={onOpenChange}
            id="story-drawer-b"
            title="Pre-flight"
            close={<DrawerClose />}
          >
            <EmptyState>The second drawer covers the first.</EmptyState>
          </Drawer>
        )}
      </Opened>
    </>
  ),
};

/** Docked: in a moment view the drawer sits in the page, with no close button. */
function Docked(): JSX.Element {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <div style={{ padding: '1rem', maxWidth: 560 }}>
      <div ref={setSlot} />
      <DockContext.Provider value={slot}>
        <Drawer
          open
          onOpenChange={() => undefined}
          id="story-docked"
          title="Prep"
          sub="Docked in the page."
          close={<DrawerClose />}
        >
          {body}
        </Drawer>
      </DockContext.Provider>
    </div>
  );
}

export const DockedInThePage: Story = { render: () => <Docked /> };

export const VeilTheme: Story = {
  tags: ['veil'],
  globals: VEIL,
  render: () => <Demo sub="What the players have seen." withBar />,
};

export const Phone: Story = {
  tags: ['phone'],
  globals: PHONE_VIEW,
  render: () => <Demo sub="What the players have seen." withBar />,
};
