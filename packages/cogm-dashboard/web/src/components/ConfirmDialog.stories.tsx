import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState, type JSX } from 'react';

import { PHONE_VIEW, VEIL } from '../storybook/modes';
import { Button } from '../ui';

import { useConfirm, type ConfirmRequest } from './ConfirmDialog';

// The confirm window comes from the ConfirmProvider the preview wraps every story in. This page
// asks it on load (as a panel does when a change needs a yes) and shows what the person answered.
function Ask({ request }: { request: ConfirmRequest }): JSX.Element {
  const confirm = useConfirm();
  const [answer, setAnswer] = useState('not asked yet');
  const ask = (): void => {
    setAnswer('waiting');
    void confirm(request).then(ok => setAnswer(ok ? 'confirmed' : 'cancelled'));
  };
  useEffect(ask, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, on load
  return (
    <p>
      Last answer: {answer} <Button onClick={ask}>Ask again</Button>
    </p>
  );
}

const meta = {
  title: 'Components/ConfirmDialog',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const plan: ConfirmRequest = {
  summary: 'Damage Aldric and Old Gull',
  diff: ['Aldric: HP 14 → 9', 'Old Gull: HP 3 → 0 (defeated)'],
  destructive: false,
};

export const Plain: Story = { render: () => <Ask request={plan} /> };

export const Destructive: Story = {
  render: () => (
    <Ask
      request={{
        summary: 'Delete the journal page "Smuggler code"',
        diff: ['JournalEntryPage p7: deleted', 'Handout queue: 1 entry removed'],
        destructive: true,
      }}
    />
  ),
};

export const NoLines: Story = {
  render: () => <Ask request={{ diff: [], destructive: false }} />,
};

export const ManyLongLines: Story = {
  render: () => (
    <Ask
      request={{
        summary: 'Move eight tokens a very long way across the harbor map',
        diff: Array.from(
          { length: 14 },
          (_, i) =>
            `Token ${i + 1} (a character with a long name, Thornwood-Brightwater): x 1200 → 3400, y 800 → 2600`
        ),
        destructive: false,
      }}
    />
  ),
};

export const VeilTheme: Story = { tags: ['veil'], globals: VEIL, render: Destructive.render! };
export const Phone: Story = { tags: ['phone'], globals: PHONE_VIEW, render: Destructive.render! };
