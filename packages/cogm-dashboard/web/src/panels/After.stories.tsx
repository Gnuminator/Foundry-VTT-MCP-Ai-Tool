import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';

import { bridgeDown, fail, pending, reply, toolOk, type Reply } from '../storybook/fakeApi';
import {
  NOTES_APPROVED,
  NOTES_IN_FOUNDRY,
  NOTES_PAGES,
  NOTES_REVEALED,
  NOTES_STAGED_WAITING,
  NOTES_UNDONE,
  NO_PLAY_STATS,
  PLAY_STATS,
  PLAY_STATS_QUIET,
} from '../storybook/fixtures/after';
import { PHONE_VIEW, VEIL } from '../storybook/modes';

import AfterTop from './After';

// The After view's top: tonight's stats and the session notes. Both load from the bridge when After
// is on screen (`active`).
const dashboard = (
  stats: Reply,
  notes: Reply
): { dashboard: { api: { routes: Record<string, Reply>; tools: Record<string, Reply> } } } => ({
  dashboard: {
    api: {
      routes: {
        '/api/session-notes': notes,
        '/api/session-notes/*': reply(NOTES_PAGES),
      },
      tools: { 'get-play-stats': stats },
    },
  },
});

const notes = (item: unknown): Reply => reply({ items: [item] });

const meta = {
  title: 'Panels/After',
  parameters: { layout: 'fullscreen', ...dashboard(toolOk(PLAY_STATS), notes(NOTES_IN_FOUNDRY)) },
  render: (): JSX.Element => <AfterTop active onOpenPaperSync={() => undefined} />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const NotesInFoundry: Story = {};
export const NotesWaiting: Story = {
  parameters: dashboard(toolOk(PLAY_STATS), notes(NOTES_STAGED_WAITING)),
};
export const RecapRevealed: Story = {
  parameters: dashboard(toolOk(PLAY_STATS), notes(NOTES_REVEALED)),
};
export const Approved: Story = {
  parameters: dashboard(toolOk(PLAY_STATS), notes(NOTES_APPROVED)),
};
export const UndoneWithError: Story = {
  parameters: dashboard(toolOk(PLAY_STATS), notes(NOTES_UNDONE)),
};
export const QuietNight: Story = {
  parameters: dashboard(toolOk(PLAY_STATS_QUIET), reply({ items: [] })),
};
export const NoSessionYet: Story = {
  parameters: dashboard(toolOk(NO_PLAY_STATS), reply({ items: [] })),
};
export const Loading: Story = { parameters: dashboard(pending, pending) };
export const StatsFailed: Story = {
  parameters: dashboard(fail(500, 'The bridge answered with an error.'), reply({ items: [] })),
};
export const BridgeDown: Story = { parameters: dashboard(bridgeDown, reply({ items: [] })) };
export const Veil: Story = {
  tags: ['veil'],
  globals: VEIL,
  parameters: dashboard(toolOk(PLAY_STATS), notes(NOTES_IN_FOUNDRY)),
};
export const Phone: Story = {
  tags: ['phone'],
  globals: PHONE_VIEW,
  parameters: dashboard(toolOk(PLAY_STATS), notes(NOTES_STAGED_WAITING)),
};
