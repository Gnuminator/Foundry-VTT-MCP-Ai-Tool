/**
 * Automated Conditions 5e (AC5e) and the roll tools (Backlog ac5e-kit-scenario, I-117 per-module
 * profiles). A `poisoned` creature rolls with disadvantage on attacks and ability checks; AC5e adds
 * that to rolls made through dnd5e's roll API. The scenario poisons a hero and a monster, calls
 * `request-ability-check`, `request-attack-roll` and `roll-saving-throws` and compares the roll
 * mode of each with the same creatures unpoisoned (AC5e cannot be switched off inside a running
 * world; a third arm reports what the `automateStatuses` setting does). Skips when AC5e is not active in the kit world. Page:
 * .claude/skills/foundry-modules/references/automated-conditions-5e.md.
 *
 * What it pins (a change here is a decision, not noise):
 * - `roll-saving-throws` rolls through dnd5e's API, so AC5e makes a poisoned monster's check
 *   roll with disadvantage (and a normal one when unpoisoned): this arm measures AC5e;
 * - `request-ability-check` and `request-attack-roll` post a button and the scenario clicks it
 *   (as the GM, who may click any button). The button rolls through dnd5e's actor and attack
 *   activity API (`rollThroughDnd5e` in packages/foundry-module/src/data-access/player-rolls.ts),
 *   so a poisoned hero rolls both with disadvantage and an unpoisoned one rolls normally.
 */
import { monsterOf, playerHero } from '../lib/helpers.mjs';

const MODULE = 'automated-conditions-5e';
const SETTING = 'automateStatuses';

/** Runs in the Foundry GM page: is AC5e active, and what is its condition-rules setting? */
const STATE_SCRIPT = ({ module, setting }) => ({
  active: !!game.modules.get(module)?.active,
  automate: game.settings.settings.has(`${module}.${setting}`)
    ? game.settings.get(module, setting)
    : null,
});

/** Runs in the Foundry GM page: set the condition-rules setting. */
const SETTING_SCRIPT = async ({ module, setting, value }) => {
  await game.settings.set(module, setting, value);
  return game.settings.get(module, setting);
};

/** Runs in the Foundry GM page: add or remove the poisoned status on a token's actor. */
const POISON_SCRIPT = async ({ sceneId, tokenId, active }) => {
  const actor = game.scenes.get(sceneId)?.tokens.get(tokenId)?.actor;
  if (!actor) return { error: 'token not found on the kit scene' };
  await actor.toggleStatusEffect('poisoned', { active });
  return { poisoned: actor.statuses.has('poisoned') };
};

/** Runs in the Foundry GM page: the ids of the chat messages there are now. */
const MESSAGE_IDS_SCRIPT = () => game.messages.contents.map(m => m.id);

/**
 * Runs in the Foundry GM page: what the chat messages made since `known` show about the roll:
 * the formula of every roll button, and the formula and dnd5e advantage mode of every roll.
 */
const NEW_ROLLS_SCRIPT = ({ known }) => {
  const seen = new Set(known);
  const out = { buttons: [], rolls: [] };
  for (const m of game.messages.contents) {
    if (seen.has(m.id)) continue;
    const doc = new DOMParser().parseFromString(m.content ?? '', 'text/html');
    for (const b of doc.querySelectorAll('.mcp-roll-button')) {
      out.buttons.push({
        id: b.getAttribute('data-button-id') ?? '',
        formula: b.getAttribute('data-roll-formula') ?? '',
        label: b.textContent.trim(),
      });
    }
    for (const r of m.rolls ?? []) {
      out.rolls.push({
        formula: r.formula,
        advantageMode: r.options?.advantageMode ?? null,
        flavor: m.flavor ?? '',
        flags: Object.keys(m.flags ?? {}),
      });
    }
  }
  return out;
};

/** Runs in the Foundry GM page: click one roll button in the chat log, as the GM would. */
const CLICK_BUTTON_SCRIPT = ({ buttonId }) => {
  const b = document.querySelector(`.mcp-roll-button[data-button-id="${buttonId}"]`);
  if (!b) return false;
  b.click();
  return true;
};

/** Runs in the Foundry GM page: delete chat messages. */
const DELETE_MESSAGES_SCRIPT = async ({ known }) => {
  const seen = new Set(known);
  for (const m of game.messages.contents) if (!seen.has(m.id)) await m.delete();
};

/**
 * The roll mode a formula shows: two d20s keeping the lower is disadvantage, the higher advantage,
 * one d20 normal.
 * @param {string} formula
 * @returns {'disadvantage' | 'advantage' | 'normal' | 'other'}
 */
export function modeOfFormula(formula) {
  const m = /^(\d+)d20(kl|kh)?/.exec(String(formula).trim());
  if (!m) return 'other';
  if (m[2] === 'kl' && m[1] !== '1') return 'disadvantage';
  if (m[2] === 'kh' && m[1] !== '1') return 'advantage';
  return m[1] === '1' ? 'normal' : 'other';
}

/** The roll mode of one chat roll: dnd5e's advantage mode, else what the formula shows. */
const rollMode = roll =>
  roll?.advantageMode === -1
    ? 'disadvantage'
    : roll?.advantageMode === 1
      ? 'advantage'
      : modeOfFormula(roll?.formula ?? '');

/** @type {import('../lib/contract.mjs').Scenario} */
export default {
  id: 'module-ac5e-roll-mode',
  title: 'A poisoned creature rolls with disadvantage on the roll tools and their buttons',
  sizes: ['full'],
  tags: ['module', 'bridge'],
  needs: ['heroes', 'monsters', 'scene'],
  tools: ['request-ability-check', 'request-attack-roll', 'roll-saving-throws'],
  timeoutMs: 120000,

  async run(t) {
    if (t.fake || !t.page) t.skip('needs the real Foundry GM page');
    const page = t.page;
    const state = await t.step('Automated Conditions 5e is active in this kit world', async () => {
      const s = await page.evaluate(STATE_SCRIPT, { module: MODULE, setting: SETTING });
      t.log(`active: ${s.active}, ${SETTING}: ${s.automate}`);
      return s;
    });
    if (!state.active) t.skip('Automated Conditions 5e is not active in this kit world');
    t.check(
      state.automate !== null,
      `the setting ${MODULE}.${SETTING} is gone; the module renamed it`,
      state
    );

    // The two request tools refuse a player who is not logged in, so the kit player joins.
    if (!t.joinFoundry) t.skip('needs a second Foundry page for the kit player');
    await t.step('the kit player is online', async () => {
      const player = await t.joinFoundry('Kit Player');
      t.check(player?.page, 'the kit player could not join');
    });
    const hero = playerHero(t.kit);
    const monster = monsterOf(t.kit, 'beast');
    const sceneId = t.kit.scene.sceneId;
    const known = await page.evaluate(MESSAGE_IDS_SCRIPT);

    const poison = (tokenId, active) => page.evaluate(POISON_SCRIPT, { sceneId, tokenId, active });
    t.cleanup(async () => {
      await poison(hero.tokenId, false);
      await poison(monster.tokenId, false);
      await page.evaluate(SETTING_SCRIPT, {
        module: MODULE,
        setting: SETTING,
        value: state.automate,
      });
      await page.evaluate(DELETE_MESSAGES_SCRIPT, { known });
    });

    /** Sets the poisoned status on the hero and the monster. */
    const setPoisoned = async active => {
      for (const token of [hero.tokenId, monster.tokenId]) {
        const r = await poison(token, active);
        t.check(
          !r.error && r.poisoned === active,
          `poisoned status ${active} on token ${token}: ${r.error ?? ''}`,
          r
        );
      }
    };

    /** Calls the three tools once and returns the mode each roll showed. */
    const modes = async () => {
      const before = await page.evaluate(MESSAGE_IDS_SCRIPT);
      await t.tool(
        'request-ability-check',
        { targetPlayer: hero.name, ability: 'str', isPublic: true },
        { confirm: true }
      );
      await t.tool(
        'request-attack-roll',
        { targetPlayer: hero.name, weaponOrSpellName: 'Kit Sword', isPublic: true },
        { confirm: true }
      );
      const requests = await page.evaluate(NEW_ROLLS_SCRIPT, { known: before });
      const buttonMode = async label => {
        const b = requests.buttons.find(x => x.label.toLowerCase().includes(label.toLowerCase()));
        t.check(b, `a roll button "${label}" was posted`, requests.buttons);
        const beforeClick = await page.evaluate(MESSAGE_IDS_SCRIPT);
        t.check(
          await page.evaluate(CLICK_BUTTON_SCRIPT, { buttonId: b?.id }),
          `the "${label}" button is in the chat log`
        );
        let roll;
        for (let i = 0; i < 30 && !roll; i++) {
          await new Promise(r => setTimeout(r, 500));
          roll = (await page.evaluate(NEW_ROLLS_SCRIPT, { known: beforeClick })).rolls[0];
        }
        t.check(roll, `clicking the "${label}" button made a roll`);
        return {
          formula: roll?.formula ?? '',
          flags: (roll?.flags ?? []).join(','),
          mode: rollMode(roll),
        };
      };
      const beforeSave = await page.evaluate(MESSAGE_IDS_SCRIPT);
      await t.tool('roll-saving-throws', {
        targets: [monster.name],
        rollType: 'check',
        ability: 'str',
        isPublic: true,
      });
      const saves = await page.evaluate(NEW_ROLLS_SCRIPT, { known: beforeSave });
      const roll = saves.rolls[0];
      t.check(roll, 'roll-saving-throws made a roll in the chat', saves);
      const check = {
        formula: roll?.formula ?? '',
        flags: (roll?.flags ?? []).join(','),
        mode: rollMode(roll),
      };
      return {
        'request-ability-check': await buttonMode('Ability Check'),
        'request-attack-roll': await buttonMode('attack'),
        'roll-saving-throws': check,
      };
    };

    // AC5e cannot be switched off inside a running world, so "without" is the same creatures with
    // no condition (what the roll is when AC5e has nothing to apply). The third arm turns the
    // module's `automateStatuses` setting off and only reports: on 14.606.4.5 the poisoned
    // handling still ran with it off (2026-10-28), so its result is not asserted.
    const arms = [
      ['baseline', false, true],
      ['poisoned', true, true],
      ['poisoned, rules setting off', true, false],
    ];
    const result = {};
    for (const [label, poisoned, rules] of arms) {
      await t.step(`roll modes: ${label}`, async () => {
        await setPoisoned(poisoned);
        await page.evaluate(SETTING_SCRIPT, { module: MODULE, setting: SETTING, value: rules });
        const got = await modes();
        result[label] = got;
        t.log(
          Object.entries(got)
            .map(([k, v]) => `${k}: ${v.mode} (${v.formula}${v.flags ? ` [${v.flags}]` : ''})`)
            .join('; ')
        );
        return Object.entries(got)
          .map(([k, v]) => `${k} ${v.mode}`)
          .join(', ');
      });
    }
    t.attach('ac5e-roll-modes', result);

    await t.step('a poisoned creature rolls with disadvantage on all three tools', async () => {
      t.equal(result.baseline['roll-saving-throws'].mode, 'normal', 'unpoisoned monster check');
      t.equal(result.poisoned['roll-saving-throws'].mode, 'disadvantage', 'poisoned monster check');
      for (const tool of ['request-ability-check', 'request-attack-roll']) {
        t.equal(result.baseline[tool].mode, 'normal', `${tool}: the unpoisoned hero's button roll`);
        t.equal(
          result.poisoned[tool].mode,
          'disadvantage',
          `${tool}: the poisoned hero's button roll`
        );
      }
    });
  },
};
