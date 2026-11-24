/**
 * The dashboard's live strip (`/next/?strip=1`) driven against real Foundry during the kit's boss
 * combat. Every flow clicks the real control, then reads Foundry itself (combat state, chat, the
 * reveal queue) to see the change is really there:
 *
 *   next turn; a timed condition (1 round + Prone) added and taken off again; a monster action;
 *   a quick roll with "Post results to chat"; show the next handout and Undo it.
 *
 * Put-back: the combat is ended, every guarded change applied after the scenario started and still
 * undoable is undone (newest first), the queued handout page and the strip's roll round are left
 * as they were, and GM Actions go back. The throwaway handout journal and the kit party group stay
 * in the kit world (same names as dashboard-write-flows, reused on the next run).
 *
 * A real browser is needed: skipped against the fake. The /gm page (Foundry beside the strip) is
 * checked at the end when the dashboard knows where Foundry is.
 */
import { KIT_PLAYER_USER } from '../lib/contract.mjs';
import { SkipError } from '../lib/errors.mjs';
import { listOf, tokenHeroes, waitFor } from '../lib/helpers.mjs';
import { confirmModal, markToasts, squash } from '../lib/dashboard-page.mjs';

const VIEWPORT = { width: 1440, height: 1000 };
const HANDOUT_JOURNAL = 'Kit dashboard handout test (safe to delete)';
const HANDOUT_PAGE = 'Kit Handout';
const PUT_BACK_CAP = 50;
const STRIP = '/next/?strip=1';

/** @type {import('../lib/contract.mjs').Scenario} */
export default {
  id: 'dashboard-live-strip',
  title:
    'The live strip against real Foundry in the boss combat: next turn, conditions, monster action, quick roll, handout, Undo',
  sizes: ['full', 'long'],
  tags: ['dashboard'],
  needs: ['heroes', 'monsters', 'scene'],
  tools: [
    'get-combat-state',
    'get-chat-log',
    'mark-play-session',
    'get-recent-events',
    'get-party',
    'list-recent-changes',
    'list-journals',
    'create-quest-journal',
    'list-revealed-pages',
    'plan-page-reveal',
    'roll-saving-throws',
  ],
  gmActions: ['startCombat', 'endCombats', 'targetToken', 'ensurePartyGroup', 'setFeatureSwitches'],
  order: 11,
  timeoutMs: 600000,

  async run(t) {
    if (!t.browser) {
      await t.step('needs a real browser', async () =>
        t.skip('needs a real browser (t.browser is null against the fake)')
      );
      return;
    }
    const browser = t.browser;
    const startedAt = new Date(Date.now() - 5000).toISOString();
    const boss = t.kit?.monsters?.find(m => m.cell === 'legendary' && m.tokenId);
    // The player's own hero: the strip only treats a character a player owns as a PC (a roll can be asked).
    const heroes = t.kit ? tokenHeroes(t.kit) : [];
    const hero = heroes.find(h => h.owner);
    const sceneId = t.kit?.scene?.sceneId;
    if (!boss || !hero || !sceneId) {
      await t.step('the boss combat needs a kit scene', async () =>
        t.skip('no kit scene with a legendary monster and a player-owned hero token')
      );
      return;
    }
    /** @type {import('playwright-core').Page} */
    let page;
    /** @type {Array<() => Promise<void>>} */
    const late = [];

    const shot = async (/** @type {string} */ name) => {
      try {
        t.attachFile(name, await page.screenshot());
      } catch {
        /* the page is gone; the step says why */
      }
    };
    const state = () => t.tool('get-combat-state', {});
    const combatant = async (/** @type {string} */ name) =>
      (await state()).combatants?.find((/** @type {any} */ c) => c.name === name);
    const conditionsOf = async (/** @type {string} */ name) =>
      ((await combatant(name))?.conditions ?? []).map((/** @type {string} */ c) => c.toLowerCase());
    const chatText = async (/** @type {number} */ limit = 15) =>
      JSON.stringify(await t.tool('get-chat-log', { limit }));
    const changesSince = async () =>
      listOf(await t.tool('list-recent-changes', { limit: 50 }), 'changes')
        .filter(
          c => c.mode === 'apply' && c.canUndo === true && String(c.appliedAt) >= startedAt
        )
        .sort((a, b) => String(b.appliedAt).localeCompare(String(a.appliedAt)));
    /** Presses a strip control and settles what it asks: a confirm window is confirmed. */
    const press = async (/** @type {import('playwright-core').Locator} */ control) => {
      await markToasts(page);
      await control.click();
      // A control that plans first opens a confirm window; the rest write at once and open none.
      const opened = await page
        .locator('#modal-backdrop')
        .waitFor({ state: 'visible', timeout: 8000 })
        .then(() => true)
        .catch(() => false);
      if (opened) await confirmModal(page);
    };
    const pickBoss = () => page.getByRole('button', { name: boss.name, exact: true });
    const pickHero = () => page.getByRole('button', { name: hero.name, exact: true });

    /**
     * One flow: a step with a screenshot and a check that the page logged no new console error.
     * @param {string} label @param {string} file @param {() => Promise<string | void>} fn
     */
    const flow = async (label, file, fn) => {
      const before = browser.consoleErrors(page).length;
      await t.step(label, async () => {
        try {
          const detail = await fn();
          const fresh = browser.consoleErrors(page).slice(before);
          t.check(
            fresh.length === 0,
            'the page logged new console errors',
            fresh.map(e => e.message.slice(0, 200))
          );
          return detail;
        } finally {
          await shot(file);
        }
      });
    };

    // --- set up -------------------------------------------------------------------------------

    await t.step('GM Actions on, the party group there, the boss combat started', async () => {
      const tools = await t.http('/api/tools');
      const gmWasOn = tools.status === 200 && tools.data?.gmActionsEnabled === true;
      if (!gmWasOn) {
        t.cleanup(async () => {
          await t.http('/api/control', {
            method: 'POST',
            body: { action: 'set-gm-actions', value: false },
          });
        });
        await t.http('/api/control', {
          method: 'POST',
          body: { action: 'set-gm-actions', value: true },
        });
      }
      const { before } = await t.gm('setFeatureSwitches', {
        switches: { handouts: true, party: true },
      });
      t.cleanup(async () => {
        await t.gm('setFeatureSwitches', { switches: before });
      });
      if (!listOf(await t.tool('get-party', {}), 'groups')[0]) {
        const memberIds = tokenHeroes(t.kit)
          .slice(0, 4)
          .map(h => h.actorId);
        await t.gm('ensurePartyGroup', { name: 'Kit Party', memberIds });
      }
      // Cleanups run last in, first out: the combat ends last, so the undo below still has it.
      t.cleanup(async () => {
        await t.gm('endCombats');
      });
      // The handout queue and reveal clean-ups the handout flow registers.
      t.cleanup(async () => {
        for (const fn of [...late].reverse()) await fn();
      });
      // Undo everything the flows applied, newest first; a change already taken back is skipped.
      t.cleanup(async () => {
        const skipped = new Set();
        for (let i = 0; i < PUT_BACK_CAP; i++) {
          const change = (await changesSince()).find(c => !skipped.has(c.changeId));
          if (!change) break;
          try {
            await t.guarded.undo(change.changeId);
          } catch (e) {
            if (!/Conflict, nothing was written/.test(String(e?.message ?? e))) throw e;
            skipped.add(change.changeId);
          }
        }
        const left = await conditionsOf(hero.name).catch(() => []);
        t.check(!left.includes('prone'), 'the hero is not left prone', left);
      });
      // The roll status under the quick roll bar is built from the play session's events.
      const marked = await t.tool('mark-play-session', {
        action: 'start',
        note: 'test kit live strip',
      });
      t.check(marked.success === true, 'mark-play-session start', marked);
      t.cleanup(async () => {
        await t.tool('mark-play-session', { action: 'end', note: 'test kit live strip' });
      });
      await t.gm('startCombat', { sceneId, tokenIds: [boss.tokenId, hero.tokenId] });
      const s = await state();
      t.check(s.active === true, 'the combat is active in Foundry', s);
      return `${boss.name} and ${hero.name} in combat; GM Actions ${gmWasOn ? 'were on' : 'turned on'}`;
    });

    await t.step('open the live strip on the combat', async () => {
      page = await browser.open(STRIP, { viewport: VIEWPORT });
      await page.locator('#live-strip').waitFor({ state: 'visible', timeout: 20000 });
      await page.locator('#live-strip li[data-id]').first().waitFor({ timeout: 30000 });
      t.equal(
        await page.locator('#live-strip li[data-id]').count(),
        2,
        'the strip shows the two combatants'
      );
      await shot('strip-open.png');
      return squash(await page.locator('#live-meta').textContent());
    });

    // --- next turn ----------------------------------------------------------------------------

    await flow('Next turn moves the turn in Foundry', 'flow-next-turn.png', async () => {
      const before = await state();
      await press(page.locator('#live-next-turn'));
      const after = await waitFor(
        async () => {
          const s = await state();
          return s.round !== before.round || s.turn !== before.turn ? s : null;
        },
        { label: 'the turn to move in Foundry', timeoutMs: 20000 }
      );
      t.check(
        after.current?.name !== before.current?.name || after.round > before.round,
        'the turn passed to someone else',
        { before: before.current?.name, after: after.current?.name }
      );
      await page.waitForFunction(
        name => document.querySelector('#live-meta')?.textContent?.includes(`${name}'s turn`),
        after.current?.name,
        { timeout: 15000 }
      );
      return `${before.current?.name} to ${after.current?.name}, round ${after.round}`;
    });

    // --- a timed condition, then taken off ----------------------------------------------------

    await flow(
      'A 1 round Prone is added to the hero and taken off again',
      'flow-condition.png',
      async () => {
        t.check(!(await conditionsOf(hero.name)).includes('prone'), 'the hero starts not prone');
        await pickHero().click();
        await page.getByRole('button', { name: /1 round/ }).click();
        await press(page.locator('button[data-condition="prone"]'));
        await waitFor(async () => ((await conditionsOf(hero.name)).includes('prone') ? true : null), {
          label: 'Prone on the hero in Foundry',
        });
        const row = await combatant(hero.name);
        t.equal(row?.timed?.Prone ?? row?.timed?.prone, 1, 'Prone lasts 1 round in Foundry');
        const chip = page.getByRole('button', { name: /Prone, .*take off/ });
        await chip.waitFor({ timeout: 15000 });
        await press(chip);
        await waitFor(async () => ((await conditionsOf(hero.name)).includes('prone') ? null : true), {
          label: 'Prone gone from the hero in Foundry',
        });
        return 'Prone added for 1 round and taken off';
      }
    );

    // --- a monster action ---------------------------------------------------------------------

    await flow('A monster action rolls in Foundry', 'flow-monster-action.png', async () => {
      // The action buttons show for the one monster picked in the strip.
      await pickBoss().click();
      const actions = page.locator('#live-actions [data-track="dash.live.monster-action"]');
      await actions.first().waitFor({ timeout: 20000 });
      const name = (await actions.first().getAttribute('data-action')) ?? '';
      // The action rolls against the creature the GM targets in Foundry (T on the map).
      const targeted = await t.gm('targetToken', { sceneId, tokenId: hero.tokenId });
      t.equal(targeted.targeted, [hero.tokenId], 'Foundry targets the hero');
      t.cleanup(async () => {
        await t.gm('targetToken', { sceneId });
      });
      const bossChat = async () =>
        JSON.stringify(await t.tool('get-chat-log', { limit: 15, speakerName: boss.name }));
      const chatBefore = await bossChat();
      await press(actions.first());
      await page.waitForFunction(
        () => {
          const line = document.querySelector('#live-action-result')?.textContent ?? '';
          return line.trim() !== '' && !/^\.\.\.|^Rolling/i.test(line.trim());
        },
        undefined,
        { timeout: 30000 }
      );
      const line = squash(await page.locator('#live-action-result').textContent());
      t.check(!line.startsWith('✗'), `the action line says "${line}"`);
      const chatAfter = await waitFor(
        async () => {
          const text = await bossChat();
          return text !== chatBefore ? text : null;
        },
        { label: `a new chat message from ${boss.name} (action line: ${line})` }
      );
      t.attach('boss-chat', chatAfter.slice(0, 2000));
      return `${name}: ${line}`;
    });

    // --- a quick roll, with Post results ------------------------------------------------------

    await flow('A quick roll is asked, answered and posted to chat', 'flow-quick-roll.png', async () => {
      // A roll request only goes to a player who is online: the kit player joins Foundry.
      if (!t.joinFoundry) throw new SkipError('no second Foundry browser to join as the kit player');
      const player = await t.joinFoundry(KIT_PLAYER_USER);
      t.cleanup(() => player.close());
      await page.locator('#live-roll-what').selectOption('save:dex');
      await press(page.locator('#live-roll-party'));
      const status = page.locator('[data-testid="roll-status"]');
      await status.waitFor({ timeout: 30000 });
      t.check(/waiting/i.test((await status.textContent()) ?? ''), 'the roll shows as waiting');
      // The player rolls it as a player would: from their own character, in their own browser.
      const rolled = await player.page.evaluate(async actorId => {
        const actor = game.actors.get(actorId);
        if (!actor) return { error: `the player cannot see actor ${actorId}` };
        const rolls = await actor.rollSavingThrow(
          { ability: 'dex' },
          { configure: false },
          { create: true }
        );
        return { total: rolls?.[0]?.total ?? null };
      }, hero.actorId);
      t.check(rolled.total !== null && !rolled.error, 'the player rolled the save', rolled);
      t.attach('recent-events', await t.tool('get-recent-events', { limit: 8 }));
      t.attach('roll-status-text', await status.textContent());
      await page.waitForFunction(
        () => /: (all \d+ )?rolled/i.test(document.querySelector('[data-testid="roll-status"]')?.textContent ?? ''),
        undefined,
        { timeout: 30000 }
      );
      const chatBefore = await chatText();
      await press(page.getByRole('button', { name: 'Post results to chat' }));
      await page.getByRole('button', { name: 'Posted to chat' }).waitFor({ timeout: 20000 });
      const chatAfter = await waitFor(
        async () => {
          const text = await chatText();
          return text !== chatBefore && text.includes(hero.name) ? text : null;
        },
        { label: 'the results line in Foundry chat' }
      );
      t.check(chatAfter.length > 0, 'the results are in Foundry chat');
      return squash(await status.textContent());
    });

    // --- show the next handout, then Undo it --------------------------------------------------

    await flow('Show next handout reveals the page, Undo hides it again', 'flow-handout-undo.png', async () => {
      let journal = listOf(await t.tool('list-journals', {}), 'journals').find(
        j => j.name === HANDOUT_JOURNAL
      );
      if (!journal) {
        await t.tool('create-quest-journal', {
          questTitle: HANDOUT_JOURNAL,
          questDescription: 'Harmless test data for the test kit. Safe to delete.',
          additionalPages: [
            { name: HANDOUT_PAGE, content: '<p>Kit handout text. Nothing to see here.</p>' },
          ],
        });
        journal = listOf(await t.tool('list-journals', {}), 'journals').find(
          j => j.name === HANDOUT_JOURNAL
        );
      }
      const source = (journal?.pages ?? []).find((/** @type {any} */ p) => p.name === HANDOUT_PAGE);
      if (!journal || !source) throw new SkipError('the handout test journal could not be made');
      const pageUuid = `JournalEntry.${journal.id}.JournalEntryPage.${source.id}`;
      const copies = async () =>
        listOf(await t.tool('list-revealed-pages', {}), 'pages').filter(
          p => p.copiedFrom === pageUuid || p.uuid === pageUuid
        );
      const queued = async () =>
        listOf(await t.tool('list-revealed-pages', {}), 'queue').some(q => q.uuid === pageUuid);
      late.push(async () => {
        if (await queued().catch(() => false)) {
          await t.tool('plan-page-reveal', { pageUuid, action: 'unqueue' }).catch(() => {});
        }
      });
      late.push(async () => {
        if ((await copies()).length) {
          await t.guarded.planApply('plan-page-reveal', { pageUuid, action: 'hide' }).catch(() => {});
        }
      });
      if (await queued()) await t.tool('plan-page-reveal', { pageUuid, action: 'unqueue' });
      t.check((await copies()).length === 0, 'the test page starts hidden');
      await t.tool('plan-page-reveal', { pageUuid, action: 'queue' });
      t.check(await queued(), 'the page is on the reveal queue');
      // The strip reads the queue when it loads (15 s stale time): load it again.
      await page.reload();
      await page.locator('#live-strip li[data-id]').first().waitFor({ timeout: 30000 });
      await page.waitForFunction(
        title => document.querySelector('#live-handout')?.textContent?.includes(title),
        HANDOUT_PAGE,
        { timeout: 20000 }
      );
      await press(page.locator('#live-show-handout'));
      await waitFor(async () => ((await copies()).length > 0 ? true : null), {
        label: 'the page revealed in Foundry',
      });
      // Undo: the strip's own button, newest change, one confirm.
      const undo = page.locator('#live-undo');
      await page.waitForFunction(
        () => !/Nothing to undo/.test(document.querySelector('#live-undo')?.textContent ?? ''),
        undefined,
        { timeout: 20000 }
      );
      await press(undo);
      await waitFor(async () => ((await copies()).length === 0 ? true : null), {
        label: 'the page hidden again in Foundry',
      });
      return 'revealed in Foundry, then hidden again by the strip Undo';
    });

    // --- the /gm page -------------------------------------------------------------------------

    await t.step('the /gm page carries the strip beside Foundry', async () => {
      const info = await t.http('/api/gm-page');
      if (info.status !== 200 || !info.data?.foundryUrl) {
        t.skip('the dashboard does not know where Foundry is (DASHBOARD_FOUNDRY_URL), /gm has no frame');
      }
      // The kit's Foundry is not reached through the Cloudflare frame proxy, so Foundry's own
      // frame refusal is expected here: the page is opened with its console errors not counted.
      const gm = await browser.open('/gm', { viewport: VIEWPORT, expectErrors: true });
      await gm.locator('#live-strip').waitFor({ state: 'visible', timeout: 30000 });
      const frames = gm.frames().filter(f => f !== gm.mainFrame());
      t.check(frames.length > 0, 'Foundry is framed beside the strip');
      t.check(
        (await gm.locator('#live-strip li[data-id]').count()) >= 1,
        'the strip shows the combat on /gm'
      );
      try {
        t.attachFile('gm-page.png', await gm.screenshot());
      } catch {
        /* optional */
      }
    });
  },
};
