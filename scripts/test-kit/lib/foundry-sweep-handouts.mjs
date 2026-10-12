/**
 * The Handouts and Tarokka window rows of the `foundry-controls` sweep. Both windows hold a reveal:
 * a handout page or a Tarokka position becomes visible to the players. The sweep does each reveal
 * through the window's own button (plan, confirm dialog, apply), checks what the kit player sees,
 * undoes it from the Changes window, and checks the player sees nothing again.
 */
import { KIT_FLAG_KEY, KIT_FLAG_SCOPE } from './contract.mjs';
import {
  Skip,
  answerNo,
  answerYes,
  closeWindow,
  notifications,
  openTool,
  readDialog,
  resetControls,
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
const REFUSAL = /also wrote to the AI Tool's own data/;
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
 * Poll until a function on a page returns something truthy.
 * @template T
 * @param {() => Promise<T>} fn
 * @param {string} what
 * @param {number} [timeout]
 * @returns {Promise<T>}
 */
async function until(fn, what, timeout = 15000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 250));
  }
}

/**
 * Undo the newest undoable row of the Changes window whose summary matches, the way a GM does. A
 * change that also wrote to the AI Tool's own data (a reveal records who may read it) cannot be
 * undone from the window: the backend refuses with a message. The sweep then undoes it the other way
 * a GM can (the dashboard's Recent Changes, here the same `undo-change` call) and says so in the note.
 * @param {any} t
 * @param {import('playwright-core').Page} gm
 * @param {RegExp} match
 * @returns {Promise<string>} what happened
 */
async function undoFromWindow(t, gm, match) {
  await openTool(gm, 'aiChanges', 'fmb-ai-changes');
  const row = await until(async () => {
    await gm.locator('#fmb-ai-changes button[data-action="refresh"]').click();
    await waitLoaded(gm, 'fmb-ai-changes');
    return (await readRows(gm)).find(r => match.test(r.summary) && r.actions.includes('undo'));
  }, `a row like ${match} in the Changes window`);
  await gm.locator(`#fmb-ai-changes .fmb-ai-row[data-change-id="${row.id}"] [data-action="undo"]`).click();
  const refusal = REFUSAL;
  const outcome = await until(async () => {
    if (await gm.locator('.application.dialog').count()) return 'dialog';
    const notes = await notifications(gm);
    return notes.some(n => refusal.test(n)) ? 'refused' : '';
  }, 'the undo dialog or a refusal');
  let note;
  if (outcome === 'dialog') {
    await answerYes(gm);
    await waitNotification(gm, /Undone/);
    note = 'undone from the Changes window';
  } else {
    await t.guarded.undo(row.id);
    note = 'the Changes window refuses to undo a change that also wrote to the AI Tool data, so it was undone with undo-change';
  }
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
  const made = await gm.evaluate(
    async ([scope, key, pageName]) => {
      const entry = await JournalEntry.create({
        name: 'Sweep handout',
        ownership: { default: 0 },
        flags: { [scope]: { [key]: true } },
        pages: [
          { name: pageName, type: 'text', text: { content: '<p>The sweep handout.</p>', format: 1 } },
        ],
      });
      return { id: entry.id, pageUuid: entry.pages.contents[0].uuid };
    },
    [KIT_FLAG_SCOPE, KIT_FLAG_KEY, PAGE_NAME]
  );
  t.cleanup(async () => {
    await t.tool('plan-page-reveal', { action: 'unqueue', pageUuid: made.pageUuid }, { confirm: true }).catch(() => {});
    await gm.evaluate(id => game.journal.get(id)?.delete(), made.id);
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
    if (!titles.some(x => x.includes(PAGE_NAME))) throw new Error(`the queue lists ${titles.join(', ') || 'nothing'}, not ${PAGE_NAME}`);
    return { note: `the queued page is listed (opened in ${openMs} ms)`, timings: { refreshMs: Date.now() - started } };
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
    await gm.locator(`${HO} button[data-action="remove"]`).first().click();
    await waitNotification(gm, /Removed|queue/i);
    await until(async () => (await gm.locator(`${HO} .fmb-ai-row`).count()) === 0, 'the queue to be empty');
    const empty = await gm.locator(`${HO} .fmb-ai-notice`).allTextContents();
    if (!empty.some(x => /Nothing queued/.test(x))) throw new Error('the window does not say the queue is empty');
    await queue();
    await gm.locator(`${HO} button[data-action="refresh"]`).click();
    await waitLoaded(gm, 'fmb-handouts');
    await until(async () => (await gm.locator(`${HO} .fmb-ai-row`).count()) > 0, 'the page queued again');
    return 'Remove empties the queue at once; the page was queued again';
  });

  await sweep.row('foundry.handouts.reveal', 'gm', async () => {
    const button = gm.locator(`${HO} button[data-action="reveal"]`);
    const label = (await button.textContent())?.trim() ?? '';
    if (!label.includes(PAGE_NAME)) throw new Error(`Reveal next reads "${label}"`);
    if (await button.isDisabled()) throw new Error('Reveal next is disabled with a page queued');
    await button.click();
    const dialog = await readDialog(gm);
    if (dialog.title !== 'Reveal handout') throw new Error(`the dialog is titled "${dialog.title}"`);
    if (!dialog.text.includes(PAGE_NAME)) throw new Error('the dialog does not name the page');
    await answerNo(gm);
    if (await seenByPlayer()) throw new Error('Cancel revealed the page to the player');
    await button.click();
    await readDialog(gm);
    const started = Date.now();
    await answerYes(gm);
    await waitNotification(gm, /Revealed|reveal/i);
    const revealMs = Date.now() - started;
    await until(seenByPlayer, 'the kit player to see the handout');
    const copy = await playerReads(player, { name: PAGE_NAME });
    if (!/handout/.test(copy)) throw new Error('the player copy has no text');
    const undoNote = await undoFromWindow(t, gm, /Sweep handout|Reveal|handout/i);
    await until(async () => !(await seenByPlayer()), 'the handout to leave the player view');
    return {
      note: `Cancel changed nothing; Reveal showed the page to the kit player; ${undoNote}`,
      timings: { revealMs },
    };
  }, { expectErrors: [REFUSAL] });

  await closeWindow(gm, 'fmb-handouts').catch(() => {});
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
    for (const name of TAROKKA_ROWS) {
      await sweep.row(name, 'gm', async () => {
        throw new Skip('the world already has a Tarokka reading; the sweep will not archive it');
      });
    }
    return;
  }
  const imported = await t.guarded.planApply('plan-tarokka-import', { source: 'builtin-roll' });
  t.cleanup(async () => {
    await t.guarded.undo(imported.changeId);
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
    return { note: `5 positions (opened in ${openMs} ms)`, timings: { refreshMs: Date.now() - started } };
  });

  await sweep.row('foundry.tarokka.show-cards', 'gm', async () => {
    const hidden = await cardsNow();
    if (hidden.veiled !== 5 || hidden.named !== 0) throw new Error(`cards start as ${JSON.stringify(hidden)}, not all hidden`);
    await gm.locator(`${TK} input[data-field="showCards"]`).check();
    await until(async () => (await cardsNow()).named === 5, 'the card names to show');
    await gm.locator(`${TK} input[data-field="showCards"]`).uncheck();
    await until(async () => (await cardsNow()).veiled === 5, 'the cards to be hidden again');
    return 'five cards hidden; Show cards names them; unticking hides them again';
  });

  await sweep.row('foundry.tarokka.reveal-form', 'gm', async () => {
    const open = gm.locator(`${TK} li[data-position] button[data-action="revealOpen"]`).first();
    await open.click();
    const area = gm.locator(`${TK} textarea[data-field="revealText"]`);
    await area.waitFor({ state: 'visible', timeout: 5000 });
    await gm.locator(`${TK} button[data-action="revealGo"]`).click();
    await waitNotification(gm, /Write the text the players will read first/);
    await gm.locator(`${TK} button[data-action="revealCancel"]`).click();
    await until(async () => (await gm.locator(`${TK} textarea`).count()) === 0, 'the form to close');
    return 'the form opens; an empty text is refused with a message; Cancel closes it';
  }, { expectErrors: [/Write the text the players will read first/] });

  await sweep.row('foundry.tarokka.reveal', 'gm', async () => {
    const position = gm.locator(`${TK} li[data-position]`).first();
    await position.locator('button[data-action="revealOpen"]').click();
    await gm.locator(`${TK} textarea[data-field="revealText"]`).fill(REVEAL_TEXT);
    await gm.locator(`${TK} button[data-action="revealGo"]`).click();
    const dialog = await readDialog(gm);
    if (dialog.title !== 'Reveal Tarokka card') throw new Error(`the dialog is titled "${dialog.title}"`);
    await answerNo(gm);
    const started = Date.now();
    await gm.locator(`${TK} button[data-action="revealGo"]`).click();
    await readDialog(gm);
    await answerYes(gm);
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
            [...foundry.applications.instances.values()].some(a =>
              /JournalEntry|journal/i.test(a.constructor?.name ?? '') || a.element?.classList?.contains('journal-sheet')
            )
          ),
        'the revealed page to open in a journal window'
      );
      await closeAllJournalSheets(gm);
      return 'Open page opens the revealed page in a journal window (a card linked to a document is not in the dealt reading)';
    });
    const undoNote = await undoFromWindow(t, gm, /Reveal Tarokka/i);
    await until(
      async () => (await playerReads(player, { text: REVEAL_TEXT })) === '',
      'the revealed text to leave the player view'
    );
    return {
      note: `Cancel changed nothing; Reveal showed exactly the typed text to the kit player; ${undoNote}`,
      timings: { revealMs },
    };
  }, { expectErrors: [REFUSAL] });

  await closeWindow(gm, 'fmb-tarokka').catch(() => {});
  await resetControls(gm);
}

/** @param {import('playwright-core').Page} page */
async function closeAllJournalSheets(page) {
  await page.evaluate(async () => {
    for (const app of [...foundry.applications.instances.values()]) {
      if (/JournalEntry|journal/i.test(app.constructor?.name ?? '') || app.element?.classList?.contains('journal-sheet')) {
        await app.close({ animate: false });
      }
    }
  });
}
