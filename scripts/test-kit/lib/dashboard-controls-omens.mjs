// Test kit controls of the Prep drawer's "Omens by post" list (I-181), kept apart from
// dashboard-controls.mjs, whose line count may not grow. Same row shape as DASHBOARD_CONTROLS.
export const OMENS_CONTROLS = [
  { name: 'dash.omens.approve', how: 'write', why: 'approves an omen so the bot sends it' },
  { name: 'dash.omens.reject', how: 'write', why: 'rejects a drafted omen' },
  { name: 'dash.omens.reopen', how: 'write', why: 'puts an omen back to draft' },
  { name: 'dash.omens.link', how: 'write', why: 'links a player to a Discord user id' },
];
