// Svelte spike (never merged): the Svelte Party panel in the dashboard's React Storybook, mounted
// with Svelte's own mount() so the story shots and the axe check see it like any other story.
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useRef, type JSX } from 'react';
import { mount, unmount } from 'svelte';

import '../shared/party.css';
import { STORY_PARTY, type LoadParty } from '../shared/party';
import StoryHost from './StoryHost.svelte';

function Host({ load }: { load: LoadParty }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const app = mount(StoryHost, { target: ref.current!, props: { load } });
    return (): void => void unmount(app);
  }, [load]);
  return <div ref={ref} />;
}

const loaded: LoadParty = () => Promise.resolve(STORY_PARTY);
const failed: LoadParty = () => Promise.reject(new Error('The bridge answered with an error.'));

const meta = { title: 'Spike/Party Svelte', parameters: { layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = { render: () => <Host load={loaded} /> };
export const Failed: Story = { render: () => <Host load={failed} /> };
