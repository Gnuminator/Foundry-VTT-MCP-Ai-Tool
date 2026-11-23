import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';

import { Opened } from '../storybook/Opened';
import { bridgeDown, toolOk } from '../storybook/fakeApi';
import { PHONE_VIEW } from '../storybook/modes';

import { ReadAloudDrawer } from './ReadAloud';

// The read-aloud shelf. Invented text; no book text.
const page = (pageName: string, from: 'scene' | 'note', blocks: string[]): unknown => ({
  journalName: 'Sample Book',
  pageName,
  from,
  blocks: blocks.map(text => ({ text })),
});

const meta = {
  title: 'Panels/ReadAloud',
  parameters: { layout: 'fullscreen' },
  render: (): JSX.Element => (
    <Opened>
      {(open, onOpenChange) => <ReadAloudDrawer open={open} onOpenChange={onOpenChange} />}
    </Opened>
  ),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const withAnswer = (answer: unknown): Record<string, unknown> => ({
  dashboard: { api: { tools: { 'get-read-aloud': toolOk(answer) } } },
});

export const WithBlocks: Story = {
  parameters: withAnswer({
    sceneName: 'The Old Hall',
    pagesWithoutBoxes: 0,
    pages: [
      page('Room 1', 'scene', [
        'A cold hall stretches ahead of you. Water drips somewhere in the dark.\n\nThe air smells of old stone.',
        'A door creaks open.',
      ]),
      page('Room 2', 'note', ['The room is bare except for a single chair.']),
    ],
  }),
};
export const NoBoxedText: Story = {
  parameters: withAnswer({ sceneName: 'The Old Hall', pagesWithoutBoxes: 2, pages: [] }),
};
export const NoLinkedPage: Story = {
  parameters: withAnswer({ sceneName: 'Empty Field', pagesWithoutBoxes: 0, pages: [] }),
};
export const CutOff: Story = {
  parameters: withAnswer({
    sceneName: 'The Old Hall',
    pagesWithoutBoxes: 0,
    linkedPages: 15,
    readPages: 12,
    pages: [page('Room 1', 'scene', ['A cold hall stretches ahead of you.'])],
  }),
};
export const BridgeDown: Story = {
  parameters: { dashboard: { api: { tools: { 'get-read-aloud': bridgeDown } } } },
};
export const Phone: Story = {
  tags: ['phone'],
  globals: PHONE_VIEW,
  parameters: withAnswer({
    sceneName: 'The Old Hall',
    pagesWithoutBoxes: 0,
    pages: [page('Room 1', 'scene', ['A cold hall stretches ahead of you.'])],
  }),
};
