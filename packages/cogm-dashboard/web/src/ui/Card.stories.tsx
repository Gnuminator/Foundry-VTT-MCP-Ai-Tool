import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';

import { VEIL } from '../storybook/modes';

import { Card, Pill, Section, Stat } from './Card';

const meta = {
  title: 'UI/Card',
  component: Card,
  tags: ['autodocs'],
  decorators: [
    (Story): JSX.Element => (
      <div style={{ maxWidth: 480 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  args: {
    title: 'Last session',
    aside: 'session 3',
    children: <p>3 h 5 min, one combat, four rounds.</p>,
  },
};

export const WithoutHeading: Story = { args: { children: <p>A card with only its body.</p> } };

export const LongHeading: Story = {
  args: {
    title: 'An open thread whose name is far too long to fit beside its aside on one line',
    aside: 'in progress',
    children: <p>The heading wraps and the aside stays at the right.</p>,
  },
};

export const SectionStory: StoryObj<typeof Section> = {
  name: 'Section',
  render: () => (
    <Section title="Open quests">
      <p>Find the missing ferry</p>
    </Section>
  ),
};

export const StatStory: StoryObj<typeof Stat> = {
  name: 'Stat',
  render: () => (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <Stat label="Combats" value={1} hint="4 rounds" />
      <Stat label="Went down" value="Brenna" name hint="once" />
      <Stat label="Spells cast" value={5} />
    </div>
  ),
};

export const PillStory: StoryObj<typeof Pill> = {
  name: 'Pill',
  render: () => (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Pill>plain</Pill>
      <Pill tone="on">on</Pill>
      <Pill tone="off">off</Pill>
      <Pill variant="condition">Poisoned</Pill>
      <Pill variant="condition">Frightened</Pill>
    </div>
  ),
};

export const EverythingInVeil: Story = {
  tags: ['veil'],
  globals: VEIL,
  args: {
    title: 'Last session',
    aside: 'session 3',
    children: (
      <>
        <div style={{ display: 'flex', gap: 12 }}>
          <Stat label="Combats" value={1} hint="4 rounds" />
          <Stat label="Went down" value="Brenna" name />
        </div>
        <Pill tone="on">on</Pill> <Pill tone="off">off</Pill>{' '}
        <Pill variant="condition">Poisoned</Pill>
      </>
    ),
  },
};
