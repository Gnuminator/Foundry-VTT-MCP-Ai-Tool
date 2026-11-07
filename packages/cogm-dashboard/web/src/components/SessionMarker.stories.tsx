import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { SETTINGS_KEY } from '../lib/stream';
import { PHONE_VIEW, VEIL } from '../storybook/modes';
import { fail, reply, toolOk, type Handler } from '../storybook/fakeApi';
import { PLAY_SESSION_CLOSED, PLAY_SESSION_OPEN } from '../storybook/fixtures/common';
import type { DashboardParameters } from '../storybook/withDashboard';

import { SessionMarker } from './SessionMarker';

// The play session marker in the header: the status, Start / End session, and the Obsidian link to
// the campaign Home note when the mirror is on. It writes only to the bridge vault's session log.
const meta = {
  title: 'Components/Session marker',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The header's controls, as the page lays them out. */
function Header(): JSX.Element {
  return (
    <div className="story-app">
      <header className="topbar">
        <div className="brand">
          <div>
            <h1>
              Foundry <span className="wordmark-ai">AI</span> Tool
            </h1>
            <p className="subtitle">Live AI dungeon master&apos;s assistant</p>
          </div>
        </div>
        <div className="controls">
          <SessionMarker />
        </div>
      </header>
    </div>
  );
}

const render = (): JSX.Element => <Header />;

/**
 * Holds a two-toast stack still for the screenshot. The first toast moves up when the second comes,
 * and its bottom edge lands on a fraction of a pixel: Chromium snapped it to either of two rows from
 * run to run (a 325 px diff on CI, however long the story waited). One fresh paint of the stack
 * always lands on the same row. The toasts' close timers are paused too (Radix pauses them while
 * the window is blurred), so a slow runner cannot lose a toast before the shot.
 */
async function settleToasts(): Promise<void> {
  window.dispatchEvent(new Event('blur'));
  const stack = document.querySelector<HTMLElement>('.toast-stack');
  if (stack) {
    const display = stack.style.display;
    stack.style.display = 'none';
    void stack.offsetHeight;
    stack.style.display = display;
  }
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

const seed = (
  session: Handler,
  extra: Partial<DashboardParameters> = {}
): { dashboard: DashboardParameters } => ({
  dashboard: {
    api: {
      tools: {
        'get-play-session': session,
        'mark-play-session': toolOk({ success: true }),
      },
    },
    ...extra,
  },
});

/** No session is open: the button starts one. */
export const NoSession: Story = {
  parameters: seed(toolOk(PLAY_SESSION_CLOSED)),
  render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('No session')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Start session' })).toBeEnabled();
  },
};

/** A session is open (no start time known): the button ends it. */
export const SessionOpen: Story = {
  parameters: seed(toolOk(PLAY_SESSION_OPEN)),
  render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('Session active')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'End session' })).toBeVisible();
  },
};

/** The bridge is down and no answer came yet: the status says so, the button still works. */
export const Unknown: Story = {
  parameters: seed(fail(502, 'The Foundry bridge is not connected.', { kind: 'channel' })),
  render,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText('Session: unknown')).toBeVisible();
  },
};

/** The Obsidian mirror is on: a link to the campaign Home note shows. */
export const WithObsidianLink: Story = {
  parameters: seed(toolOk(PLAY_SESSION_CLOSED), {
    cache: [[SETTINGS_KEY, { gmActionsEnabled: true, obsidian: { vault: 'Table Notes' } }]],
  }),
  render,
  play: async ({ canvasElement }) => {
    const link = await within(canvasElement).findByRole('link', {
      name: 'Open the campaign Home note in Obsidian',
    });
    await expect(link).toHaveAttribute('href', expect.stringContaining('obsidian://open?vault='));
  },
};

let sessionStarted = false;

/** Start session writes the marker and says so. */
export const StartsTheSession: Story = {
  // Once the marker is written, the session reads as open, as the real bridge answers.
  parameters: {
    dashboard: {
      api: {
        tools: {
          'get-play-session': () =>
            toolOk(sessionStarted ? PLAY_SESSION_OPEN : PLAY_SESSION_CLOSED),
          'mark-play-session': () => {
            sessionStarted = true;
            return toolOk({ success: true });
          },
        },
      },
    },
  },
  beforeEach: () => {
    sessionStarted = false;
  },
  render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Start session' }));
    await waitFor(() =>
      expect(within(document.body).getAllByText('✓ Play session started')).not.toHaveLength(0)
    );
    // The ready step answers right after the marker; the shot waits for its toast too.
    await waitFor(() =>
      expect(within(document.body).getAllByText('✓ Already on')).not.toHaveLength(0)
    );
    // The status follows the marker: it reads open, not "No session", in the shot.
    await expect(await canvas.findByText('Session active')).toBeVisible();
    await settleToasts();
  },
};

/** A session with its start time known: "Session since" and the time, in the viewer's locale. */
export const SessionSince: Story = {
  parameters: seed(
    toolOk({
      ...PLAY_SESSION_OPEN,
      startedAt: new Date(2026, 9, 8, 19, 30).toISOString(),
    })
  ),
  render,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText(/^Session since /)).toBeVisible();
  },
};

/** End session ends the log and turns off what Turn on for tonight turned on. */
export const EndsTheSession: Story = {
  parameters: {
    dashboard: {
      api: {
        tools: {
          'get-play-session': toolOk(PLAY_SESSION_OPEN),
          'mark-play-session': toolOk({ success: true }),
        },
        routes: {
          '/api/session/switches': reply({
            ok: true,
            switches: null,
            gmActionsEnabled: false,
            gmActionsChanged: true,
          }),
        },
      },
    },
  },
  render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'End session' }));
    await waitFor(() =>
      expect(within(document.body).getAllByText('✓ Play session ended')).not.toHaveLength(0)
    );
    await waitFor(() =>
      expect(within(document.body).getAllByText('✓ Turned off again: GM Actions')).not.toHaveLength(
        0
      )
    );
    await settleToasts();
  },
};

/** The bridge refuses the mark: the toast says why and the status stays. */
export const MarkFails: Story = {
  parameters: {
    dashboard: {
      api: {
        tools: {
          'get-play-session': toolOk(PLAY_SESSION_CLOSED),
          'mark-play-session': fail(502, 'The Foundry bridge is not connected.', {
            kind: 'channel',
          }),
        },
      },
    },
  },
  render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Start session' }));
    await waitFor(() =>
      expect(within(document.body).getAllByText(/^✗ Play session: /)).not.toHaveLength(0)
    );
    await expect(canvas.getByText('No session')).toBeVisible();
  },
};

/** The same header in The Veil theme on a phone. */
export const VeilOnAPhone: Story = {
  tags: ['veil', 'phone'],
  globals: { ...VEIL, ...PHONE_VIEW },
  parameters: seed(toolOk(PLAY_SESSION_OPEN)),
  render,
};
