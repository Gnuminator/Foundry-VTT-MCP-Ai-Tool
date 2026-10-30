/**
 * The rows of the `foundry-controls` sweep that happen at the table: the campaign status toggle in a
 * journal, the roll request card in the chat, and what a player must not be able to call. Also the
 * player rows for every GM-only control that no other area checks on its own.
 */
import { KIT_FLAG_KEY, KIT_FLAG_SCOPE } from './contract.mjs';
import { playerHero } from './helpers.mjs';
import { FOUNDRY_CONTROLS } from './foundry-controls.mjs';
import { Skip, until, waitNotification } from './foundry-sweep.mjs';

const TOGGLE_PAGE = 'Sweep status toggle';
const WINDOW_IDS = ['fmb-ai-changes', 'fmb-handouts', 'fmb-tarokka'];
// What a locked query says: Foundry's own "not registered" for a name no client registers (the bridge
// handlers are private), the module's "helper queries are GM-only" for the GM helper queries.
const REFUSED = /not registered|not a registered|GM-only/i;

/**
 * The campaign status toggle of a campaign dashboard journal: the GM's click cycles it and saves it
 * on the journal; a player's click is refused with a warning and saves nothing.
 * @param {import('./foundry-sweep.mjs').Sweep} sweep
 * @param {{t: any, gm: import('playwright-core').Page, player: import('playwright-core').Page}} ctx
 */
export async function journalRows(sweep, { t, gm, player }) {
  const made = await gm.evaluate(
    async ([scope, key, pageName]) => {
      const entry = await JournalEntry.create({
        name: 'Sweep status toggle',
        ownership: { default: 2 },
        flags: { [scope]: { [key]: true } },
        pages: [
          {
            name: pageName,
            type: 'text',
            text: {
              format: 1,
              content:
                '<h1>Campaign Dashboard</h1><div class="campaign-status-toggle not-started" ' +
                'data-campaign-id="sweep" data-part-id="part1">not started</div>',
            },
          },
        ],
      });
      return { id: entry.id };
    },
    [KIT_FLAG_SCOPE, KIT_FLAG_KEY, TOGGLE_PAGE]
  );
  t.cleanup(async () => {
    await gm.evaluate(id => game.journal.get(id)?.delete(), made.id);
  });
  const flag = () =>
    gm.evaluate(id => game.journal.get(id)?.getFlag('world', 'campaignStatus') ?? null, made.id);
  const open = async (/** @type {import('playwright-core').Page} */ page) => {
    await page.evaluate(async id => {
      await game.journal.get(id).sheet.render({ force: true });
    }, made.id);
    const toggle = page.locator('.campaign-status-toggle').first();
    await toggle.waitFor({ state: 'visible', timeout: 10000 });
    return toggle;
  };
  const close = (/** @type {import('playwright-core').Page} */ page) =>
    page.evaluate(async id => {
      await game.journal.get(id)?.sheet?.close({ animate: false });
    }, made.id);

  await sweep.row('module.campaign.status-toggle', 'gm', async () => {
    await open(gm);
    await gm.waitForTimeout(400);
    // Saving the flag redraws the sheet, so the toggle is looked up again after each click.
    const toggle = () => gm.locator('.campaign-status-toggle').first();
    const classOf = async () => (await toggle().getAttribute('class')) ?? '';
    await toggle().click();
    await until(
      async () => (await flag())?.['sweep-part1'] === 'in_progress',
      'the saved status "in_progress"'
    );
    await until(
      async () => /in-progress/.test(await classOf()),
      'the toggle to show "in progress"'
    );
    await toggle().click();
    await until(
      async () => (await flag())?.['sweep-part1'] === 'completed',
      'the saved status "completed"'
    );
    await until(async () => /completed/.test(await classOf()), 'the toggle to show "completed"');
    await close(gm);
    return 'a click cycles not started, in progress, completed, and saves each on the journal';
  });
  await sweep.row('module.campaign.status-toggle', 'player', async () => {
    const before = JSON.stringify(await flag());
    const toggle = await open(player);
    await player.waitForTimeout(400);
    await toggle.click();
    await waitNotification(player, /Only GMs can modify campaign progress/);
    if (JSON.stringify(await flag()) !== before)
      throw new Error('a player changed the saved status');
    await close(player);
    return 'a player is told "Only GMs can modify campaign progress" and nothing is saved';
  });
}

/**
 * The roll request card: a roll requested for the kit player's hero shows a button to the player; the
 * click rolls and rewrites the card with who rolled. The chat messages are deleted afterwards.
 * @param {import('./foundry-sweep.mjs').Sweep} sweep
 * @param {{t: any, gm: import('playwright-core').Page, player: import('playwright-core').Page}} ctx
 */
export async function chatRows(sweep, { t, gm, player }) {
  const hero = playerHero(t.kit);
  const label = 'STR Ability Check (Public)';
  const messageIds = () =>
    gm.evaluate(
      text =>
        game.messages
          .filter(m => (m.content ?? '').includes(text) || (m.flavor ?? '').includes(text))
          .map(m => m.id),
      label
    );
  t.cleanup(async () => {
    const ids = await messageIds();
    await gm.evaluate(async list => {
      for (const id of list) await game.messages.get(id)?.delete();
    }, ids);
  });
  await player.evaluate(() => ui.sidebar.changeTab('chat', 'primary'));
  await gm.evaluate(() => ui.sidebar.changeTab('chat', 'primary'));

  await sweep.row('module.chat.roll-button', 'gm', async () => {
    await t.tool(
      'request-ability-check',
      { targetPlayer: hero.name, ability: 'str', isPublic: true },
      { confirm: true }
    );
    const button = gm.locator('.mcp-roll-button', { hasText: 'STR Ability Check' }).last();
    await button.waitFor({ state: 'attached', timeout: 15000 });
    const info = await button.evaluate(b => ({
      formula: /** @type {HTMLElement} */ (b).dataset.rollFormula ?? '',
      active: b.classList.contains('mcp-button-active'),
    }));
    if (!/^1d20/.test(info.formula)) throw new Error(`the button rolls "${info.formula}"`);
    return `the GM sees the card for ${hero.name}, rolling ${info.formula}`;
  });

  await sweep.row('module.chat.roll-button', 'player', async () => {
    const button = player.locator('.mcp-roll-button', { hasText: 'STR Ability Check' }).last();
    await button.waitFor({ state: 'visible', timeout: 15000 });
    const before = (await messageIds()).length;
    // Counted before the click: a card or a roll left by an earlier run must not pass for this one.
    const completedCards = () =>
      player.evaluate(
        () =>
          [...document.querySelectorAll('.message-content')].filter(e =>
            /Completed by/.test(e.textContent ?? '')
          ).length
      );
    const rollMessages = () =>
      gm.evaluate(
        () =>
          game.messages.contents.filter(m => m.isRoll && /Ability Check/i.test(m.flavor ?? ''))
            .length
      );
    const cardsBefore = await completedCards();
    const rollsBefore = await rollMessages();
    const started = Date.now();
    await button.click();
    await until(async () => (await completedCards()) > cardsBefore, 'the card to say who rolled');
    const ms = Date.now() - started;
    const text = await player.evaluate(() => {
      const el = [...document.querySelectorAll('.message-content')]
        .filter(e => /Completed by/.test(e.textContent ?? ''))
        .pop();
      return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    });
    if (!/Kit Player/.test(text)) throw new Error(`the card says "${text.slice(0, 120)}"`);
    if ((await rollMessages()) <= rollsBefore)
      throw new Error('no new roll message was posted to the chat');
    if ((await messageIds()).length < before) throw new Error('the request card is gone');
    return {
      note: `the player rolled; the card now reads "${text.slice(0, 80)}"`,
      timings: { rollMs: ms },
    };
  });
}

/**
 * A player cannot call the bridge: the module's queries are registered for the GM's bridge only.
 * @param {import('./foundry-sweep.mjs').Sweep} sweep
 * @param {{gm: import('playwright-core').Page, player: import('playwright-core').Page}} ctx
 */
export async function playerQueryRows(sweep, { gm, player }) {
  await sweep.row(
    'foundry.player.queries-locked',
    'player',
    async () => {
      // Positive control: the GM's client does register the helper query, so a refusal below is
      // the player being locked out and not a query that was never there.
      const registered = await gm.evaluate(
        () => typeof CONFIG.queries?.['foundry-mcp-bridge.gm.openDocument'] === 'function'
      );
      if (!registered) throw new Error('the GM client has no gm.openDocument query registered');
      const outcome = await player.evaluate(async () => {
        const gm = game.users.activeGM;
        if (!gm) return { skip: 'no GM is connected' };
        const results = {};
        for (const name of [
          'foundry-mcp-bridge.getWorldInfo',
          'foundry-mcp-bridge.gm.openDocument',
        ]) {
          try {
            await gm.query(name, {}, { timeout: 5000 });
            results[name] = 'answered';
          } catch (error) {
            results[name] = `refused: ${String(error?.message ?? error).slice(0, 160)}`;
          }
        }
        return results;
      });
      if (outcome.skip) throw new Skip(String(outcome.skip));
      const answered = Object.entries(outcome).filter(([, v]) => v === 'answered');
      if (answered.length)
        throw new Error(`a player got an answer from ${answered.map(a => a[0]).join(', ')}`);
      // A refusal is Foundry saying the query is not registered, or the module saying GM-only. A
      // timeout or any other error is not a lock (nothing may be listening at all).
      const other = Object.entries(outcome).filter(([, v]) => !REFUSED.test(String(v)));
      if (other.length) {
        throw new Error(
          `not a refusal by a lock: ${other.map(([k, v]) => `${k} ${v}`).join('; ')}`
        );
      }
      return Object.entries(outcome)
        .map(([k, v]) => `${k.replace('foundry-mcp-bridge.', '')} ${v}`)
        .join('; ');
    },
    { expectErrors: [REFUSED] }
  );
}

/**
 * For every GM-only control without a player row yet: a player's screen has no entry point to it.
 * @param {import('./foundry-sweep.mjs').Sweep} sweep
 * @param {{player: import('playwright-core').Page}} ctx
 * @param {(area: string) => boolean} wanted
 */
export async function playerHiddenRows(sweep, { player }, wanted) {
  for (const control of FOUNDRY_CONTROLS) {
    if (control.player !== 'hidden' || !wanted(control.area)) continue;
    if (sweep.results.some(r => r.name === control.name && r.who === 'player')) continue;
    await sweep.row(control.name, 'player', async () => {
      const seen = await player.evaluate(ids => {
        const windows = ids.filter(id => document.getElementById(id));
        const group = Object.keys(ui.controls?.controls ?? {}).includes('aiTool');
        const settingsTab = [...document.querySelectorAll('[data-tab="foundry-mcp-bridge"]')]
          .length;
        return { windows, group, settingsTab };
      }, WINDOW_IDS);
      if (seen.windows.length || seen.group || seen.settingsTab) {
        throw new Error(`a player has ${JSON.stringify(seen)}`);
      }
      return 'no AI Tool group, no window and no module settings tab on a player screen';
    });
  }
}
