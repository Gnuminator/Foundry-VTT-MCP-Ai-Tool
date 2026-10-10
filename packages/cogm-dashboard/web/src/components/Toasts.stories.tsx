import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { useEffect, type JSX } from 'react';

import { PHONE_VIEW, VEIL } from '../storybook/modes';
import { Button } from '../ui';

import { useToast } from './Toasts';

// The stack comes from the ToastProvider the preview wraps every story in. Toasts show on load, so
// the story (and its screenshot) has something to look at; the buttons show them again.
function Toasts({ undo = false }: { undo?: boolean }): JSX.Element {
  const toast = useToast();
  const show = (): void => {
    toast('✓ Moved the token', 'ok');
    toast('GM Actions are off. Turn them on in Pre-flight.', 'warn');
    toast('✗ Couldn’t reach the bridge: timed out', 'err');
    if (undo) toast('✓ Aldric: HP 14 → 9', 'ok', { label: 'Undo', onClick: fn() });
  };
  useEffect(show, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, on load
  return <Button onClick={show}>Show the toasts again</Button>;
}

const meta = {
  title: 'Components/Toasts',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Kinds: Story = { render: () => <Toasts /> };
export const WithUndo: Story = { render: () => <Toasts undo /> };
export const VeilTheme: Story = { tags: ['veil'], globals: VEIL, render: () => <Toasts undo /> };
export const Phone: Story = { tags: ['phone'], globals: PHONE_VIEW, render: () => <Toasts undo /> };
