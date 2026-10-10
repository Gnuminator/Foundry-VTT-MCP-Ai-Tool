import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';
import { fn } from 'storybook/test';

import { ApiError } from '../lib/api';
import { VEIL } from '../storybook/modes';

import { Button } from './Button';
import { EmptyState, ErrorState, LoadingState, Skeleton } from './states';

const meta = {
  title: 'UI/States',
  tags: ['autodocs'],
  decorators: [
    (Story): JSX.Element => (
      <div style={{ maxWidth: 480 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  render: () => <EmptyState>No handouts queued.</EmptyState>,
};

export const EmptyWithAction: Story = {
  render: () => (
    <EmptyState action={<Button size="sm">+ Queue a page</Button>}>No handouts queued. </EmptyState>
  ),
};

export const Loading: Story = { render: () => <LoadingState /> };
export const LoadingCustomText: Story = {
  render: () => <LoadingState>Asking Foundry for the party…</LoadingState>,
};
export const LoadingSkeleton: Story = { render: () => <LoadingState skeleton /> };
export const SkeletonLines: Story = {
  render: () => (
    <div className="empty">
      <Skeleton lines={5} />
    </div>
  ),
};

export const Failed: Story = {
  render: () => (
    <ErrorState error={new ApiError('HTTP 500', 500)} onRetry={fn()}>
      Couldn’t load the party
    </ErrorState>
  ),
};

export const BridgeDown: Story = {
  render: () => (
    <ErrorState kind="bridge-down" onRetry={fn()}>
      The Foundry bridge is not connected.
    </ErrorState>
  ),
};

export const Gated: Story = {
  render: () => (
    <ErrorState kind="gated">GM Actions are off. Turn them on in Pre-flight.</ErrorState>
  ),
};

export const LongMessage: Story = {
  render: () => (
    <ErrorState
      error={
        new Error('The bridge answered with something far longer than anyone expected: '.repeat(3))
      }
      onRetry={fn()}
    >
      Couldn’t load the handouts
    </ErrorState>
  ),
};

export const VeilTheme: Story = {
  tags: ['veil'],
  globals: VEIL,
  render: () => (
    <div style={{ display: 'grid', gap: 12 }}>
      <EmptyState>No handouts queued.</EmptyState>
      <LoadingState />
      <ErrorState error={new Error('HTTP 500')} onRetry={fn()}>
        Couldn’t load the party
      </ErrorState>
      <ErrorState kind="bridge-down">The Foundry bridge is not connected.</ErrorState>
    </div>
  ),
};
