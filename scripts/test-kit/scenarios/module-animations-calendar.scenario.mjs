/**
 * Third-party modules that react to what the AI Tool does, on a kit world that has them enabled:
 * Automated Animations plays an animation when an attack roll is made through dnd5e's activity API
 * (the call the bridge makes) and a target is set, and Calendaria's clock hooks fire when world time
 * moves without the module writing journals. Skips each part whose module is not active. Pages:
 * .claude/skills/foundry-modules/references/autoanimations.md and calendaria.md.
 */
import { tokenHeroes } from '../lib/helpers.mjs';

/** Runs in the Foundry GM page: is each module of this scenario active? */
const ACTIVE_SCRIPT = () => ({
  animations: ['autoanimations', 'sequencer', 'JB2A_DnD5e'].every(
    id => game.modules.get(id)?.active
  ),
  calendar: ['calendaria', '3ds-atlas'].every(id => game.modules.get(id)?.active),
});

/**
 * Runs in the Foundry GM page: an attack roll by the hero's token at the other token, through the
 * activity API. Resolves to the hook names that fired and what the roll left behind.
 */
const ANIMATION_SCRIPT = async ({ sceneId, heroTokenId, targetTokenId }) => {
  const scene = game.scenes.get(sceneId);
  const heroToken = scene?.tokens.get(heroTokenId);
  const targetToken = scene?.tokens.get(targetTokenId);
  if (!heroToken?.actor || !targetToken) return { error: 'tokens not found on the kit scene' };
  if (canvas.scene?.id !== sceneId) await scene.view();
  const weapon = heroToken.actor.items.find(
    i => i.type === 'weapon' && i.system.activities?.some(a => a.type === 'attack')
  );
  if (!weapon) return { error: `${heroToken.actor.name} has no weapon with an attack activity` };
  const activity = weapon.system.activities.find(a => a.type === 'attack');
  const names = ['aa.preAnimationStart', 'aa.animationStart', 'createSequencerEffect'];
  const fired = [];
  const handles = names.map(name => [name, Hooks.on(name, () => fired.push(name))]);
  const before = game.messages.size;
  try {
    targetToken.object.setTarget(true, { releaseOthers: true });
    await activity.rollAttack({}, { configure: false }, { create: true });
    await new Promise(resolve => setTimeout(resolve, 3500));
  } finally {
    game.user.targets.forEach(token => token.setTarget(false, { releaseOthers: false }));
    for (const [name, id] of handles) Hooks.off(name, id);
  }
  return { weapon: weapon.name, fired, messages: game.messages.size - before };
};

/**
 * Runs in the Foundry GM page: move world time forward one day, watch Calendaria's hooks and the
 * journals, then move it back.
 */
const CALENDAR_SCRIPT = async () => {
  const day = 86400;
  const names = ['calendaria.dayChange', 'calendaria.worldTimeUpdated'];
  const fired = [];
  const handles = names.map(name => [name, Hooks.on(name, () => fired.push(name))]);
  const journalsBefore = game.journal.size;
  try {
    await game.time.advance(day);
    await new Promise(resolve => setTimeout(resolve, 2000));
    const journalsAfter = game.journal.size;
    return { fired, journalsBefore, journalsAfter };
  } finally {
    await game.time.advance(-day);
    await new Promise(resolve => setTimeout(resolve, 1000));
    for (const [name, id] of handles) Hooks.off(name, id);
  }
};

/** @type {import('../lib/contract.mjs').Scenario} */
export default {
  id: 'module-animations-calendar',
  title: 'Automated Animations and Calendaria react to the tools (when the modules are on)',
  sizes: ['full'],
  tags: ['module'],
  needs: ['heroes', 'monsters', 'scene'],
  tools: [],
  timeoutMs: 90000,

  async run(t) {
    if (t.fake || !t.page) t.skip('needs the real Foundry GM page');
    const active = await t.step('which of the modules are active in this kit world', async () => {
      const result = await t.page.evaluate(ACTIVE_SCRIPT);
      t.log(`animations: ${result.animations}, calendar: ${result.calendar}`);
      return result;
    });
    if (!active.animations && !active.calendar) {
      t.skip('neither Automated Animations (with Sequencer and JB2A) nor Calendaria is active');
    }

    if (active.animations) {
      await t.step('an attack roll with a target plays an animation', async () => {
        const heroes = tokenHeroes(t.kit);
        const hero = heroes[0];
        const targetId = t.kit.monsters.find(m => m.tokenId)?.tokenId;
        if (!hero || !targetId) t.skip('the kit scene needs a hero token and a monster token');
        const result = await t.page.evaluate(ANIMATION_SCRIPT, {
          sceneId: t.kit.scene.sceneId,
          heroTokenId: hero.tokenId,
          targetTokenId: targetId,
        });
        t.check(!result.error, `the roll could not be set up: ${result.error}`, result);
        t.check(result.messages >= 1, 'the attack roll made a chat message', result);
        t.check(
          result.fired.includes('aa.animationStart') &&
            result.fired.includes('createSequencerEffect'),
          'Automated Animations started an animation and Sequencer made an effect',
          result
        );
        return `${result.weapon}: ${result.fired.join(', ')}`;
      });
    }

    if (active.calendar) {
      await t.step('moving world time fires the clock hooks and writes no journals', async () => {
        const result = await t.page.evaluate(CALENDAR_SCRIPT);
        t.check(result.fired.includes('calendaria.dayChange'), 'a day passed', result);
        t.equal(result.journalsAfter, result.journalsBefore, 'journals created by the time change');
        return result.fired.join(', ');
      });
    }
  },
};
