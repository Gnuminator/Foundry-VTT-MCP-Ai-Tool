import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { SETTINGS_KEY } from '../lib/stream';
import { reply, toolOk, type FakeApi } from '../storybook/fakeApi';
import type { DashboardParameters } from '../storybook/withDashboard';

import { SceneMoodPanel } from './SceneMoodPanel';

// The Scene mood panel of the During bar: one button per mood preset saved on the viewed scene.
// A click plans the preset, asks once, then applies it with Undo in the toast. The presets and the
// module's switches are answered by the fake bridge; the names here are made up.
const meta = {
  title: 'Components/Scene mood panel',
  parameters: { layout: 'padded' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const MOODS = {
  sceneId: 's1',
  sceneName: 'Village square',
  presets: [
    { name: 'Storm', darkness: 0.8, weather: 'rain', playlist: 'Thunder' },
    { name: 'Calm morning', darkness: 0.1, globalLight: true, weather: 'none' },
    { name: 'Fog', darkness: 0.5, weather: 'fog' },
  ],
  current: { darkness: 0.2, globalLight: false, weather: '' },
  playlists: [{ name: 'Thunder', sounds: 3, playing: false }],
};

const feature = (enabled: boolean): unknown => ({
  features: [{ id: 'scene-mood', name: 'AI Tool: Scene mood and music (writes)', enabled }],
  writesAllowed: true,
  error: null,
});

function seed({
  moods = MOODS,
  enabled = true,
  gmActions = true,
}: { moods?: unknown; enabled?: boolean; gmActions?: boolean } = {}): {
  dashboard: DashboardParameters;
} {
  const api: FakeApi = {
    routes: { '/api/features': reply(feature(enabled)) },
    tools: {
      'list-scene-moods': toolOk(moods),
      'plan-scene-mood': toolOk({
        planId: 'plan-1',
        risk: 'write',
        summary: 'Apply mood "Storm" on "Village square": darkness 0.8, weather rain',
      }),
      'apply-planned-change': toolOk({ changeId: 'c1', summary: 'Apply mood "Storm"' }),
    },
  };
  return { dashboard: { cache: [[SETTINGS_KEY, { gmActionsEnabled: gmActions }]], api } };
}

const render = (): JSX.Element => <SceneMoodPanel onClose={() => undefined} />;

/** The presets, sorted by name, each saying on hover what it sets. */
export const Presets: Story = {
  parameters: seed(),
  render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const storm = await canvas.findByRole('button', { name: 'Storm' });
    await expect(storm).toHaveAttribute('title', 'darkness 0.8, weather rain, music Thunder');
    await expect(storm).not.toHaveAttribute('aria-disabled');
  },
};

/** A click asks once with the plan's own summary before anything changes. */
export const Confirming: Story = {
  parameters: seed(),
  render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Storm' }));
    const page = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(page.getByRole('button', { name: 'Apply mood' })).toBeVisible());
  },
};

/** The module's switch is off: the buttons stay, disabled, and say where to turn it on. */
export const SwitchOff: Story = {
  parameters: seed({ enabled: false }),
  render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Storm' })).toHaveAttribute(
        'title',
        'Scene mood and music is off'
      )
    );
    await expect(canvas.getByRole('button', { name: 'Storm' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
  },
};

/** GM Actions are off: disabled with the reason and the Turn on button. */
export const GmActionsOff: Story = {
  parameters: seed({ gmActions: false }),
  render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('button', { name: 'Turn on' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Storm' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
  },
};

/** No presets saved on the scene yet. */
export const NoPresets: Story = { parameters: seed({ moods: { ...MOODS, presets: [] } }), render };
