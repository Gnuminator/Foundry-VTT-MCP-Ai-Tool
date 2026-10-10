import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';
import { fn } from 'storybook/test';

import { ApiError } from '../lib/api';
import { VEIL } from '../storybook/modes';

import { QueryState, type QueryLike } from './QueryState';

// QueryState turns a TanStack Query result into the right block. These stories hand it the result
// objects directly (it only reads isPending, isError, error and data), one per face.
const names = ['Aldric', 'Brenna', 'Cormac'];

const result = (over: Partial<QueryLike<string[]>>): QueryLike<string[]> => ({
  isPending: false,
  isError: false,
  error: null,
  data: undefined,
  ...over,
});

const meta = {
  title: 'UI/QueryState',
  component: QueryState<string[]>,
  tags: ['autodocs'],
  args: {
    errorLabel: 'Couldn’t load the party',
    empty: 'No party yet.',
    isEmpty: (rows: string[]): boolean => rows.length === 0,
    children: (rows): JSX.Element => (
      <ul>
        {rows.map(n => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    ),
    query: result({ data: names }),
  },
  decorators: [
    (Story): JSX.Element => (
      <div style={{ maxWidth: 480 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof QueryState<string[]>>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};
export const Loading: Story = { args: { query: result({ isPending: true }) } };
export const Empty: Story = { args: { query: result({ data: [] }) } };
export const Failed: Story = {
  args: {
    query: result({ isError: true, error: new ApiError('The bridge sent no party.', 500) }),
    onRetry: fn(),
  },
};
export const BridgeDown: Story = {
  args: {
    query: result({ isError: true, error: new ApiError('Not connected', 502, 'channel') }),
    detect: true,
    onRetry: fn(),
  },
};
export const Gated: Story = {
  args: {
    query: result({
      isError: true,
      error: new ApiError('GM Actions are off.', 403, undefined, 'gm-actions-disabled'),
    }),
    detect: true,
  },
};
export const KeepsOldData: Story = {
  args: {
    query: result({ isError: true, error: new Error('The refresh failed'), data: names }),
    keepData: true,
  },
};
export const VeilTheme: Story = {
  tags: ['veil'],
  globals: VEIL,
  args: { query: result({ isPending: true }) },
};
