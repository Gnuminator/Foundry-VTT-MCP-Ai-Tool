/**
 * The dashboard's write flows, clicked in a real browser (slice 4). Every flow drives the REAL page
 * (the tool runner form, the confirm window, the toast Undo, Recent Changes Undo, the Tarokka, Party and
 * Handouts drawers, the player links, the Everyone tab's undo window and Redo), then reads Foundry (or
 * the bridge) to see that the change is really there, undoes it, and reads again to see that it is
 * exactly gone. Each flow is one step that goes on after a failure, checks the page logged no new
 * console error, and attaches one screenshot.
 *
 * Put-back: every guarded change applied after the scenario started and still undoable is undone at
 * the end (newest first; not an undo the undo-window flows applied and kept, see `keep`), the reveal
 * queue entry and the player link this scenario made are removed,
 * and GM Actions and the drawers' feature switches (FLOW_FEATURES, switched on for the run) go back to
 * what they were. The throwaway handout journal and the kit party group stay in the kit world (named in
 * HANDOUT_JOURNAL and PARTY_GROUP; reused on the next run, a rebuild wipes the group).
 *
 * A flow that needs something the world still lacks (a switch this run does not manage, a player who
 * already has a link) is skipped with the reason; a refusal that names a switch the run turned on
 * itself (FLOW_FEATURES, GM Actions) fails the flow. A real browser is needed: skipped against the fake.
 */
import { randomBytes } from 'node:crypto';
import { KIT_PLAYER_USER } from '../lib/contract.mjs';
import { SkipError } from '../lib/errors.mjs';
import { listOf, tokenHeroes, waitFor } from '../lib/helpers.mjs';
import {
  Refused,
  closeTools,
  confirmModal,
  gmActionsLabelOn,
  isSwitchedOff,
  markToasts,
  menuClick,
  openCard,
  openToolForm,
  readModal,
  resetUi,
  settleWrite,
  showDuring,
  squash,
  submitToolForm,
  undoFromToast,
  waitReady,
  waitToast,
} from '../lib/dashboard-page.mjs';

const VIEWPORT = { width: 1440, height: 1000 };
const HANDOUT_JOURNAL = 'Kit dashboard handout test (safe to delete)';
const HANDOUT_PAGE = 'Kit Handout';
const PARTY_GROUP = 'Kit Party';
/** The guarded features the drawer flows write through. */
const FLOW_FEATURES = ['tarokka', 'handouts', 'party'];
/** The switches this run turns on itself: a refusal that names one of them fails the flow. */
const RUN_SWITCHES = [...FLOW_FEATURES, 'GM Actions'];
/** The most undos the put-back makes (a guard against a change that never leaves the list). */
const PUT_BACK_CAP = 50;

/** @type {import('../lib/contract.mjs').Scenario} */
export default {
  id: 'dashboard-write-flows',
  title:
    'The dashboard write flows, clicked in a real browser: confirm, undo, Tarokka, party, handouts, notes, links',
  sizes: ['full', 'long'],
  tags: ['dashboard'],
  needs: ['heroes', 'scene'],
  tools: [
    'list-recent-changes',
    'list-changes',
    'plan-undo-changes',
    'plan-actor-change',
    'plan-scene-change',
    'apply-planned-change',
    'get-planned-change',
    'undo-change',
    'list-ref-choices',
    'get-tarokka-reading',
    'plan-tarokka-import',
    'get-party',
    'plan-party-change',
    'create-quest-journal',
    'list-journals',
    'list-revealed-pages',
    'plan-page-reveal',
    'get-player-handouts',
  ],
  gmActions: ['readActor', 'setFeatureSwitches', 'ensurePartyGroup'],
  order: 10,
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
    const sceneId = t.kit.scene.sceneId;
    /** @type {import('playwright-core').Page} */
    let page;

    // --- what the flows share -------------------------------------------------------------------

    /** Guarded changes applied since `since` that can still be undone, newest first. @param {string} since */
    const changesSince = async since =>
      listOf(await t.tool('list-recent-changes', { limit: 50 }), 'changes')
        .filter(c => c.mode === 'apply' && c.canUndo === true && String(c.appliedAt) >= since)
        .sort((a, b) => String(b.appliedAt).localeCompare(String(a.appliedAt)));

    const now = () => new Date(Date.now() - 2000).toISOString();

    /**
     * Clean-ups that must run after the undo of everything applied (a hide made here would otherwise be
     * undone again, which reveals the page): the flows add theirs, the undo clean-up runs them last.
     * @type {Array<() => Promise<void>>}
     */
    const late = [];

    /**
     * Changes the put-back leaves alone: an undo applied through the undo window is itself an
     * undoable change, and undoing it again at the end would bring back what the flow took away.
     * @type {Set<string>}
     */
    const keep = new Set();

    /** @param {string} name */
    const shot = async name => {
      try {
        t.attachFile(name, await page.screenshot());
      } catch {
        /* the page is gone; the step says why */
      }
    };

    /**
     * One flow: a step that goes on after a failure, with a screenshot and a console error check.
     * A refusal that says a switch is off skips the flow instead of failing it, unless it names a
     * switch this run turned on itself (FLOW_FEATURES, GM Actions): then the flow fails.
     * @param {string} label @param {string} file @param {() => Promise<string | void>} fn
     */
    const flow = async (label, file, fn) => {
      const errorsBefore = browser.consoleErrors(page).length;
      try {
        await t.step(
          label,
          async () => {
            try {
              await markToasts(page);
              const detail = await fn();
              const fresh = browser.consoleErrors(page).slice(errorsBefore);
              t.check(
                fresh.length === 0,
                'the page logged new console errors',
                fresh.map(e => e.message.slice(0, 200))
              );
              return detail;
            } catch (e) {
              if (e instanceof Refused && isSwitchedOff(e.message, RUN_SWITCHES)) {
                t.skip(`the dashboard refused: ${e.message}`);
              }
              throw e;
            } finally {
              await shot(file);
              await resetUi(page);
            }
          },
          { continueOnFail: true }
        );
      } catch (e) {
        // A skipped flow ends only itself; the next flow still runs.
        if (!(e instanceof SkipError)) throw e;
      }
    };

    const hero = () => {
      const h = tokenHeroes(t.kit)[0];
      if (!h) t.skip('the kit has no hero with a token on the scene');
      return h;
    };
    /** @param {{actorId: string, tokenId?: string}} h */
    const readHero = h => t.gm('readActor', { actorId: h.actorId, sceneId, tokenId: h.tokenId });
    const total = (/** @type {any} */ s) => s.hp.value + (s.hp.temp || 0);

    /**
     * Damage the hero through the tool runner form and the confirm window; returns the HP before.
     * @param {any} h @param {number} [amount]
     */
    const damageThroughForm = async (h, amount = 2) => {
      const before = await readHero(h);
      if (before.hp.value < amount + 3) t.skip(`${h.name} has only ${before.hp.value} HP`);
      // A toast from an earlier change in the same flow would end the waits below too early.
      await markToasts(page);
      await openToolForm(page, 'plan-actor-change', {
        action: 'damage',
        targets: h.name,
        amount,
      });
      await submitToolForm(page);
      const { modal } = await settleWrite(page);
      t.check(modal, 'the tool runner form opens the confirm window');
      t.check(/Confirm action/i.test(modal?.title ?? ''), `the window is titled "${modal?.title}"`);
      t.check(modal?.destructive === false, 'a damage plan does not ask for the destructive box');
      t.check(
        /damage/i.test(modal?.body ?? '') || (modal?.body ?? '').includes(h.name),
        'the window shows what the plan does',
        modal?.body
      );
      const toast = await waitToast(page, 'undo');
      t.check(/Applied/.test(toast), `the toast says "${toast}"`);
      await closeTools(page);
      const after = await readHero(h);
      t.equal(
        total(after),
        total(before) - amount,
        `${h.name} HP in Foundry after ${amount} damage`
      );
      return before;
    };

    // --- set up: the page, the During screen, GM Actions ----------------------------------------

    await t.step('open the dashboard on the During screen with GM Actions on', async () => {
      const tools = await t.http('/api/tools');
      const gmWasOn = tools.status === 200 && tools.data?.gmActionsEnabled === true;
      page = await browser.open('/', { viewport: VIEWPORT });
      await waitReady(page);
      if (!gmWasOn) {
        // Registered first, so it runs after the undo below (undo needs GM Actions on).
        t.cleanup(async () => {
          await t.http('/api/control', {
            method: 'POST',
            body: { action: 'set-gm-actions', value: false },
          });
        });
        await page.locator('#btn-gm').click();
        await page.waitForFunction(() =>
          /:\s*on/i.test(document.querySelector('#btn-gm')?.textContent ?? '')
        );
      }
      t.check(await gmActionsLabelOn(page), 'the header says GM Actions: on');
      // The drawers' features, on for the run and put back afterwards (after the undo below, which
      // registers later and so runs first).
      const { before: switchesBefore } = await t.gm('setFeatureSwitches', {
        switches: Object.fromEntries(FLOW_FEATURES.map(id => [id, true])),
      });
      t.cleanup(async () => {
        await t.gm('setFeatureSwitches', { switches: switchesBefore });
      });
      const switchedOn = Object.entries(switchesBefore)
        .filter(([, on]) => !on)
        .map(([id]) => id);
      t.cleanup(async () => {
        // The list is read again after each undo: undoing a change can make an older one undoable
        // again (a failed flow leaves an undo live that hid the change before it).
        for (let i = 0; i < PUT_BACK_CAP; i++) {
          const change = (await changesSince(startedAt)).find(c => !keep.has(c.changeId));
          if (!change) break;
          await t.guarded.undo(change.changeId);
          keep.add(change.changeId);
        }
        for (const fn of late.reverse()) await fn();
      });
      await showDuring(page);
      await shot('during-screen.png');
      const switched = switchedOn.length
        ? `; switched on for the run: ${switchedOn.join(', ')}`
        : '';
      return `${gmWasOn ? 'GM Actions were on' : 'GM Actions turned on (put back at the end)'}${switched}`;
    });

    // --- (a) the tool runner form, the confirm window, Recent Changes Undo -----------------------

    await flow(
      'tool runner: damage a hero, confirm in the window, Undo from Recent Changes',
      'flow-a-recent-changes.png',
      async () => {
        const h = hero();
        const since = now();
        const before = await damageThroughForm(h);
        const change = await waitFor(async () => (await changesSince(since))[0], {
          label: 'the change in list-recent-changes',
          timeoutMs: 15000,
        });
        await openCard(page, 'changes');
        await page.locator('#changes-refresh').click();
        const undo = page.locator(`#changes-body [data-undo="${change.changeId}"]`);
        await undo.waitFor({ state: 'visible', timeout: 20000 });
        const entry = page
          .locator('#changes-body .change-entry')
          .filter({ has: page.locator(`[data-undo="${change.changeId}"]`) });
        t.equal(
          squash(await entry.locator('.change-summary').innerText()),
          squash(change.summary),
          'the Recent Changes row shows the change summary'
        );
        await markToasts(page);
        await undo.click();
        const modal = await readModal(page);
        t.check(
          /Destructive/i.test(modal.title) && modal.destructive,
          `Undo asks twice ("${modal.title}")`
        );
        t.check(/Undo/.test(modal.body), 'the window says what is undone', modal.body);
        await confirmModal(page);
        await waitToast(page, 'ok');
        await undo.waitFor({ state: 'detached', timeout: 20000 });
        t.equal((await readHero(h)).hp, before.hp, `${h.name} HP in Foundry after the undo`);
        return `${h.name}: ${before.hp.value} to ${before.hp.value - 2} and back`;
      }
    );

    // --- (b) the toast Undo ----------------------------------------------------------------------

    await flow(
      'the toast Undo takes a damage change back in one click',
      'flow-b-toast-undo.png',
      async () => {
        const h = hero();
        const before = await damageThroughForm(h);
        const text = await undoFromToast(page);
        t.equal((await readHero(h)).hp, before.hp, `${h.name} HP in Foundry after the toast Undo`);
        return text;
      }
    );

    // --- (f) a note: a map pin through the tool runner -------------------------------------------

    await flow(
      'tool runner: a map note on the scene, taken back with the toast Undo',
      'flow-f-map-note.png',
      async () => {
        const marker = `Kit note ${randomBytes(3).toString('hex')}`;
        await openToolForm(page, 'plan-scene-change', {
          action: 'note',
          x: 300,
          y: 300,
          text: marker,
        });
        await submitToolForm(page);
        const { modal } = await settleWrite(page);
        t.check(modal, 'the tool runner form opens the confirm window');
        await waitToast(page, 'undo');
        await closeTools(page);
        const choices = async () =>
          JSON.stringify(await t.tool('list-ref-choices', { kind: 'note' }));
        t.check((await choices()).includes(marker), 'the map note is on the scene in Foundry');
        await undoFromToast(page);
        t.check(!(await choices()).includes(marker), 'the map note is gone after the Undo');
        return 'pin added and removed';
      }
    );

    // --- (c) the Tarokka drawer ------------------------------------------------------------------

    await flow(
      'Tarokka drawer: deal a built-in reading, then Undo restores the old one',
      'flow-c-tarokka.png',
      async () => {
        const readingId = async () =>
          (await t.tool('get-tarokka-reading', {}))?.reading?.readingId ?? null;
        const before = await readingId();
        await menuClick(page, '#btn-tarokka');
        await page.locator('#tarokka-drawer').waitFor({ state: 'visible', timeout: 10000 });
        await markToasts(page);
        await page.locator('#tarokka-roll').click();
        const { modal } = await settleWrite(page);
        await waitToast(page, 'undo');
        const dealt = await readingId();
        t.check(dealt && dealt !== before, 'a new reading is stored in the bridge vault');
        await page.waitForFunction(
          () => document.querySelectorAll('#tarokka-body .tarokka-pos').length === 5,
          undefined,
          {
            timeout: 20000,
          }
        );
        t.check(
          (await page.locator('#tarokka-body .tarokka-card.veiled').count()) === 5,
          'the five cards stay veiled until "Show cards" is ticked'
        );
        await undoFromToast(page);
        t.equal(await readingId(), before, 'the reading after the Undo');
        return modal ? 'the deal asked for a confirm' : 'dealt and undone with no confirm window';
      }
    );

    // --- (d) the party: pace and a rest request --------------------------------------------------

    await flow(
      'Party drawer: set the travel pace and ask for a rest, each undone',
      'flow-d-party.png',
      async () => {
        let group = listOf(await t.tool('get-party', {}), 'groups')[0];
        if (!group) {
          // The kit world's own party group (test data, kept): the heroes on the scene as members.
          const memberIds = tokenHeroes(t.kit)
            .slice(0, 4)
            .map(h => h.actorId);
          await t.gm('ensurePartyGroup', { name: PARTY_GROUP, memberIds });
          group = listOf(await t.tool('get-party', {}), 'groups')[0];
        }
        if (!group) t.skip('the kit world has no party group actor');
        await menuClick(page, '#btn-party');
        await openCard(page, 'party');
        await page
          .locator('#party-pace [data-party-pace]')
          .first()
          .waitFor({ state: 'visible', timeout: 20000 });
        const pace = async () =>
          (listOf(await t.tool('get-party', {}), 'groups')[0] ?? {}).pace?.value;
        const was = await pace();
        const other = page
          .locator(`#party-pace [data-party-pace]:not([data-party-pace="${was}"]):not([disabled])`)
          .first();
        await markToasts(page);
        await other.click();
        await settleWrite(page);
        await waitToast(page, 'undo');
        const set = await pace();
        t.check(set && set !== was, `the pace changed from ${was} to ${set}`);
        await undoFromToast(page);
        t.equal(await pace(), was, 'the pace after the Undo');
        const rest = page.locator('#party-rest [data-party-rest="short"]:not([disabled])');
        if ((await rest.count()) === 0)
          return `pace ${was} to ${set} and back; no rest card to request`;
        await markToasts(page);
        await rest.click();
        await settleWrite(page);
        await waitToast(page, 'undo');
        await undoFromToast(page);
        return `pace ${was} to ${set} and back; a short rest request posted and undone`;
      }
    );

    // --- (e) handouts: queue, reveal, hide -------------------------------------------------------

    await flow(
      'Handouts drawer: queue a page, reveal the next, and hide it again',
      'flow-e-handouts.png',
      async () => {
        let journal = listOf(await t.tool('list-journals', {}), 'journals').find(
          j => j.name === HANDOUT_JOURNAL
        );
        if (!journal) {
          await t.tool('create-quest-journal', {
            questTitle: HANDOUT_JOURNAL,
            questDescription:
              'Harmless test data for the test kit (dashboard-write-flows). Safe to delete.',
            additionalPages: [
              { name: HANDOUT_PAGE, content: '<p>Kit handout text. Nothing to see here.</p>' },
            ],
          });
          journal = listOf(await t.tool('list-journals', {}), 'journals').find(
            j => j.name === HANDOUT_JOURNAL
          );
        }
        const source = (journal?.pages ?? []).find(
          (/** @type {any} */ p) => p.name === HANDOUT_PAGE
        );
        if (!journal || !source)
          t.skip('the handout test journal could not be made in the kit world');
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
            await t.guarded
              .planApply('plan-page-reveal', { pageUuid, action: 'hide' })
              .catch(() => {});
          }
        });
        // A run that stopped half way: start clean.
        if (await queued()) await t.tool('plan-page-reveal', { pageUuid, action: 'unqueue' });
        t.check(
          (await copies()).length === 0,
          'the test page starts hidden (hide it in Foundry and run again)'
        );

        // Queue the page through the "+ Queue a page" form.
        await menuClick(page, '#btn-handouts');
        await openCard(page, 'handouts');
        await page.locator('#handouts-next').waitFor({ state: 'visible', timeout: 20000 });
        await markToasts(page);
        await page.locator('#handouts-add').click();
        await page
          .locator('#tool-detail-name')
          .filter({ hasText: 'plan-page-reveal' })
          .waitFor({ timeout: 10000 });
        await page
          .locator('#tool-form .field[data-key="pageUuid"]')
          .locator('select, input, textarea')
          .first()
          .fill(pageUuid);
        await submitToolForm(page);
        await waitToast(page, 'ok');
        await closeTools(page);
        t.check(await queued(), 'the page is on the reveal queue');

        // Reveal the next queued page: a destructive plan, so the window asks twice.
        await openCard(page, 'handouts');
        const next = page.locator('#handouts-next');
        await page.waitForFunction(
          () => /Reveal next: /.test(document.querySelector('#handouts-next')?.textContent ?? ''),
          undefined,
          {
            timeout: 20000,
          }
        );
        t.check(
          (await next.textContent())?.includes(HANDOUT_PAGE),
          'the button names the queued page'
        );
        await markToasts(page);
        await next.click();
        const { modal } = await settleWrite(page);
        t.check(
          modal && modal.destructive,
          'revealing a handout asks for the destructive box',
          modal
        );
        await waitToast(page, 'undo');
        const shown = await waitFor(async () => (await copies())[0], {
          label: 'the revealed handout',
          timeoutMs: 15000,
        });
        t.check(shown.exists !== false, 'the revealed page exists in Foundry');
        const handouts = listOf(await t.tool('get-player-handouts', {}), 'handouts');
        t.check(
          handouts.some(h => h.title === HANDOUT_PAGE),
          'the players can open the handout'
        );
        await openCard(page, 'handouts');
        await page
          .locator('#handouts-revealed', { hasText: HANDOUT_PAGE })
          .waitFor({ timeout: 20000 });

        // Hide it again with the toast Undo.
        await undoFromToast(page);
        t.equal((await copies()).length, 0, 'revealed copies after the Undo');
        const left = listOf(await t.tool('get-player-handouts', {}), 'handouts').filter(
          h => h.title === HANDOUT_PAGE
        );
        t.equal(left.length, 0, 'handouts the players can open after the Undo');
        return 'queued, revealed, hidden';
      }
    );

    // --- (g) the player links --------------------------------------------------------------------

    await flow(
      'Player links: make a link for the kit player and remove it again',
      'flow-g-links.png',
      async () => {
        const links = async () => (await t.http('/api/player-links')).data?.players ?? [];
        const player = (await links()).find((/** @type {any} */ p) => p.name === KIT_PLAYER_USER);
        if (!player) t.skip(`the kit world has no ${KIT_PLAYER_USER} user`);
        if (player.link)
          t.skip(`${KIT_PLAYER_USER} already has a link; making a new one would turn it off`);
        late.push(async () => {
          if ((await links()).find((/** @type {any} */ p) => p.userId === player.userId)?.link) {
            await t.http(`/api/player-links/${encodeURIComponent(player.userId)}`, {
              method: 'DELETE',
            });
          }
        });
        await menuClick(page, '#btn-show-links');
        const row = page.locator(`#links-body li[data-user="${player.userId}"]`);
        await row.waitFor({ state: 'visible', timeout: 15000 });
        t.check(
          /no link/.test(squash(await row.locator('.links-state').textContent())),
          'the row says "no link"'
        );
        await markToasts(page);
        await row.locator('[data-links="make"]').click();
        await waitToast(page, 'ok');
        await row.locator('[data-links="remove"]').waitFor({ state: 'visible', timeout: 15000 });
        const made = (await links()).find((/** @type {any} */ p) => p.userId === player.userId);
        t.check(made?.link, 'the dashboard made a link');
        await markToasts(page);
        await row.locator('[data-links="remove"]').click();
        await waitToast(page, 'ok');
        await row.locator('[data-links="make"]').waitFor({ state: 'visible', timeout: 15000 });
        const gone = (await links()).find((/** @type {any} */ p) => p.userId === player.userId);
        t.check(!gone?.link, 'the link is removed');
        return 'link made and removed';
      }
    );

    // --- (h) to (j): the Everyone tab's undo window and Redo (I-109) ----------------------------
    // Two damage changes on one hero; the older one is undone through the window. Its stages: choose
    // (Just this / Everything since, because a later change touched the same hero), then confirm.

    /** A button of the undo window by its key (cancel, just-this, everything-since, apply). @param {string} key */
    const undoKey = key => page.locator(`#undo-actions [data-undo-key="${key}"]`);

    /** Waits for the undo window and reads it. */
    const readUndo = async () => {
      await page.locator('#undo-backdrop').waitFor({ state: 'visible', timeout: 20000 });
      return {
        title: squash(await page.locator('#undo-title').textContent()),
        body: squash(await page.locator('#undo-body').innerText()),
        keys: await page
          .locator('#undo-actions [data-undo-key]')
          .evaluateAll(els => els.map(el => el.getAttribute('data-undo-key') ?? '')),
      };
    };

    const undoClosed = () =>
      page.locator('#undo-backdrop').waitFor({ state: 'hidden', timeout: 10000 });

    /**
     * The Undo or Redo button of one change on the Everyone tab of Recent Changes; refreshes the
     * list until the row shows it.
     * @param {'undo' | 'redo'} kind @param {string} id
     */
    const everyoneButton = async (kind, id) => {
      await openCard(page, 'changes');
      const tab = page.locator('#changes-tab-everyone');
      if (!(await tab.isVisible()))
        t.skip('no Everyone tab: the bridge does not serve list-changes');
      if ((await tab.getAttribute('aria-pressed')) !== 'true') await tab.click();
      const button = page.locator(`#changes-body [data-ev-${kind}="${id}"]`);
      await waitFor(
        async () => {
          if (await button.isVisible()) return true;
          await page.locator('#changes-refresh').click();
          return false;
        },
        {
          label: `the ${kind === 'undo' ? 'Undo' : 'Redo'} button on the Everyone tab`,
          timeoutMs: 30000,
        }
      );
      return button;
    };

    /** Presses Undo in the undo window (ticking the destructive box when it asks) and waits for the toast. */
    const applyUndo = async () => {
      const apply = undoKey('apply');
      if (await page.locator('#undo-destructive').isVisible()) {
        t.check(await apply.isDisabled(), 'Undo waits for the destructive tick');
        await page.locator('#undo-destructive-check').check();
      }
      await markToasts(page);
      await apply.click();
      await waitToast(page, 'ok');
    };

    /**
     * What (h) leaves for (i) and (j): the hero, its HP before both changes and the older change.
     * @type {{h: any, before: any, first: any} | null}
     */
    let pair = null;

    await flow(
      'Everyone tab: the older of two changes asks to choose; Cancel and Escape change nothing, Just this takes back only its part',
      'flow-h-undo-just-this.png',
      async () => {
        const h = hero();
        const since = now();
        const before = await damageThroughForm(h, 2);
        await damageThroughForm(h, 3);
        // The older damage by its summary: `since` has slack, so the previous flow's changes can be
        // in the list too. Not only the undoable ones: a later change may block the plain undo of
        // the older one, which is what the window's choice is for.
        const first = await waitFor(
          async () =>
            listOf(await t.tool('list-recent-changes', { limit: 50 }), 'changes')
              .filter(c => c.mode === 'apply' && String(c.appliedAt) >= since)
              .sort((a, b) => String(b.appliedAt).localeCompare(String(a.appliedAt)))
              .find(c => String(c.summary).includes(h.name) && /\b2 damage\b/.test(c.summary)),
          { label: 'the older damage change in list-recent-changes', timeoutMs: 15000 }
        );
        const hp = async () => total(await readHero(h));
        const both = total(before) - 5;

        const undo = await everyoneButton('undo', first.changeId);
        await undo.click();
        const choose = await readUndo();
        t.check(
          /not the latest change/i.test(choose.body),
          'the window says this is not the latest change',
          choose.body
        );
        t.check(
          choose.keys.includes('just-this') && choose.keys.includes('everything-since'),
          'the window offers Just this and Everything since',
          choose.keys
        );
        await undoKey('cancel').click();
        await undoClosed();
        t.equal(await hp(), both, `${h.name} HP after Cancel`);

        await undo.click();
        await readUndo();
        await page.keyboard.press('Escape');
        await undoClosed();
        t.equal(await hp(), both, `${h.name} HP after Escape`);

        await undo.click();
        await readUndo();
        await undoKey('just-this').click();
        await undoKey('apply').waitFor({ state: 'visible', timeout: 20000 });
        const confirm = await readUndo();
        t.check(
          /Undo this change/i.test(confirm.title),
          `the confirm stage is titled "${confirm.title}"`
        );
        await applyUndo();
        await undoClosed();
        t.equal(
          await hp(),
          total(before) - 3,
          `${h.name} HP after Just this (only its 2 come back)`
        );
        pair = { h, before, first };
        return `${h.name}: ${total(before)} to ${both}; Just this on the older change gives ${total(before) - 3}`;
      }
    );

    await flow(
      'Everyone tab Redo: Escape and Cancel in the confirm window keep it undone, Confirm puts it back',
      'flow-i-redo.png',
      async () => {
        if (!pair) t.skip('needs the Just this flow (h) before it');
        const { h, before, first } = pair;
        const hp = async () => total(await readHero(h));
        const hidden = () =>
          page.locator('#modal-backdrop').waitFor({ state: 'hidden', timeout: 10000 });

        const redo = await everyoneButton('redo', first.changeId);
        await redo.click();
        const modal = await readModal(page);
        t.check(/Redo/.test(modal.body), 'the window says what comes back', modal.body);
        t.check(modal.destructive, 'Redo asks for the destructive tick');
        t.check(
          await page.locator('#modal-confirm').isDisabled(),
          'Confirm waits for the destructive tick'
        );
        await page.keyboard.press('Escape');
        await hidden();
        t.equal(await hp(), total(before) - 3, `${h.name} HP after Escape`);

        await redo.click();
        await readModal(page);
        await page.locator('#modal-cancel').click();
        await hidden();
        t.equal(await hp(), total(before) - 3, `${h.name} HP after Cancel`);

        await redo.click();
        await readModal(page);
        await markToasts(page);
        await confirmModal(page);
        await waitToast(page, 'ok');
        t.equal(await hp(), total(before) - 5, `${h.name} HP after Redo (its 2 are taken again)`);
        return `${h.name}: Escape and Cancel kept ${total(before) - 3}; Redo gives ${total(before) - 5}`;
      }
    );

    await flow(
      'Everyone tab: Everything since takes the hero back to before both changes',
      'flow-j-undo-everything-since.png',
      async () => {
        if (!pair) t.skip('needs the Just this flow (h) before it');
        const { h, before, first } = pair;
        const since = now();
        const undo = await everyoneButton('undo', first.changeId);
        await undo.click();
        const choose = await readUndo();
        t.check(
          choose.keys.includes('everything-since'),
          'the window offers Everything since',
          choose.keys
        );
        await undoKey('everything-since').click();
        await undoKey('apply').waitFor({ state: 'visible', timeout: 20000 });
        const confirm = await readUndo();
        t.check(
          /Undo everything since/i.test(confirm.title),
          `the confirm stage is titled "${confirm.title}"`
        );
        await applyUndo();
        await undoClosed();
        // The undo is a change of its own; the put-back must not undo it again.
        const kept = (await changesSince(since))[0];
        if (kept) keep.add(kept.changeId);
        t.equal(total(await readHero(h)), total(before), `${h.name} HP after Everything since`);
        return `${h.name}: back to ${total(before)}`;
      }
    );
  },
};
