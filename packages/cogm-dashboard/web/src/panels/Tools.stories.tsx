import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { SETTINGS_KEY } from '../lib/stream';
import { Opened } from '../storybook/Opened';
import {
  bridgeDown,
  fail,
  pending,
  reply,
  toolOk,
  type FakeApi,
  type Reply,
} from '../storybook/fakeApi';
import { TOKEN_CHOICES, TOOLS_REPLY } from '../storybook/fixtures/tools';
import { PHONE_VIEW, VEIL } from '../storybook/modes';

import { ToolsDrawer, type ToolRequest } from './Tools';

// The Tool runner: every bridge tool in a list, a form for the one picked, and the answer under
// it. The catalog is /api/tools; the tools' own answers come from the fake bridge.
const api = (catalog: Reply, extra: FakeApi['tools'] = {}): { dashboard: { api: FakeApi } } => ({
  dashboard: {
    api: {
      routes: { '/api/tools': catalog },
      tools: {
        'list-ref-choices': toolOk(TOKEN_CHOICES),
        'get-world-info': toolOk({
          world: 'harbor-test',
          system: 'dnd5e',
          modules: ['fog-helper'],
        }),
        ...extra,
      },
    },
  },
});

const drawer = (request: ToolRequest | null = null): JSX.Element => (
  <Opened>
    {(open, onOpenChange) => (
      <ToolsDrawer open={open} onOpenChange={onOpenChange} request={request} />
    )}
  </Opened>
);

const meta = {
  title: 'Panels/Tools',
  parameters: { layout: 'fullscreen', ...api(reply(TOOLS_REPLY)) },
  render: (): JSX.Element => drawer(),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const damage: ToolRequest = {
  name: 'plan-actor-change',
  prefill: { action: 'damage', amount: 4 },
  seq: 1,
};

/**
 * After a click on Run: waits until the button is enabled again (a run disables it while it
 * waits) and takes the focus off it, so the story ends in one state whatever the timing.
 */
const settle = async (): Promise<void> => {
  await waitFor(() => expect(document.getElementById('tool-run')).toBeEnabled());
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
};

export const ToolList: Story = {};

/** Another panel opens the runner on a tool with its form filled in. */
export const FormPrefilled: Story = { render: () => drawer(damage) };

export const FormWithPickerOpen: Story = {
  render: () => drawer(damage),
  play: async () => {
    const pick = await waitFor(() => {
      const button = document.getElementById('tool-field-targets-pick');
      if (!button) throw new Error('button is not on the page yet');
      return button;
    });
    await userEvent.click(pick);
    await waitFor(() => expect(within(document.body).getByText('Brenna')).toBeVisible());
  },
};

export const ReadResult: Story = {
  play: async () => {
    const body = within(document.body);
    await userEvent.click(await body.findByText('get-world-info'));
    await userEvent.click(
      await waitFor(() => {
        const run = document.getElementById('tool-run');
        if (!run) throw new Error('run is not on the page yet');
        return run;
      })
    );
    await waitFor(() => expect(body.getAllByText(/fog-helper/).length).toBeGreaterThan(0));
    await settle();
  },
};

export const MissingRequiredField: Story = {
  render: () => drawer({ name: 'create-quest-journal', prefill: {}, seq: 1 }),
  play: async () => {
    const run = await waitFor(() => {
      const button = document.getElementById('tool-run');
      if (!button) throw new Error('button is not on the page yet');
      return button;
    });
    await userEvent.click(run);
    await settle();
  },
};

export const GMActionsOff: Story = {
  parameters: {
    dashboard: {
      api: api(reply({ ...TOOLS_REPLY, gmActionsEnabled: false })).dashboard.api,
      cache: [[SETTINGS_KEY, { gmActionsEnabled: false }]],
    },
  },
};

export const Loading: Story = { parameters: api(pending) };
export const Failed: Story = {
  parameters: api(fail(500, 'The dashboard could not list the tools.')),
};
export const BridgeDown: Story = { parameters: api(bridgeDown) };
export const EmptyCatalog: Story = {
  parameters: api(reply({ tools: [], gmActionsEnabled: true })),
};
export const Veil: Story = { tags: ['veil'], globals: VEIL, render: () => drawer(damage) };
export const Phone: Story = { tags: ['phone'], globals: PHONE_VIEW, render: () => drawer(damage) };
