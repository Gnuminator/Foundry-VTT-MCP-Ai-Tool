/**
 * Which test covers every dashboard and player control the sweep never clicks (rows whose `how` is
 * `write` or `skip`, test kit slice 4). One entry per row name:
 * - `{ file, mention? }`  a spec, scenario or unit test in the repo; the file must contain the control
 *                         name, or `mention` (the part of the name the test uses). The engine test
 *                         (test/control-coverage.test.mjs) fails when it does not.
 * - `'by hand'`           a person checks it on a test server (the paper-form flow, the live strip page)
 * - `'none'`              no check names it today: listed as uncovered in the kit report
 * Add the file when you add a test that drives the control; that moves a row out of `'none'`.
 */
/** @typedef {{file: string, mention?: string} | 'by hand' | 'none'} Coverage */
const E2E = 'packages/cogm-dashboard/web/e2e/';
const WRITE_FLOWS = 'scripts/test-kit/scenarios/dashboard-write-flows.scenario.mjs';

/** @type {Record<string, Coverage>} */
export const CONTROL_COVERAGE = {
  // The My character page (/me): checked by hand on the test server (item me-usage-tracking).
  ...Object.fromEntries(
    [
      'view.at-table',
      'view.paper-2024',
      'view.paper-2014',
      'view.night',
      'character.switch',
      'turn-card.toggle',
      'print',
      'diary.open',
      'diary.save',
      'diary.edit',
      'diary.delete',
      'downtime.save',
      'downtime.edit',
      'downtime.delete',
      'connector.copy',
      'connector.show',
      'connector.download',
      'connector.retry',
    ].map(n => [`me.${n}`, /** @type {const} */ ('by hand')])
  ),
  'dash.header.paper': 'by hand',
  'dash.strip.reload': 'by hand',
  'dash.crash.reload': 'by hand',
  'dash.live.clear': 'none',
  'dash.live.condition': 'none',
  'dash.live.end-combat': { file: `${E2E}live-strip.spec.ts`, mention: 'end-combat' },
  'dash.live.next-turn': { file: `${E2E}live-strip.spec.ts`, mention: 'next-turn' },
  'dash.live.one-round': 'none',
  'dash.live.pan': 'none',
  'dash.live.pick': 'none',
  'dash.live.remove-condition': 'none',
  'dash.live.show-handout': 'none',
  'dash.live.undo': 'none',
  'dash.quickroll.again': 'none',
  'dash.quickroll.nudge': 'none',
  'dash.quickroll.post-results': 'none',
  'dash.live.monster-action': 'none',
  'dash.changes.ai-only': 'none',
  'dash.header.live-views': { file: `${E2E}live-screen.spec.ts`, mention: '#btn-live-views' },
  'dash.live.back': 'none',
  'dash.live.header-undo': { file: `${E2E}live-screen.spec.ts`, mention: 'header-undo' },
  'dash.live.how-do-i': { file: `${E2E}live-screen.spec.ts`, mention: 'how-do-i' },
  'dash.header.version-tracker': 'none',
  'dash.header.show-versions': 'none',
  'dash.versions.recheck': 'none',
  'dash.header.gm-actions': { file: `${E2E}gm-actions-switch.spec.ts`, mention: '#btn-gm' },
  'dash.during.layout-tour': { file: `${E2E}combat-strip.spec.ts`, mention: 'layout-tour' },
  'dash.trial.use': 'none',
  'dash.trial.skip': 'none',
  'dash.during.hint-dismiss': { file: `${E2E}during-layouts.spec.ts` },
  'dash.help.wiki': 'none',
  'dash.changes.undo': { file: WRITE_FLOWS },
  'dash.changes.everyone-redo': 'none',
  'dash.combat.condition': 'none',
  'dash.combat.condition-cancel': 'none',
  'dash.damage.mode-damage': 'none',
  'dash.damage.mode-heal': 'none',
  'dash.damage.amount': 'none',
  'dash.damage.type': 'none',
  'dash.damage.cancel': 'none',
  'dash.damage.apply': 'none',
  'dash.attack.attacker': 'none',
  'dash.attack.weapon': 'none',
  'dash.attack.target': 'none',
  'dash.attack.cancel': 'none',
  'dash.attack.go': 'none',
  'dash.quickroll.what': 'none',
  'dash.quickroll.dc': 'none',
  'dash.quickroll.visibility': 'none',
  'dash.quickroll.advantage': 'none',
  'dash.quickroll.picked': 'none',
  'dash.quickroll.party': 'none',
  'dash.quickroll.member': 'none',
  'dash.combat.start': 'none',
  'dash.during.start-combat': 'none',
  'dash.combat.start-cancel': 'none',
  'dash.combat.start-go': 'none',
  'dash.during.conditions': 'none',
  'dash.conditions.pick': 'none',
  'dash.conditions.rules': 'none',
  'dash.conditions.close': 'none',
  'dash.conditions.add': 'none',
  'dash.conditions.remove': 'none',
  'dash.during.scene-mood': { file: `${E2E}scene-mood.spec.ts`, mention: '#btn-during-scene-mood' },
  'dash.mood.apply': 'none',
  'dash.mood.close': 'none',
  'dash.combat.end': 'none',
  'dash.combat.foundry-targets': 'none',
  'dash.pins.pin': 'none',
  'dash.pins.run': 'none',
  'dash.pins.result-close': 'none',
  'dash.pins.edit': 'none',
  'dash.pins.remove': 'none',
  'dash.pins.open-recent': 'none',
  'dash.pins.open-often': 'none',
  'dash.pins.pin-often': 'none',
  'dash.tools.foundry-targets': 'none',
  'dash.tools.enable-gm-actions': 'none',
  'dash.handouts.reveal-next': { file: `${E2E}handouts.spec.ts`, mention: 'reveal-next' },
  'dash.handouts.unqueue': 'none',
  'dash.handouts.move-up': 'none',
  'dash.handouts.move-down': 'none',
  'dash.twin.close': 'by hand',
  'dash.twin.open': 'by hand',
  'dash.readaloud.close': 'by hand',
  'dash.readaloud.show': 'by hand',
  'dash.readaloud.copy': 'by hand',
  'dash.paper.close': 'by hand',
  'dash.paper.refresh': 'by hand',
  'dash.paper.add-item': 'by hand',
  'dash.paper.remove-item': 'by hand',
  'dash.paper.plan': 'by hand',
  'dash.paper.reset': 'by hand',
  'dash.paper.log-night': 'by hand',
  'dash.party.add-to-combat': { file: `${E2E}party.spec.ts`, mention: 'add-to-combat' },
  'dash.party.pace': { file: WRITE_FLOWS },
  'dash.party.place': 'none',
  'dash.party.rest-long': 'none',
  'dash.party.rest-short': { file: WRITE_FLOWS },
  'dash.preflight.hide-tarokka': 'none',
  'dash.ready.turn-on': 'none',
  'dash.live.turn-on': { file: `${E2E}gm-actions-switch.spec.ts`, mention: '#btn-gm' },
  'dash.ready.turn-off': 'none',
  'dash.ready.start-log': 'none',
  'dash.tarokka.roll': 'none',
  'dash.tarokka.choose': 'none',
  'dash.tarokka.choose-save': 'none',
  'dash.tarokka.link-pick': 'none',
  'dash.tarokka.plan-reveal': 'none',
  'dash.after.paper': 'by hand',
  'dash.notes.put': 'none',
  'dash.notes.approve': 'none',
  'dash.notes.undo': 'none',
  'dash.session.toggle': 'none',
  'dash.links.make': { file: WRITE_FLOWS },
  'dash.links.replace': 'none',
  'dash.links.remove': { file: WRITE_FLOWS },
  'dash.toast.undo': 'none',
  'dash.modal.cancel': 'none',
  'dash.modal.confirm': 'none',
  'dash.modal.destructive-check': {
    file: `${E2E}live-strip-scheme.spec.ts`,
    mention: 'destructive-check',
  },
  'dash.undo.apply': 'none',
  'dash.shortcut.escape-modal': 'none',
  'dash.omens.approve': 'none',
  'dash.omens.reject': 'none',
  'dash.omens.reopen': 'none',
  'dash.omens.link': 'none',
  'dash.omens.unlink': 'none',
  'dash.ledger.add': 'none',
  'dash.ledger.remove': 'none',
  'dash.live.whisper-toggle': 'by hand',
  'dash.live.whisper-send': 'none',
  'dash.readaloud.knows': 'by hand',
  'dash.drafts.publish': 'none',
  'dash.drafts.edit': 'none',
  'dash.drafts.save': 'none',
  'dash.drafts.discard': 'none',
  'dash.drafts.reopen': 'none',
};

/**
 * The report of the rows the sweep never clicks (`write` and `skip`): counts, and the names checked by
 * hand or not at all.
 * @param {Array<{name: string, how: string}>} rows
 */
export function coverageReport(rows) {
  const names = rows.filter(r => r.how === 'write' || r.how === 'skip').map(r => r.name);
  const kinds = names.map(n => ({ n, k: coverageOf(n).kind }));
  const pick = (/** @type {string} */ kind) => kinds.filter(x => x.k === kind).map(x => x.n);
  return {
    rows: names.length,
    covered: pick('file').length,
    byHand: pick('by hand'),
    uncovered: [...pick('none'), ...pick('missing')],
  };
}

/**
 * The coverage entry of a control row, normalised.
 * @param {string} name
 * @returns {{kind: 'file', file: string, mention: string} | {kind: 'by hand'} | {kind: 'none'} | {kind: 'missing'}}
 */
export function coverageOf(name) {
  const c = CONTROL_COVERAGE[name];
  if (c === undefined) return { kind: 'missing' };
  if (c === 'by hand') return { kind: 'by hand' };
  if (c === 'none') return { kind: 'none' };
  return { kind: 'file', file: c.file, mention: c.mention ?? name };
}
