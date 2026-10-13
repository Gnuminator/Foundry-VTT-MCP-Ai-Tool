/**
 * The scene controls and the Changes window rows of the `foundry-controls` sweep. The Changes window
 * is also where the sweep proves the guarded write path end to end: a damage change is planned and
 * applied through the bridge, shows up in the window, is undone from the window (Cancel first, then
 * Undo), redone from the window, and put back.
 */
import { listOf, monsterOf } from './helpers.mjs';
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
  waitLoaded,
  waitNotification,
} from './foundry-sweep.mjs';

const CHANGES = '#fmb-ai-changes';
const TOOLS = [
  ['aiChanges', 'Changes', 'fmb-ai-changes'],
  ['handouts', 'Handouts', 'fmb-handouts'],
  ['tarokka', 'Tarokka', 'fmb-tarokka'],
];

/**
 * What the Changes window lists now.
 * @param {import('playwright-core').Page} page
 * @returns {Promise<Array<{id: string, summary: string, meta: string, actions: string[]}>>}
 */
export function readRows(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('#fmb-ai-changes .fmb-ai-row')].map(r => ({
      id: /** @type {HTMLElement} */ (r).dataset.changeId ?? '',
      summary: r.querySelector('.fmb-ai-summary')?.textContent?.trim() ?? '',
      meta: r.querySelector('.fmb-ai-meta')?.textContent?.trim() ?? '',
      actions: [...r.querySelectorAll('.fmb-ai-actions button')].map(
        b => /** @type {HTMLElement} */ (b).dataset.action ?? ''
      ),
    }))
  );
}

/**
 * Click Refresh in the Changes window and wait for the list to be drawn again.
 * @param {import('playwright-core').Page} page
 */
async function refresh(page) {
  await page.locator(`${CHANGES} button[data-action="refresh"]`).click();
  await waitLoaded(page, 'fmb-ai-changes');
  await page.waitForTimeout(200);
}

/**
 * Poll until a check on the rows holds.
 * @param {import('playwright-core').Page} page
 * @param {(rows: Awaited<ReturnType<typeof readRows>>) => boolean} test
 * @param {string} what
 * @param {number} [timeout]
 */
async function waitRows(page, test, what, timeout = 15000) {
  const until = Date.now() + timeout;
  for (;;) {
    if (test(await readRows(page))) return;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await page.waitForTimeout(250);
  }
}

/** @param {import('./foundry-sweep.mjs').Sweep} sweep @param {{gm: any, player: any}} p */
export async function sceneRows(sweep, { gm, player }) {
  await sweep.row('foundry.scene.group', 'gm', async () => {
    const group = gm.locator('#scene-controls-layers button[data-control="aiTool"]');
    await group.waitFor({ state: 'visible', timeout: 10000 });
    const title = await group.evaluate(
      /** @param {HTMLElement} b */ b =>
        b.getAttribute('aria-label') || b.dataset.tooltip || b.title
    );
    if (title !== 'AI Tool') throw new Error(`the group is called "${title}", not "AI Tool"`);
    const layerBefore = await gm.evaluate(() => canvas.activeLayer?.constructor?.name ?? '');
    await group.click();
    await gm.locator('#scene-controls-tools button[data-tool="tarokka"]').waitFor({
      state: 'visible',
      timeout: 10000,
    });
    const tools = await gm.evaluate(() =>
      [...document.querySelectorAll('#scene-controls-tools button[data-tool]')].map(b => {
        const el = /** @type {HTMLElement} */ (b);
        return `${el.dataset.tool}=${el.getAttribute('aria-label') || el.dataset.tooltip || el.title}`;
      })
    );
    const wanted = TOOLS.map(([tool, label]) => `${tool}=${label}`);
    if (JSON.stringify(tools) !== JSON.stringify(wanted)) {
      throw new Error(`the group lists ${tools.join(', ')}, expected ${wanted.join(', ')}`);
    }
    // The group has no canvas layer: the canvas keeps the layer it had.
    const layerAfter = await gm.evaluate(() => canvas.activeLayer?.constructor?.name ?? '');
    if (layerAfter !== layerBefore) {
      throw new Error(`the canvas layer changed from ${layerBefore} to ${layerAfter}`);
    }
    await resetControls(gm);
    return `3 tools: ${TOOLS.map(t => t[1]).join(', ')}; the canvas layer stays ${layerBefore}`;
  });
  await sweep.row('foundry.scene.group', 'player', async () => {
    const info = await player.evaluate(() => ({
      inRecord: Object.keys(ui.controls?.controls ?? {}).includes('aiTool'),
      button: !!document.querySelector('[data-control="aiTool"], [data-tool="aiChanges"]'),
      groups: Object.keys(ui.controls?.controls ?? {}),
    }));
    if (info.inRecord || info.button) throw new Error('a player can see the AI Tool group');
    return `a player's controls: ${info.groups.join(', ')}`;
  });
  for (const [tool, title, id] of TOOLS) {
    await sweep.row(`foundry.scene.${tool === 'aiChanges' ? 'changes' : tool}`, 'gm', async () => {
      const ms = await openTool(gm, /** @type {any} */ (tool), id);
      const shown = await gm.locator(`#${id} .window-title`).textContent();
      if (shown?.trim() !== title)
        throw new Error(`the window is titled "${shown}", not "${title}"`);
      await sweep.shot('gm', `window-${tool === 'aiChanges' ? 'changes' : tool}.png`);
      const broken = await gm.locator(`#${id} .fmb-ai-error`).allTextContents();
      if (broken.length) throw new Error(`the window shows an error: ${broken[0]}`);
      await closeWindow(gm, id);
      await resetControls(gm);
      return { note: `opened and loaded in ${ms} ms, closed with its X`, timings: { openMs: ms } };
    });
    await sweep.row(
      `foundry.scene.${tool === 'aiChanges' ? 'changes' : tool}`,
      'player',
      async () => {
        const has = await player.evaluate(windowId => !!document.getElementById(windowId), id);
        if (has) throw new Error(`a player has the ${title} window open`);
        return 'no tool and no window on a player screen';
      }
    );
  }
}

/**
 * The Changes window rows. Needs a kit monster with a token on the kit scene.
 * @param {import('./foundry-sweep.mjs').Sweep} sweep
 * @param {{t: any, gm: import('playwright-core').Page, player: import('playwright-core').Page}} ctx
 */
export async function changesRows(sweep, { t, gm }) {
  const monster = monsterOf(t.kit, 'beast');
  const sceneId = t.kit.scene.sceneId;
  const hp = () =>
    gm.evaluate(
      ([s, tok]) => game.scenes.get(s)?.tokens.get(tok)?.actor?.system?.attributes?.hp?.value,
      [sceneId, monster.tokenId]
    );
  const hp0 = await hp();
  if (!(hp0 >= 3)) throw new Error(`${monster.name} has ${hp0} HP; the sweep needs at least 3`);
  /** @type {string[]} */
  const open = [];
  /** What the put-back could not do, reported together at the end. @type {string[]} */
  const problems = [];
  const startedAt = new Date(Date.now() - 5000).toISOString();
  t.cleanup(async () => {
    // Every put-back is tried, newest first, whatever an earlier one did: a change that a row has
    // undone is not an error, and one refusal must not leave the other change applied.
    await runAll([...open].reverse().map(id => [`undo ${id}`, () => undoIfOpen(t, id)])).catch(
      err => problems.push(err.message)
    );
    // A redo from the window records a change of its own; anything of this run that is still
    // undoable on the monster is undone too (newest first), until the hit points are back.
    if ((await hp()) !== hp0) {
      const rest = listOf(await t.tool('list-recent-changes', { limit: 200 }), 'changes')
        .filter(
          c =>
            c.mode === 'apply' &&
            c.canUndo === true &&
            String(c.appliedAt) >= startedAt &&
            String(c.summary ?? '').includes(monster.name)
        )
        .sort((a, b) => String(b.appliedAt).localeCompare(String(a.appliedAt)));
      for (const c of rest) {
        if ((await hp()) === hp0) break;
        await t.guarded.undo(c.changeId).catch(err => problems.push(String(err?.message ?? err)));
      }
    }
    const now = await hp();
    if (now !== hp0) problems.push(`${monster.name} ended at ${now} HP, not ${hp0}`);
    if (problems.length) throw new Error(problems.join(' | '));
  });

  // An older change on the same thing first: the undo dialog of a change that was followed by another
  // one has more choices (Just this, Everything since).
  const damage = () =>
    t.tool('plan-actor-change', {
      action: 'damage',
      targets: [monster.name],
      amount: 1,
      damageType: 'bludgeoning',
    });
  const olderPlan = await damage();
  const olderApplied = await t.tool(
    'apply-planned-change',
    { planId: olderPlan.planId },
    { confirm: true }
  );
  open.push(olderApplied.changeId);
  const hpPre = hp0 - 1;
  t.check((await hp()) === hpPre, `${monster.name} lost 1 HP to the older change`);

  // A change the window can show and undo: 1 bludgeoning damage, planned and applied through the bridge.
  /** @type {{changeId: string}} */
  let change;
  const planStart = Date.now();
  const plan = await damage();
  const planMs = Date.now() - planStart;
  const applyStart = Date.now();
  const applied = await t.tool('apply-planned-change', { planId: plan.planId }, { confirm: true });
  const applyMs = Date.now() - applyStart;
  change = { changeId: applied.changeId };
  open.push(change.changeId);
  t.check((await hp()) === hpPre - 1, `${monster.name} lost 1 HP`);

  const shownMs = await openTool(gm, 'aiChanges', 'fmb-ai-changes');
  await waitRows(
    gm,
    rows => rows.some(r => r.id === change.changeId),
    'the new change in the window'
  );
  const toWindowMs = Date.now() - applyStart - applyMs;
  sweep.timings['guarded.planMs'] = planMs;
  sweep.timings['guarded.applyMs'] = applyMs;
  sweep.timings['guarded.applyToWindowMs'] = toWindowMs;
  sweep.timings['foundry.changes.openMs'] = shownMs;

  await sweep.row('foundry.changes.refresh', 'gm', async () => {
    const started = Date.now();
    await refresh(gm);
    const rows = await readRows(gm);
    if (!rows.length) throw new Error('the list is empty after Refresh');
    if (!rows.some(r => r.id === change.changeId)) throw new Error('the new change is not listed');
    return { note: `${rows.length} rows`, timings: { refreshMs: Date.now() - started } };
  });

  await sweep.row('foundry.changes.filter', 'gm', async () => {
    const options = await gm.evaluate(() =>
      [...document.querySelectorAll('#fmb-ai-changes select[data-fmb-filter] option')].map(
        o => /** @type {HTMLOptionElement} */ (o).value
      )
    );
    if (!options.includes('all') || !options.includes('ai')) {
      throw new Error(`the filter offers ${options.join(', ')}`);
    }
    const select = gm.locator(`${CHANGES} select[data-fmb-filter]`);
    await select.selectOption('ai');
    await waitLoaded(gm, 'fmb-ai-changes');
    await gm.waitForTimeout(400);
    const rows = await readRows(gm);
    const wrong = rows.filter(r => !/^AI/.test(r.meta));
    if (wrong.length) throw new Error(`the AI filter lists a row by ${wrong[0].meta}`);
    if (!rows.some(r => r.id === change.changeId))
      throw new Error('the AI change is not in the AI filter');
    await select.selectOption('all');
    await waitLoaded(gm, 'fmb-ai-changes');
    await gm.waitForTimeout(400);
    const all = await readRows(gm);
    if (all.length < rows.length) throw new Error('All lists fewer rows than AI');
    return `${options.length} options; AI lists ${rows.length} rows, All ${all.length}`;
  });

  await sweep.row('foundry.changes.more', 'gm', async () => {
    const more = gm.locator(`${CHANGES} button[data-action="more"]`);
    if (!(await more.count()))
      throw new Skip(
        'the list is one page or less (the window shows 20 rows first), so Show more is not offered; ' +
          'it runs in a world with more changes than that'
      );
    const before = (await readRows(gm)).length;
    await more.click();
    await waitRows(gm, rows => rows.length > before, 'more rows');
    const after = (await readRows(gm)).length;
    // Back to one page, so the later rows work with the same list.
    await refresh(gm);
    return `${before} rows, then ${after}`;
  });

  await sweep.row('foundry.changes.details', 'gm', async () => {
    const details = gm.locator(`${CHANGES} details.fmb-ai-details`).first();
    if (!(await details.count())) throw new Skip('no row has diff lines');
    await details.locator('summary').click();
    const open1 = await details.evaluate(el => /** @type {HTMLDetailsElement} */ (el).open);
    if (!open1) throw new Error('the details did not open');
    const id = await details.getAttribute('data-change-id');
    await refresh(gm);
    const stillOpen = await gm
      .locator(`${CHANGES} details.fmb-ai-details[data-change-id="${id}"]`)
      .evaluate(el => /** @type {HTMLDetailsElement} */ (el).open);
    if (!stillOpen) throw new Error('the details closed again after Refresh');
    await gm.locator(`${CHANGES} details.fmb-ai-details[data-change-id="${id}"] summary`).click();
    return 'opens and stays open through a Refresh';
  });

  /** What the older row's undo dialog showed. @type {{title: string, labels: string[], advanced: boolean, rewind: string} | null} */
  let older = null;
  await sweep.row('foundry.changes.undo-older', 'gm', async () => {
    const rows = await readRows(gm);
    const target = rows.find(r => r.id === olderApplied.changeId);
    if (!target?.actions.includes('undo'))
      throw new Error('the older change is not listed with an Undo button');
    const before = rows.length;
    await gm
      .locator(`${CHANGES} .fmb-ai-row[data-change-id="${target.id}"] [data-action="undo"]`)
      .click();
    const dialog = await readDialog(gm);
    await sweep.shot('gm', 'changes-undo-dialog.png');
    const advanced = await gm
      .locator('.application.dialog')
      .last()
      .evaluate(el => ({
        summary: el.querySelector('details.fmb-ai-advanced > summary')?.textContent?.trim() ?? '',
        rewind:
          /** @type {HTMLElement | null} */ (
            el.querySelector('[data-choice="rewind"]')
          )?.textContent?.trim() ?? '',
      }));
    older = {
      title: dialog.title,
      labels: dialog.labels,
      advanced: advanced.summary === 'Advanced',
      rewind: advanced.rewind,
    };
    if (dialog.title !== 'Undo change') throw new Error(`the dialog is titled "${dialog.title}"`);
    if (!dialog.actions.includes('cancel')) throw new Error('the dialog has no Cancel');
    // The older change has a later change after it: the dialog offers both ways and Cancel.
    const missing = ['just-this', 'everything-since'].filter(a => !dialog.actions.includes(a));
    if (missing.length)
      throw new Error(
        `the dialog lacks ${missing.join(', ')} (it offers ${dialog.actions.join(', ')})`
      );
    const choices = dialog.actions.filter(a => a !== 'cancel');
    await answerNo(gm);
    await refresh(gm);
    if ((await readRows(gm)).length !== before) throw new Error('Cancel changed the list');
    return `"${dialog.title}": ${dialog.labels.join(' / ')} (${choices.join(', ') || 'no other choice'}); Cancel changed nothing`;
  });
  await sweep.row('foundry.changes.undo-advanced', 'gm', async () => {
    if (!older) throw new Skip('the undo dialog of an older change was not read');
    const seen = /** @type {NonNullable<typeof older>} */ (older);
    if (!seen.advanced) throw new Error('the undo dialog has no Advanced section');
    if (!/Rewind the whole table/.test(seen.rewind)) {
      throw new Error(`the Advanced button reads "${seen.rewind}"`);
    }
    return `"${seen.rewind}" is offered under Advanced and was not clicked`;
  });

  // --- The guarded write path: undo and redo from the window -------------------------------------
  await sweep.row('foundry.changes.undo', 'gm', async () => {
    const selector = `${CHANGES} .fmb-ai-row[data-change-id="${change.changeId}"]`;
    await gm.locator(`${selector} [data-action="undo"]`).click();
    const dialog = await readDialog(gm);
    if (dialog.title !== 'Undo change') throw new Error(`the dialog is titled "${dialog.title}"`);
    if (!dialog.text.includes(monster.name)) {
      throw new Error(`the dialog does not name ${monster.name}: ${dialog.text.slice(0, 120)}`);
    }
    await answerNo(gm);
    if ((await hp()) !== hpPre - 1) throw new Error('Cancel changed the hit points');
    await gm.locator(`${selector} [data-action="undo"]`).click();
    await readDialog(gm);
    const started = Date.now();
    await answerYes(gm, 'Undo');
    await waitNotification(gm, /Undone:/);
    const ms = Date.now() - started;
    if ((await hp()) !== hpPre)
      throw new Error(`${monster.name} has ${await hp()} HP after Undo, not ${hpPre}`);
    await waitRows(
      gm,
      rows => /undone/.test(rows.find(r => r.id === change.changeId)?.meta ?? ''),
      'the row to say it is undone'
    );
    return {
      note: `${monster.name} ${hpPre - 1} -> ${hpPre} HP; Cancel changed nothing; the row says undone`,
      timings: { undoMs: ms },
    };
  });

  await sweep.row('foundry.changes.redo', 'gm', async () => {
    const selector = `${CHANGES} .fmb-ai-row[data-change-id="${change.changeId}"]`;
    const row = (await readRows(gm)).find(r => r.id === change.changeId);
    if (!row?.actions.includes('redo'))
      throw new Skip(`the undone row offers ${row?.actions.join(', ') || 'nothing'}`);
    await gm.locator(`${selector} [data-action="redo"]`).click();
    const dialog = await readDialog(gm);
    if (dialog.title !== 'Redo change') throw new Error(`the dialog is titled "${dialog.title}"`);
    await answerNo(gm);
    if ((await hp()) !== hpPre) throw new Error('Cancel changed the hit points');
    await gm.locator(`${selector} [data-action="redo"]`).click();
    await readDialog(gm);
    const started = Date.now();
    await answerYes(gm, 'Redo');
    await waitNotification(gm, /Redone:/);
    const ms = Date.now() - started;
    if ((await hp()) !== hpPre - 1)
      throw new Error(`${monster.name} has ${await hp()} HP after Redo, not ${hpPre - 1}`);
    return {
      note: `${monster.name} ${hpPre} -> ${hpPre - 1} HP; Cancel changed nothing`,
      timings: { redoMs: ms },
    };
  });

  // A window that will not close is a failure of the step, not something to hide.
  await closeWindow(gm, 'fmb-ai-changes');
  await resetControls(gm);
}
