// Svelte spike (never merged): the React control of the Party panel, open, in the two states the
// Svelte version shows too.
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import '../shared/party.css';
import { STORY_PARTY, type LoadParty } from '../shared/party';
import Party from './Party';

function Host({ load }: { load: LoadParty }): JSX.Element {
  const [client] = useState(() => new QueryClient());
  const [open, setOpen] = useState(true);
  return (
    <QueryClientProvider client={client}>
      <Party open={open} onOpenChange={setOpen} load={load} planPace={async () => {}} />
    </QueryClientProvider>
  );
}

const loaded: LoadParty = () => Promise.resolve(STORY_PARTY);
const failed: LoadParty = () => Promise.reject(new Error('The bridge answered with an error.'));

const meta = { title: 'Spike/Party React', parameters: { layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = { render: () => <Host load={loaded} /> };
export const Failed: Story = { render: () => <Host load={failed} /> };
