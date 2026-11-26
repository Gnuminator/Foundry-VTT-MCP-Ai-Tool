// Test kit controls of the Prep drawer's "Omens by post" list (I-181), kept apart from
// dashboard-controls.mjs, whose line count may not grow. Same row shape as DASHBOARD_CONTROLS.
export const OMENS_CONTROLS = [
  { name: 'dash.omens.approve', how: 'write', why: 'approves an omen so the bot sends it' },
  { name: 'dash.omens.reject', how: 'write', why: 'rejects a drafted omen' },
  { name: 'dash.omens.reopen', how: 'write', why: 'puts an omen back to draft' },
  { name: 'dash.omens.link', how: 'write', why: 'links a player to a Discord user id' },
  { name: 'dash.omens.unlink', how: 'write', why: 'removes the Discord user id of a player' },
  // Draft tray (I-069), the next list in the same Prep drawer.
  { name: 'dash.drafts.publish', how: 'write', why: 'posts a drafted text for players to chat' },
  { name: 'dash.drafts.edit', how: 'write', why: 'opens a drafted text for editing' },
  { name: 'dash.drafts.save', how: 'write', why: 'saves the edited text and whisper target' },
  { name: 'dash.drafts.discard', how: 'write', why: 'throws a drafted text away' },
  { name: 'dash.drafts.reopen', how: 'write', why: 'puts a discarded or stuck draft back' },
  // Who knows what and the whisper desk (item secret-ledger-whispers).
  { name: 'dash.ledger.add', how: 'write', why: 'saves a secret and who knows it in the ledger' },
  { name: 'dash.ledger.remove', how: 'write', why: 'removes a line from the ledger' },
  { name: 'dash.live.whisper-toggle', how: 'skip', why: 'opens the whisper box on the strip' },
  {
    name: 'dash.live.whisper-send',
    how: 'write',
    why: 'whispers to a player in Foundry and Discord',
  },
  { name: 'dash.readaloud.knows', how: 'skip', why: 'opens the who-knows editor of a page' },
];
