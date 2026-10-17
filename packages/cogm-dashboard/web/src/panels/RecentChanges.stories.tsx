import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type JSX } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { DockContext } from '../components/Drawer';
import {
  bridgeDown,
  fail,
  pending,
  reply,
  toolOk,
  type FakeRequest,
  type Reply,
} from '../storybook/fakeApi';
import {
  AI_CHANGES,
  AI_CHANGES_EMPTY,
  AI_CHANGES_LONG,
  EVERYONE_CHANGES,
  EVERYONE_CHANGES_EMPTY,
  EVERYONE_CHANGES_NOTE,
  PLAN_EVERYTHING_SINCE,
  PLAN_JUST_THIS,
  PLAN_REWIND,
  PLAN_WITH_LATER,
  TOOLS_AI_ONLY,
  TOOLS_WITH_EVERYONE,
} from '../storybook/fixtures/changes';
import { PHONE_VIEW, VEIL } from '../storybook/modes';

import RecentChangesPane from './RecentChanges';

// Recent Changes: the AI's guarded changes and, when the bridge has list-changes, everyone's, each
// with Undo. The card docks in a view slot, as in During and After; the stories give it one. The
// play steps do what a GM does: open the Everyone tab, press Undo, walk the undo window.

/** The slot the card docks in (the During view's changes slot, alone). */
function Docked(): JSX.Element {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <div className="story-app" style={{ padding: '1rem', maxWidth: '34rem' }}>
      <div className="slot slot-changes" data-slot="changes" ref={setSlot} />
      <DockContext.Provider value={slot}>
        <RecentChangesPane />
      </DockContext.Provider>
    </div>
  );
}

interface Answers {
  catalog?: unknown;
  ai?: Reply;
  everyone?: Reply;
  plan?: Reply | ((request: FakeRequest) => Reply);
}

/** `parameters.dashboard.api` for a story: what the bridge answers. */
function bridge(a: Answers): {
  dashboard: { api: { routes: Record<string, Reply>; tools: Record<string, unknown> } };
} {
  return {
    dashboard: {
      api: {
        routes: { '/api/tools': reply(a.catalog ?? TOOLS_WITH_EVERYONE) },
        tools: {
          'list-recent-changes': a.ai ?? toolOk(AI_CHANGES),
          'list-changes': a.everyone ?? toolOk(EVERYONE_CHANGES),
          'plan-undo-changes': a.plan ?? toolOk(PLAN_JUST_THIS),
          'apply-planned-change': toolOk({ changeId: 'chg-new', summary: 'Undo: sample' }),
          'undo-change': toolOk({ summary: 'Undid: sample' }),
        },
      },
    },
  };
}

const meta = {
  title: 'Panels/Recent Changes',
  parameters: { layout: 'fullscreen', ...bridge({}) },
  render: (): JSX.Element => <Docked />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The queries over the page: the windows (confirm, undo) render outside the story's canvas. */
const screen = within(document.body);
const body = (): typeof screen => screen;

async function openEveryone(): Promise<void> {
  await userEvent.click(await body().findByRole('button', { name: 'Everyone' }));
  await body().findByText('Brenna changed her Hit Points');
}

/** The plan depends on the scope the window asks for. */
const planByScope = (request: FakeRequest): Reply => {
  const args = request.tool?.args ?? {};
  if (args['rewindTable'] === true) return toolOk(PLAN_REWIND);
  if (args['scope'] === 'everything-since') return toolOk(PLAN_EVERYTHING_SINCE);
  return toolOk(PLAN_WITH_LATER);
};

export const AiChanges: Story = {};
export const AiEmpty: Story = { parameters: bridge({ ai: toolOk(AI_CHANGES_EMPTY) }) };
export const AiLoading: Story = { parameters: bridge({ ai: pending }) };
export const AiFailed: Story = {
  parameters: bridge({ ai: fail(500, 'The bridge answered with an error.') }),
};
export const BridgeDown: Story = { parameters: bridge({ ai: bridgeDown }) };
export const LongText: Story = { parameters: bridge({ ai: toolOk(AI_CHANGES_LONG) }) };
/** An older bridge without list-changes: no tabs. */
export const NoEveryoneTab: Story = { parameters: bridge({ catalog: TOOLS_AI_ONLY }) };

export const EveryoneChanges: Story = { play: openEveryone };
export const EveryoneEmpty: Story = {
  parameters: bridge({ everyone: toolOk(EVERYONE_CHANGES_EMPTY) }),
  play: async () => {
    await userEvent.click(await body().findByRole('button', { name: 'Everyone' }));
    await body().findByText('No changes in the last 7 days.');
  },
};
export const EveryoneNote: Story = {
  parameters: bridge({ everyone: toolOk(EVERYONE_CHANGES_NOTE) }),
  play: async () => {
    await userEvent.click(await body().findByRole('button', { name: 'Everyone' }));
    await body().findByText(EVERYONE_CHANGES_NOTE.note);
  },
};
export const EveryoneFailed: Story = {
  parameters: bridge({ everyone: fail(500, 'The bridge answered with an error.') }),
  play: async () => {
    await userEvent.click(await body().findByRole('button', { name: 'Everyone' }));
    await body().findByText(/Couldn't load changes/);
  },
};
export const FilteredByPerson: Story = {
  play: async () => {
    await openEveryone();
    await userEvent.selectOptions(await body().findByLabelText('Show changes by'), 'person:Brenna');
    await waitFor(() => expect(body().queryByText('Aldric used a hit die')).toBeNull());
  },
};

/** The AI tab's Undo opens the confirm window (a delete-grade write: it asks for the tick). */
export const AiUndoConfirm: Story = {
  play: async () => {
    await userEvent.click(
      await body().findByRole('button', { name: 'Undo: Added the Poisoned condition to Aldric' })
    );
    await body().findByRole('heading', { name: 'Destructive action' });
  },
};

/** A change that is the latest on its thing: the window goes straight to the confirm. */
export const UndoConfirm: Story = {
  parameters: bridge({ plan: toolOk(PLAN_JUST_THIS) }),
  play: async () => {
    await openEveryone();
    await userEvent.click(
      await body().findByRole('button', { name: 'Undo: Brenna changed her Hit Points' })
    );
    await body().findByRole('heading', { name: 'Undo this change?' });
    await body().findByRole('button', { name: 'Undo' });
  },
};

/** A change with later ones on the same thing: just this, or everything since. */
export const UndoChoose: Story = {
  parameters: bridge({ plan: planByScope }),
  play: async () => {
    await openEveryone();
    await userEvent.click(
      await body().findByRole('button', { name: 'Undo: Brenna changed her Hit Points' })
    );
    await body().findByRole('button', { name: 'Everything since' });
  },
};

export const UndoEverythingSince: Story = {
  parameters: bridge({ plan: planByScope }),
  play: async () => {
    await openEveryone();
    await userEvent.click(
      await body().findByRole('button', { name: 'Undo: Brenna changed her Hit Points' })
    );
    await userEvent.click(await body().findByRole('button', { name: 'Everything since' }));
    await body().findByRole('heading', { name: 'Undo everything since?' });
  },
};

/** The rewind asks twice; the second window is destructive and its button waits for the tick. */
export const UndoRewindSure: Story = {
  parameters: bridge({ plan: planByScope }),
  play: async () => {
    await openEveryone();
    await userEvent.click(
      await body().findByRole('button', { name: 'Undo: Brenna changed her Hit Points' })
    );
    await userEvent.click(await body().findByText('Advanced'));
    await userEvent.click(
      await body().findByRole('button', { name: 'Rewind the whole table to here' })
    );
    await userEvent.click(await body().findByRole('button', { name: 'Continue' }));
    await body().findByRole('heading', { name: 'Are you sure?' });
    await expect(body().getByRole('button', { name: 'Undo all 12 changes' })).toBeDisabled();
  },
};

export const Veil: Story = { tags: ['veil'], globals: VEIL, play: openEveryone };
export const Phone: Story = { tags: ['phone'], globals: PHONE_VIEW, play: openEveryone };
