import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';

import { Opened } from '../storybook/Opened';
import { reply } from '../storybook/fakeApi';
import { PHONE_VIEW, VEIL } from '../storybook/modes';

import { VersionsPane, type VersionRow, type VersionsView } from './Versions';

// Version tracker (I-127): installed against newest, and the last test-kit result. Names and
// version numbers only; nothing from the campaign.
const row = (
  id: string,
  title: string,
  installed: string,
  newest: string | null,
  kind: VersionRow['kind'] = 'module',
  active = true
): VersionRow => ({
  id,
  kind,
  title,
  installed,
  newest,
  active,
  status: newest === null ? 'unknown' : installed === newest ? 'ok' : 'behind',
});

const ROWS: VersionRow[] = [
  row('foundry', 'Foundry VTT', '14.368', '14.368', 'core'),
  row('dnd5e', 'dnd5e', '6.0.5', '6.0.6', 'system'),
  row('foundry-mcp-bridge', 'Foundry AI Tool bridge', '1.4.0', '1.4.0'),
  row('lib-wrapper', 'libWrapper', '1.12.13', '1.13.0'),
  row('tidy5e-sheet', 'Tidy 5e Sheet', '4.2.1', null),
  row('old-fog', 'Old Fog Helper', '0.3.0', '0.3.0', 'module', false),
];

const view = (patch: Partial<Extract<VersionsView, { enabled: true }>> = {}): VersionsView => ({
  enabled: true,
  rows: ROWS,
  checkedAt: '2026-10-18T19:30:00Z',
  checking: false,
  lookupErrors: 0,
  kit: { state: 'passed', at: '2026-10-18T03:10:00Z', text: '212 passed, 0 failed' },
  ...patch,
});

const serve = (
  answer: VersionsView
): { dashboard: { api: { routes: Record<string, unknown> } } } => ({
  dashboard: { api: { routes: { '/api/versions': reply(answer) } } },
});

const meta = {
  title: 'Panels/Versions',
  parameters: { layout: 'fullscreen', ...serve(view()) },
  render: (): JSX.Element => (
    <Opened>
      {(open, onOpenChange) => <VersionsPane open={open} onOpenChange={onOpenChange} />}
    </Opened>
  ),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const SomeBehind: Story = {};
export const AllUpToDate: Story = {
  parameters: serve(view({ rows: ROWS.map(r => ({ ...r, newest: r.installed, status: 'ok' })) })),
};
export const LookupsFailedKitFailed: Story = {
  parameters: serve(
    view({
      lookupErrors: 2,
      kit: { state: 'failed', at: '2026-10-18T03:10:00Z', text: '3 failed: dashboard sweep' },
    })
  ),
};
export const NoKitResult: Story = { parameters: serve(view({ kit: null })) };
export const FoundryNotAnswering: Story = { parameters: serve(view({ rows: null })) };
export const SwitchedOff: Story = { parameters: serve({ enabled: false }) };
export const Veil: Story = { tags: ['veil'], globals: VEIL };
export const Phone: Story = { tags: ['phone'], globals: PHONE_VIEW };
