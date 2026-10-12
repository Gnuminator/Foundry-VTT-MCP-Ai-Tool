/**
 * The Handouts and Tarokka window rows of the `foundry-controls` sweep. Both windows hold a reveal:
 * a handout page or a Tarokka position becomes visible to the players. The sweep does each reveal
 * through the window's own button (plan, confirm dialog, apply), checks what the kit player sees,
 * undoes it from the Changes window, and checks the player sees nothing again.
 */
import { KIT_FLAG_KEY, KIT_FLAG_SCOPE } from './contract.mjs';
import { listOf } from './helpers.mjs';
import {
  Skip,
  answerNo,
  answerYes,
  closeWindow,
  openTool,
  readDialog,
  resetControls,
  runAll,
  undoIfOpen,
  until,
  waitLoaded,
  waitNotification,
} from './foundry-sweep.mjs';
import { readRows } from './foundry-sweep-changes.mjs';

const HO = '#fmb-handouts';
const TK = '#fmb-tarokka';
const TAROKKA_ROWS = [
  'foundry.tarokka.refresh',
  'foundry.tarokka.show-cards',
  'foundry.tarokka.reveal-form',
  'foundry.tarokka.reveal',
  'foundry.tarokka.open-doc',
];
// The summary of a handout reveal, to choose the change among the new ones.
const HANDOUT_REVEAL = /Reveal page .*Sweep handout/i;
const TAROKKA_REVEAL = /Reveal Tarokka/i;
const PAGE_NAME = 'Sweep handout page';
const REVEAL_TEXT = 'The sweep reveals only this sentence.';

/**
 * The text of a journal page the player can read (Observer or better) whose name or text matches, or
 * '' when there is none. A page the player may not read does not count, whatever the client holds.
 * @param {import('playwright-core').Page} player
 * @param {{name?: string, text?: string}} want
 * @returns {Promise<string>}
 */
function playerReads(player, want) {
  return player.evaluate(({ name, text }) => {
    for (const journal of game.journal.contents) {
      for (const page of journal.pages.contents) {
        if (!page.testUserPermission(game.user, 'OBSERVER')) continue;
        const body = page.text?.content ?? '';
        if ((name && page.name === name) || (text && body.includes(text))) return body || page.name;
      }
    }
    return '';
  }, want);
}

/**
 * The ids of the changes the bridge lists now, to tell the change a row makes from the older ones.
 * @param {any} t
 * @returns {Promise<Set<string>>}
 */
async function changeIds(t) {
  const changes = listOf(await t.tool('list-recent-changes', { limit: 200 }), 'changes');
  return new Set(changes.map(c => String(c.changeId)));
}

/**
 * Put-back: undo the undoable changes that appeared since `known` and whose summary matches (a reveal
 * that a failed row did not undo), newest first, each in its own try.
 * @param {any} t
 * @param {Set<string>} known
 * @param {RegExp} hint
 */
async function undoNewChanges(t, known, hint) {
  const changes = listOf(await t.tool('list-recent-changes', { limit: 200 }), 'changes')
    .filter(
      c =>
        !known.has(String(c.changeId)) &&
        c.mode === 'apply' &&
        c.canUndo === true &&
        hint.test(String(c.summary ?? ''))
    )
    .sort((a, b) => String(b.appliedAt).localeCompare(String(a.appliedAt)));
  await runAll(changes.map(c => [`undo ${c.changeId}`, () => t.guarded.undo(c.changeId)]));
}

/**
 * Undo the change a reveal just made, found by its id (the ids that were listed before the reveal are
 * not candidates), the way a GM does from the Changes window. A change that also wrote to the AI
 * Tool's own data (a reveal records who may read it) is undone there with the plain undo, so the
 * window must open its confirm dialog and say "Undone", not refuse.
 * @param {import('playwright-core').Page} gm
 * @param {Set<string>} known  the change ids listed before the reveal
 * @param {RegExp} hint  the summary of the reveal, to choose when several new changes appeared
 * @returns {Promise<string>} what happened
 */
async function undoFromWindow(gm, known, hint) {
  await openTool(gm, 'aiChanges', 'fmb-ai-changes');
  const row = await until(async () => {
    await gm.locator('#fmb-ai-changes button[data-action="refresh"]').click();
    await waitLoaded(gm, 'fmb-ai-changes');
    const fresh = (await readRows(gm)).filter(r => !known.has(r.id) && r.actions.includes('undo'));
    return fresh.find(r => hint.test(r.summary));
  }, 'the new change of the reveal in the Changes window');
  await gm
    .locator(`#fmb-ai-changes .fmb-ai-row[data-change-id="${row.id}"] [data-action="undo"]`)
    .click();
  await until(
    async () => ((await gm.locator('.application.dialog').count()) ? 'dialog' : ''),
    'the undo dialog (a reveal must not be refused)'
  );
  await answerYes(gm, 'Undo');
  // Not the "Undone" notification: one from the row before can still be on screen. The list reloads
  // after the undo and marks the row.
  await until(
    () =>
      gm.locator(`#fmb-ai-changes .fmb-ai-row.fmb-ai-undone[data-change-id="${row.id}"]`).count(),
    'the reveal to show as undone in the Changes window'
  );
  const note = 'undone from the Changes window';
  await closeWindow(gm, 'fmb-ai-changes');
  await resetControls(gm);
  return note;
}

/**
 * @param {import('./foundry-sweep.mjs').Sweep} sweep
 * @param {{t: any, gm: import('playwright-core').Page, player: import('playwright-core').Page}} ctx
 */
export async function handoutsRows(sweep, { t, gm, player }) {
  const { before } = await t.gm('setFeatureSwitches', { switches: { handouts: true } });
  t.cleanup(async () => {
    await t.gm('setFeatureSwitches', { switches: before });
  });
  const knownAtStart = await changeIds(t);
  const made = await gm.evaluate(
    async ([scope, key, pageName]) => {
      const entry = await JournalEntry.create({
        name: 'Sweep handout',
        ownership: { default: 0 },
        flags: { [scope]: { [key]: true } },
        pages: [
          {
            name: pageName,
            type: 'text',
            text: { content: '<p>The sweep handout.</p>', format: 1 },
          },
        ],
      });
      return { id: entry.id, pageUuid: entry.pages.contents[0].uuid };
    },
    [KIT_FLAG_SCOPE, KIT_FLAG_KEY, PAGE_NAME]
  );
  t.cleanup(async () => {
    // Both put-backs are tried. Unqueue refuses a page that is not queued (a reveal that was undone
    // puts it back, one that was not leaves it out): only that refusal is fine.
    await runAll([
      ['undo a reveal a failed row left', () => undoNewChanges(t, knownAtStart, HANDOUT_REVEAL)],
      [
        'unqueue the sweep page',
        () =>
          t
            .tool(
              'plan-page-reveal',
              { action: 'unqueue', pageUuid: made.pageUuid },
              { confirm: true }
            )
            .catch(err => {
              if (!/not in the reveal queue/i.test(String(err?.message ?? err))) throw err;
            }),
      ],
      [
        'delete the sweep journal',
        () => gm.evaluate(id => game.journal.get(id)?.delete(), made.id),
      ],
    ]);
  });
  const queue = () =>
    t.tool('plan-page-reveal', { action: 'queue', pageUuid: made.pageUuid }, { confirm: true });
  const seenByPlayer = async () => (await playerReads(player, { name: PAGE_NAME })) !== '';

  await queue();
  const openMs = await openTool(gm, 'handouts', 'fmb-handouts');

  await sweep.row('foundry.handouts.refresh', 'gm', async () => {
    const started = Date.now();
    await gm.locator(`${HO} button[data-action="refresh"]`).click();
    await waitLoaded(gm, 'fmb-handouts');
    await gm.waitForTimeout(300);
    const titles = await gm.locator(`${HO} .fmb-ai-row .fmb-ai-summary`).allTextContents();
    if (!titles.some(x => x.includes(PAGE_NAME)))
      throw new Error(`the queue lists ${titles.join(', ') || 'nothing'}, not ${PAGE_NAME}`);
    await sweep.shot('gm', 'handouts-queue.png');
    return {
      note: `the queued page is listed (opened in ${openMs} ms)`,
      timings: { refreshMs: Date.now() - started },
    };
  });

  await sweep.row('foundry.handouts.show-now', 'gm', async () => {
    const box = gm.locator(`${HO} input[data-field="showNow"]`);
    await box.check();
    await gm.locator(`${HO} button[data-action="refresh"]`).click();
    await waitLoaded(gm, 'fmb-handouts');
    if (!(await gm.locator(`${HO} input[data-field="showNow"]`).isChecked())) {
      throw new Error('the tick was lost by a Refresh');
    }
    await closeWindow(gm, 'fmb-handouts');
    await openTool(gm, 'handouts', 'fmb-handouts');
    if (await gm.locator(`${HO} input[data-field="showNow"]`).isChecked()) {
      throw new Error('the tick is still on after closing and reopening the window');
    }
    return 'ticks, survives a Refresh, is cleared when the window closes';
  });

  await sweep.row('foundry.handouts.remove', 'gm', async () => {
    // Only the sweep's own page: whatever else is queued in this world is not ours to remove.
    const mine = gm.locator(
      `${HO} button[data-action="remove"][data-page-uuid="${made.pageUuid}"]`
    );
    if (!(await mine.count())) throw new Error('the sweep page has no Remove button in the queue');
    const rows = gm.locator(`${HO} .fmb-ai-row`);
    const others = (await rows.count()) - 1;
    await mine.click();
    await waitNotification(gm, /Removed|queue/i);
    await until(async () => (await mine.count()) === 0, 'the sweep page to leave the queue');
    if ((await rows.count()) !== others)
      throw new Error(
        `Remove changed the other rows (${others} before, ${await rows.count()} after)`
      );
    if (others === 0) {
      const empty = await gm.locator(`${HO} .fmb-ai-notice`).allTextContents();
      if (!empty.some(x => /Nothing queued/.test(x)))
        throw new Error('the window does not say the queue is empty');
    }
    await queue();
    await gm.locator(`${HO} button[data-action="refresh"]`).click();
    await waitLoaded(gm, 'fmb-handouts');
    await until(async () => (await mine.count()) > 0, 'the page queued again');
    return `Remove takes the sweep page out of the queue at once (${others} other rows unchanged); the page was queued again`;
  });

  await sweep.row('foundry.handouts.reveal', 'gm', async () => {
    const button = gm.locator(`${HO} button[data-action="reveal"]`);
    const label = (await button.textContent())?.trim() ?? '';
    if (!label.includes(PAGE_NAME)) throw new Error(`Reveal next reads "${label}"`);
    if (await button.isDisabled()) throw new Error('Reveal next is disabled with a page queued');
    await button.click();
    const dialog = await readDialog(gm);
    if (dialog.title !== 'Reveal handout')
      throw new Error(`the dialog is titled "${dialog.title}"`);
    if (!dialog.text.includes(PAGE_NAME)) throw new Error('the dialog does not name the page');
    await answerNo(gm);
    if (await seenByPlayer()) throw new Error('Cancel revealed the page to the player');
    const known = await changeIds(t);
    await button.click();
    await readDialog(gm);
    const started = Date.now();
    await answerYes(gm, 'Reveal');
    await waitNotification(gm, /Revealed|reveal/i);
    const revealMs = Date.now() - started;
    await until(seenByPlayer, 'the kit player to see the handout');
    const copy = await playerReads(player, { name: PAGE_NAME });
    if (!/handout/.test(copy)) throw new Error('the player copy has no text');
    const undoNote = await undoFromWindow(gm, known, HANDOUT_REVEAL);
    await until(async () => !(await seenByPlayer()), 'the handout to leave the player view');
    return {
      note: `Cancel changed nothing; Reveal showed the page to the kit player; ${undoNote}`,
      timings: { revealMs },
    };
  });

  await closeWindow(gm, 'fmb-handouts');
  await resetControls(gm);
}

/**
 * @param {import('./foundry-sweep.mjs').Sweep} sweep
 * @param {{t: any, gm: import('playwright-core').Page, player: import('playwright-core').Page}} ctx
 */
export async function tarokkaRows(sweep, { t, gm, player }) {
  const { before } = await t.gm('setFeatureSwitches', { switches: { tarokka: true } });
  t.cleanup(async () => {
    await t.gm('setFeatureSwitches', { switches: before });
  });
  const existing = await t.tool('get-tarokka-reading', {});
  if (existing?.reading?.readingId) {
    // A reading left by a failed earlier run of this sweep (its reveal text is still in a journal)
    // is a failure, not a skip: otherwise every later run would show five skips and stay green.
    const leftover = await gm.evaluate(
      text =>
        game.journal.contents.some(j =>
          j.pages.contents.some(p => (p.text?.content ?? '').includes(text))
        ),
      REVEAL_TEXT
    );
    const readingId = String(existing.reading.readingId);
    for (const name of TAROKKA_ROWS) {
      await sweep.row(name, 'gm', async () => {
        if (leftover)
          throw new Error(
            `the world still holds the sweep's Tarokka reveal text (reading ${readingId}): an earlier run did not put it back`
          );
        throw new Skip(
          `the world already has a Tarokka reading (${readingId}); the sweep will not archive it, so all ${TAROKKA_ROWS.length} Tarokka rows are skipped`
        );
      });
    }
    return;
  }
  const knownAtStart = await changeIds(t);
  const imported = await t.guarded.planApply('plan-tarokka-import', { source: 'builtin-roll' });
  t.cleanup(async () => {
    // The reveal comes after the import, so a reveal a failed row left goes first.
    await runAll([
      ['undo a reveal a failed row left', () => undoNewChanges(t, knownAtStart, TAROKKA_REVEAL)],
      ['undo the Tarokka import', () => undoIfOpen(t, imported.changeId)],
    ]);
  });
  const openMs = await openTool(gm, 'tarokka', 'fmb-tarokka');
  const cardsNow = () =>
    gm.evaluate(() => ({
      veiled: document.querySelectorAll('#fmb-tarokka .fmb-tk-veiled').length,
      named: document.querySelectorAll('#fmb-tarokka .fmb-tk-card code').length,
      positions: document.querySelectorAll('#fmb-tarokka li[data-position]').length,
    }));

  await sweep.row('foundry.tarokka.refresh', 'gm', async () => {
    const started = Date.now();
    await gm.locator(`${TK} button[data-action="refresh"]`).click();
    await waitLoaded(gm, 'fmb-tarokka');
    await gm.waitForTimeout(300);
    const c = await cardsNow();
    if (c.positions !== 5) throw new Error(`the window lists ${c.positions} positions, not 5`);
    return {
      note: `5 positions (opened in ${openMs} ms)`,
      timings: { refreshMs: Date.now() - started },
    };
  });

  await sweep.row('foundry.tarokka.show-cards', 'gm', async () => {
    const hidden = await cardsNow();
    if (hidden.veiled !== 5 || hidden.named !== 0)
      throw new Error(`cards start as ${JSON.stringify(hidden)}, not all hidden`);
    await gm.locator(`${TK} input[data-field="showCards"]`).check();
    await until(async () => (await cardsNow()).named === 5, 'the card names to show');
    await sweep.shot('gm', 'tarokka-cards-shown.png');
    await gm.locator(`${TK} input[data-field="showCards"]`).uncheck();
    await until(async () => (await cardsNow()).veiled === 5, 'the cards to be hidden again');
    return 'five cards hidden; Show cards names them; unticking hides them again';
  });

  await sweep.row(
    'foundry.tarokka.reveal-form',
    'gm',
    async () => {
      const open = gm.locator(`${TK} li[data-position] button[data-action="revealOpen"]`).first();
      await open.click();
      const area = gm.locator(`${TK} textarea[data-field="revealText"]`);
      await area.waitFor({ state: 'visible', timeout: 5000 });
      await gm.locator(`${TK} button[data-action="revealGo"]`).click();
      await waitNotification(gm, /Write the text the players will read first/);
      await gm.locator(`${TK} button[data-action="revealCancel"]`).click();
      await until(
        async () => (await gm.locator(`${TK} textarea`).count()) === 0,
        'the form to close'
      );
      return 'the form opens; an empty text is refused with a message; Cancel closes it';
    },
    { expectErrors: [/Write the text the players will read first/] }
  );

  await sweep.row('foundry.tarokka.reveal', 'gm', async () => {
    const position = gm.locator(`${TK} li[data-position]`).first();
    await position.locator('button[data-action="revealOpen"]').click();
    await gm.locator(`${TK} textarea[data-field="revealText"]`).fill(REVEAL_TEXT);
    await gm.locator(`${TK} button[data-action="revealGo"]`).click();
    const dialog = await readDialog(gm);
    if (dialog.title !== 'Reveal Tarokka card')
      throw new Error(`the dialog is titled "${dialog.title}"`);
    await answerNo(gm);
    const known = await changeIds(t);
    const started = Date.now();
    await gm.locator(`${TK} button[data-action="revealGo"]`).click();
    await readDialog(gm);
    await answerYes(gm, 'Reveal');
    await waitNotification(gm, /Revealed/);
    const revealMs = Date.now() - started;
    const playerText = await until(
      () => playerReads(player, { text: REVEAL_TEXT }),
      'the kit player to see the revealed text'
    );
    if (!playerText.includes(REVEAL_TEXT)) throw new Error('the player page lacks the typed text');
    await sweep.row('foundry.tarokka.open-doc', 'gm', async () => {
      await gm.locator(`${TK} li[data-position] button[data-action="openDoc"]`).first().click();
      await until(
        () =>
          gm.evaluate(() =>
            [...foundry.applications.instances.values()].some(
              a =>
                /JournalEntry|journal/i.test(a.constructor?.name ?? '') ||
                a.element?.classList?.contains('journal-sheet')
            )
          ),
        'the revealed page to open in a journal window'
      );
      await closeAllJournalSheets(gm);
      return 'Open page opens the revealed page in a journal window (a card linked to a document is not in the dealt reading)';
    });
    const undoNote = await undoFromWindow(gm, known, TAROKKA_REVEAL);
    await until(
      async () => (await playerReads(player, { text: REVEAL_TEXT })) === '',
      'the revealed text to leave the player view'
    );
    return {
      note: `Cancel changed nothing; Reveal showed exactly the typed text to the kit player; ${undoNote}`,
      timings: { revealMs },
    };
  });

  await closeWindow(gm, 'fmb-tarokka');
  await resetControls(gm);
}

/** @param {import('playwright-core').Page} page */
async function closeAllJournalSheets(page) {
  await page.evaluate(async () => {
    for (const app of [...foundry.applications.instances.values()]) {
      if (
        /JournalEntry|journal/i.test(app.constructor?.name ?? '') ||
        app.element?.classList?.contains('journal-sheet')
      ) {
        await app.close({ animate: false });
      }
    }
  });
}
