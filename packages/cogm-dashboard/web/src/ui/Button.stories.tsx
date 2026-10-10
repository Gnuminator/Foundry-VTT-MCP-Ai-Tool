import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { VEIL } from '../storybook/modes';

import { Button, IconButton } from './Button';

const meta = {
  title: 'UI/Button',
  component: Button,
  tags: ['autodocs'],
  args: { children: 'Refresh', onClick: fn() },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Primary: Story = { args: { variant: 'primary', children: 'Make link' } };
export const Quiet: Story = { args: { variant: 'quiet', children: 'Hide cards' } };
export const Danger: Story = { args: { variant: 'danger', children: 'Remove link' } };
export const Small: Story = { args: { size: 'sm', children: 'Copy link' } };
export const Disabled: Story = { args: { disabled: true, children: 'Reveal next' } };

/** Every variant in both sizes, enabled and disabled: the matrix a design change must keep intact. */
export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 12 }}>
      {(['default', 'primary', 'quiet', 'danger'] as const).map(variant => (
        <div key={variant} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button variant={variant}>{variant}</Button>
          <Button variant={variant} size="sm">
            {variant} small
          </Button>
          <Button variant={variant} disabled>
            {variant} disabled
          </Button>
        </div>
      ))}
    </div>
  ),
};

export const VeilTheme: Story = { ...AllVariants, tags: ['veil'], globals: VEIL };

export const Icon: StoryObj<typeof IconButton> = {
  render: () => (
    <IconButton label="Close player links" tip="Close" onClick={fn()}>
      ✕
    </IconButton>
  ),
};
