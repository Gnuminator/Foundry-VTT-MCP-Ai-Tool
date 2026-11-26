import { OMENS_CONTROLS } from './dashboard-controls-omens.mjs';

// Test kit controls of the My character page (/me, item me-usage-tracking), kept apart from
// dashboard-controls.mjs, whose line count may not grow. The page is behind a private key and the
// sweep reloads /player only, so these are reported as skipped. The unit tests (usage-names,
// me-route) and the server A check cover them. Same row shape as DASHBOARD_CONTROLS.
export const ME_CONTROLS = [
  ...[
    'me.view.at-table',
    'me.view.paper-2024',
    'me.view.paper-2014',
    'me.view.night',
    'me.character.switch',
    'me.turn-card.toggle',
    'me.print',
    'me.diary.open',
    'me.diary.save',
    'me.diary.edit',
    'me.diary.delete',
    'me.keepsake.add',
    'me.keepsake.delete',
    'me.downtime.save',
    'me.downtime.edit',
    'me.downtime.delete',
    'me.connector.copy',
    'me.connector.show',
    'me.connector.download',
    'me.connector.retry',
  ].map(name => ({
    name,
    how: /** @type {const} */ ('skip'),
    why: 'on the My character page (/me, a private link), which the player sweep does not open',
  })),
  { name: 'me.page.open', how: 'view', expect: '#me-main' },
];

/** The control rows kept outside dashboard-controls.mjs (its line count may not grow). */
export const EXTRA_CONTROLS = [...OMENS_CONTROLS, ...ME_CONTROLS];
