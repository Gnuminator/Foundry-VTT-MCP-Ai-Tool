import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';

import { MODULE_ERRORS_KEY } from '../lib/stream';
import { Opened } from '../storybook/Opened';
import { reply } from '../storybook/fakeApi';
import { MODULE_ERRORS, moduleErrorLog } from '../storybook/fixtures/links';
import { PHONE_VIEW, VEIL } from '../storybook/modes';

import { ModuleDiagnosticsPane } from './ModuleDiagnostics';

// Module diagnostics: the errors and warnings other Foundry modules raise. They arrive on the live
// stream, so a story seeds them into the query cache instead of faking a route.
const errors = (
  entries: typeof MODULE_ERRORS
): { dashboard: { cache: [[readonly string[], unknown]] } } => ({
  dashboard: { cache: [[MODULE_ERRORS_KEY, moduleErrorLog(entries)]] },
});

const meta = {
  title: 'Panels/ModuleDiagnostics',
  parameters: { layout: 'fullscreen', ...errors(MODULE_ERRORS) },
  render: (): JSX.Element => (
    <Opened>
      {(open, onOpenChange) => <ModuleDiagnosticsPane open={open} onOpenChange={onOpenChange} />}
    </Opened>
  ),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const ErrorsAndWarnings: Story = {};
export const NoneCaptured: Story = { parameters: errors([]) };
export const ManyEntries: Story = {
  parameters: errors(
    Array.from({ length: 24 }, (_, i) => ({
      ...MODULE_ERRORS[i % MODULE_ERRORS.length],
      id: `many-${i}`,
    }))
  ),
};

/** The disk check on the server has not run for hours: a note shows above the list. */
export const SpaceCheckOverdue: Story = {
  parameters: {
    ...errors(MODULE_ERRORS),
    dashboard: {
      cache: errors(MODULE_ERRORS).dashboard.cache,
      api: {
        routes: {
          '/api/space': reply({
            available: true,
            stale: true,
            checkedAt: '2026-10-08T12:00:00Z',
            host: 'harbor-pi',
          }),
        },
      },
    },
  },
};
export const Veil: Story = { tags: ['veil'], globals: VEIL, parameters: errors(MODULE_ERRORS) };
export const Phone: Story = {
  tags: ['phone'],
  globals: PHONE_VIEW,
  parameters: errors(MODULE_ERRORS),
};
