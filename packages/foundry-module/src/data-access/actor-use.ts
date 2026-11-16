import { ERROR_MESSAGES } from '../constants.js';
import * as shared from './shared.js';
import { logInfo } from '../log.js';
import { findAttackActivity } from './attack-activity.js';
import { slotLevelFor } from './spell-slots.js';

/** The use-like methods a dnd5e item may carry (none are in the core Item declaration). */
interface UsableItemMethods {
  use?: (...args: unknown[]) => Promise<unknown>;
  toChat?: () => Promise<unknown>;
  toMessage?: (...args: unknown[]) => Promise<unknown>;
  roll?: () => Promise<unknown>;
}

/** Input of {@link ActorUseDataAccess.useItem}. */
export interface UseItemInput {
  actorIdentifier: string;
  itemIdentifier: string;
  targets?: string[] | undefined; // Target character/token names or IDs. "self" targets the caster.
  options?:
    | {
        consume?: boolean | undefined; // Whether to consume charges/uses
        configureDialog?: boolean | undefined; // Whether to show configuration dialog
        skipDialog?: boolean | undefined; // Skip confirmation dialogs (default: true for MCP)
        spellLevel?: number | undefined; // For spells: cast at higher level
        versatile?: boolean | undefined; // For versatile weapons: use versatile damage
        rollAttack?: boolean | undefined; // dnd5e: also roll the item's attack, no dialog, against the targets
      }
    | undefined;
}

/** Result of {@link ActorUseDataAccess.useItem}. */
export interface UseItemResult {
  success: boolean;
  status?: string;
  message: string;
  itemName?: string;
  actorName?: string;
  targets?: string[];
  requiresGMInteraction?: boolean;
}

/** Input of {@link ActorUseDataAccess.useNpcActivity}. */
export interface UseNpcActivityInput {
  actorName: string;
  itemName: string;
  /** Which activity of the item (name, id or type); default: its attack. */
  activity?: string | undefined;
  targetAC?: number | undefined;
  isPublic?: boolean | undefined;
}

/** Result of {@link ActorUseDataAccess.useNpcActivity}. */
export interface UseNpcActivityResult {
  success: boolean;
  actor: string;
  item: string | undefined;
  hadAttack: boolean;
  attackTotal: number | null;
  targetName: string | null;
  targetAC: number | null;
  hit: boolean | null;
  isCritical: boolean;
  damageTotal: number | null;
  /** The damage per type (a mixed hit, piercing plus poison), so resistance applies per type. */
  damageByType?: Array<{ type: string; total: number }> | undefined;
  formula: string | null;
  /** The activity that ran (set when `activity` was asked for). */
  activity?: string | undefined;
  activityType?: string | undefined;
  /** A save-based activity: what the targets roll against. */
  save?: { abilities: string[]; dc: number | null; onSave: string | null } | undefined;
  /** The legendary actions spent before and after (a legendary activity spends them). */
  legendarySpent?: { before: number; after: number } | undefined;
}

/** What a dnd5e attack or damage roll reports (an Activity returns one or a list, an Item one). */
interface NpcRollResult {
  options?: { type?: string | undefined } | undefined;
  total?: number | null | undefined;
  isCritical?: boolean | undefined;
  formula?: string | undefined;
  isSuccess?: unknown;
}

type NpcRollOutput = NpcRollResult | NpcRollResult[] | null | undefined;

/** A damage roll's total, and its parts per damage type. */
function sumDamage(out: NpcRollOutput): {
  total: number | null;
  byType: Array<{ type: string; total: number }>;
} {
  if (!Array.isArray(out)) return { total: out?.total ?? null, byType: [] };
  const byType = new Map<string, number>();
  for (const r of out) {
    const type = r.options?.type ?? '';
    byType.set(type, (byType.get(type) ?? 0) + (r.total || 0));
  }
  return {
    total: out.reduce((s, r) => s + (r.total || 0), 0),
    byType: [...byType].map(([type, total]) => ({ type, total })),
  };
}

/** A dnd5e activity as `useNpcActivity` drives it (v4+). */
interface NpcAttackActivity {
  id?: string | undefined;
  name?: string | undefined;
  type?: string | undefined;
  activation?: { type?: string | undefined } | undefined;
  save?:
    | { ability?: Iterable<string> | undefined; dc?: { value?: number | null } | undefined }
    | undefined;
  damage?: { onSave?: string | undefined; parts?: unknown[] | undefined } | undefined;
  use?(config: object, dialog: object, message: object): Promise<unknown>;
  rollAttack(config: object, dialog: object, message: object): Promise<NpcRollOutput>;
  rollDamage(config: object, dialog: object, message: object): Promise<NpcRollOutput>;
}

interface NpcActivityCollection {
  getByType?(type: string): NpcAttackActivity[] | undefined;
  contents?: NpcAttackActivity[] | undefined;
}

/** A dnd5e item as `useNpcActivity` drives it: the roll and use methods are not in the core Item declaration. */
interface NpcActivityItem {
  id: string;
  name?: string | undefined;
  system?: { activities?: NpcActivityCollection | undefined } | undefined;
  use(config: object, dialog: object, message?: object): Promise<unknown>;
  rollAttack(options: object): Promise<NpcRollResult | null | undefined>;
  rollDamage(options: object): Promise<NpcRollResult | null | undefined>;
}

interface NpcActivityActor {
  name: string;
  system?:
    | { resources?: { legact?: { spent?: number | null } | undefined } | undefined }
    | undefined;
  items: FoundryCollection<NpcActivityItem>;
}

/**
 * Item use and NPC attack rolls, split out of ActorBuilderDataAccess (which keeps
 * the delegating public methods): the two features that roll dice and use items
 * rather than build actors and items.
 */
export class ActorUseDataAccess {
  /**
   * Use an item on a character (cast spell, use ability, consume item, etc.)
   * This triggers the item's default use behavior in Foundry VTT
   */
  /** True on a client that never draws a canvas (the Pi's headless Assistant GM sets core.noCanvas). */
  private clientHasNoCanvas(): boolean {
    try {
      return game.settings.get('core', 'noCanvas') === true;
    } catch {
      return false;
    }
  }

  async useItem(params: UseItemInput): Promise<UseItemResult> {
    shared.validateFoundryState();

    const { actorIdentifier, itemIdentifier, targets, options = {} } = params;

    // Find the actor
    // A token id (a combatant has only that) finds an unlinked NPC token's own actor.
    const actor =
      shared.findActorByIdentifier(actorIdentifier) ?? shared.findSceneTokenActor(actorIdentifier);
    if (!actor) {
      throw new Error(`Actor not found: ${actorIdentifier}`);
    }

    // Find the item on the actor
    const item = actor.items.find(
      i => i.id === itemIdentifier || i.name.toLowerCase() === itemIdentifier.toLowerCase()
    );

    if (!item) {
      throw new Error(`Item "${itemIdentifier}" not found on actor "${actor.name}"`);
    }

    const itemAny: Item & UsableItemMethods = item;
    const systemId = game.system.id;

    // rollAttack: the item's first attack activity is rolled right after the card (no dialog), so
    // refuse an item without one before anything is targeted or used.
    const attackActivity = options.rollAttack ? findAttackActivity(item) : undefined;
    if (options.rollAttack) {
      if (systemId !== 'dnd5e') throw new Error('rollAttack needs the dnd5e game system');
      if (!attackActivity) throw new Error(`"${item.name}" has no attack to roll`);
      // The roll has no dialog to pick a target, so it needs named ones (not the GM's live set).
      if (!targets || targets.length === 0) {
        throw new Error('rollAttack needs at least one target; nothing was used or rolled');
      }
    }

    // A slot spell with no slot at its level: upcast into the lowest higher slot, or refuse before
    // anything is targeted. dnd5e itself only warns and casts nothing, which would read as "initiated".
    let upcastSlot = options.spellLevel !== undefined ? `spell${options.spellLevel}` : undefined;
    let autoUpcast: number | undefined;
    if (systemId === 'dnd5e' && options.consume !== false) {
      const slotLevel = slotLevelFor(
        actor,
        item,
        options.spellLevel,
        attackActivity,
        this.clientHasNoCanvas()
      );
      if (slotLevel === 'below') {
        throw new Error(
          `${item.name} is a level ${String((item.system as { level?: unknown }).level)} spell; spellLevel ${String(options.spellLevel)} is below that. Nothing was used or rolled`
        );
      }
      if (slotLevel === 'none') {
        throw new Error(
          `${actor.name} has no spell slot left to cast ${item.name}; nothing was used or rolled`
        );
      }
      if (slotLevel !== undefined) {
        const level = typeof slotLevel === 'object' ? slotLevel.pact : slotLevel;
        upcastSlot = typeof slotLevel === 'object' ? 'pact' : `spell${level}`;
        autoUpcast = level;
      }
    }

    // Handle targeting if targets are specified
    const resolvedTargetNames: string[] = [];
    let targetsNotSet = '';
    const headless = this.clientHasNoCanvas();
    const headlessTargets = (): Set<unknown> | undefined =>
      headless ? game.user?.targets : undefined;
    // Nobody sees a headless GM's target set; never let an earlier call's targets ride along
    // (also when the names given match no token).
    headlessTargets()?.clear();
    if (targets && targets.length > 0) {
      // Get all tokens on the current scene
      const scene = game.scenes?.active;
      if (!scene) {
        throw new Error('No active scene to find targets on');
      }

      const sceneTokens = scene.tokens;
      const tokenIds: string[] = [];

      for (const targetIdentifier of targets) {
        // Handle "self" - target the caster's token
        if (targetIdentifier.toLowerCase() === 'self') {
          // Find token for the caster actor
          const selfToken = sceneTokens.find(
            t => t.actor?.id === actor.id || t.actorId === actor.id
          );
          if (selfToken) {
            tokenIds.push(selfToken.id);
            resolvedTargetNames.push(actor.name);
          } else {
            console.warn(
              `[foundry-mcp-bridge] No token found on scene for actor "${actor.name}" (self)`
            );
          }
          continue;
        }

        // Find token by name or ID
        const targetToken = sceneTokens.find(
          t =>
            t.id === targetIdentifier ||
            t.name?.toLowerCase() === targetIdentifier.toLowerCase() ||
            t.actor?.name?.toLowerCase() === targetIdentifier.toLowerCase()
        );

        if (targetToken) {
          tokenIds.push(targetToken.id);
          resolvedTargetNames.push(targetToken.name || targetToken.actor?.name || targetIdentifier);
        } else {
          console.warn(`[foundry-mcp-bridge] Target not found: "${targetIdentifier}"`);
        }
      }

      // An attack with an unresolved target stops here, before any target is set or used.
      if (attackActivity && tokenIds.length < targets.length) {
        throw new Error(
          'Targets not set (a target is not on the active scene); nothing was used or rolled'
        );
      }

      // Set targets using Foundry's targeting system
      // v14 has no User#updateTokenTargets; the tokens layer owns targeting
      // (client/canvas/layers/tokens.mjs:341). It only resolves ids on the viewed canvas.
      if (tokenIds.length > 0) {
        const cv = typeof canvas === 'undefined' ? undefined : canvas;
        const layer = cv?.ready ? cv.tokens : undefined;
        if (!layer && !headless) {
          // A GM that has a canvas but is still loading it: its target set holds Token objects.
          targetsNotSet = 'the canvas is not ready';
        } else if (!layer) {
          // Headless GM (the Pi's Assistant GM sets core.noCanvas): no canvas, so no Token objects.
          // dnd5e only reads game.user.targets and accepts TokenDocuments there
          // (TargetsField.getDescriptors uses `target.document ?? target`), so fill the set with
          // the scene's token documents.
          try {
            const userTargets = game.user?.targets as unknown as Set<unknown> | undefined;
            if (!userTargets) throw new Error('user has no targets set');
            userTargets.clear();
            for (const id of tokenIds) {
              const doc = sceneTokens.get(id);
              if (doc) userTargets.add(doc);
            }
            logInfo(
              `[foundry-mcp-bridge] Set targets without a canvas: ${resolvedTargetNames.join(', ')}`
            );
          } catch (err) {
            console.error('[foundry-mcp-bridge] Setting targets without a canvas failed:', err);
            targetsNotSet = 'Foundry refused to set them without a canvas';
          }
        } else if (cv?.scene?.id !== scene.id) {
          // setTargets only finds ids on the viewed canvas; calling it would clear the GM's targets.
          targetsNotSet = 'the GM is viewing a different scene than the active one';
        } else {
          try {
            layer.setTargets(tokenIds, { mode: 'replace' });
            logInfo(`[foundry-mcp-bridge] Set targets: ${resolvedTargetNames.join(', ')}`);
          } catch (err) {
            console.error('[foundry-mcp-bridge] Setting targets failed:', err);
            targetsNotSet = 'Foundry refused to set them';
          }
        }
        if (targetsNotSet) {
          console.warn(`[foundry-mcp-bridge] Targets not set: ${targetsNotSet}`);
          resolvedTargetNames.length = 0;
        }
      }
      // With no dialog to fix them, an attack must not roll against old targets or none.
      if (attackActivity && targetsNotSet) {
        headlessTargets()?.clear();
        throw new Error(`Targets not set (${targetsNotSet}); nothing was used or rolled`);
      }
    }

    try {
      // For items that may show dialogs (spells with choices, etc.),
      // we fire-and-forget to avoid timeout issues. The GM will interact
      // with the dialog in Foundry, and the result appears in chat.

      // Check if item has a use() method (D&D 5e)
      if (typeof itemAny.use === 'function') {
        let useArgs: unknown[];
        if (systemId === 'dnd5e') {
          // dnd5e 4+ (5.3.3 and 6.0.5 both): Item5e#use(usage, dialog, message) -
          // three config objects, not the old flat options bag. The old keys
          // (createMessage/consumeResource/consumeSpellSlot/consumeUsage/
          // configureDialog/slotLevel/level) are not read anywhere on this
          // signature, so they were silently ignored, a "use" that always ran
          // with dnd5e's own defaults regardless of what was passed.
          // verified: dnd5e.mjs:35504 (Item5e#use(config, dialog, message) delegates
          // to activity.use(usageConfig, dialogConfig, messageConfig)), :17856
          // (Activity#_prepareUsageConfig, `consume` must be `false` or left
          // unset; `config.consume ??= {}` then assigns properties onto it, which
          // throws in strict mode if `consume` is the boolean `true`).
          const usage: Record<string, unknown> = {};
          if (options.consume === false) {
            usage.consume = false;
          }
          // Upcast slot for spells. Best-effort: assumes a leveled slot key
          // (`spellN`); pact-caster slot ids aren't derivable without the
          // item's casting method, same limitation the old `slotLevel` had.
          if (upcastSlot !== undefined) {
            usage.spell = { slot: upcastSlot };
          }
          // Show the dialog so the GM can make choices, except in a headless browser (the Pi's
          // Assistant GM): nobody can click it, the card would never be made, so dnd5e's defaults apply.
          const dialog = { configure: !headless && !attackActivity };
          if (headless || attackActivity) {
            // Other dialogs would open unseen as well: the activity choice (shift skips it and takes
            // the first usable activity) and the attack/damage roll dialogs that dnd5e opens after
            // the card. The card is made; the rolls are left to the card's buttons.
            usage.event = { shiftKey: true };
            usage.subsequentActions = false;
          }
          const message = { create: true };
          useArgs = [usage, dialog, message];
        } else {
          useArgs = [{ createMessage: true }];
        }
        // Fire and forget - don't await, as dialogs block the promise
        // With rollAttack the attack activity makes the card (its own consumption), so the card and
        // the roll come from the same activity; no result means nothing was used, so nothing rolls.
        (attackActivity ? attackActivity.use(...useArgs) : itemAny.use(...useArgs))
          // The targets are still set while the attack rolls: dnd5e reads them for the AC.
          .then(used =>
            used && attackActivity
              ? attackActivity.rollAttack({}, { configure: false }, { create: true })
              : undefined
          )
          .catch((err: Error) => {
            console.error(`[foundry-mcp-bridge] Error using item ${item.name}:`, err);
          })
          // The card has read the targets by now; leave no hidden set behind on a headless GM.
          .finally(() => headlessTargets()?.clear());
      } else if (typeof itemAny.toChat === 'function') {
        if (typeof itemAny.toMessage === 'function') {
          itemAny.toMessage(undefined, { create: true }).catch((err: Error) => {
            console.error(`[foundry-mcp-bridge] Error using item ${item.name}:`, err);
          });
        } else {
          itemAny.toChat().catch((err: Error) => {
            console.error(`[foundry-mcp-bridge] Error using item ${item.name}:`, err);
          });
        }
      } else if (typeof itemAny.roll === 'function') {
        // Some items have a roll method
        itemAny.roll().catch((err: Error) => {
          console.error(`[foundry-mcp-bridge] Error using item ${item.name}:`, err);
        });
      } else {
        // Generic fallback: create a chat message
        const chatData = {
          user: game.user?.id,
          speaker: ChatMessage.getSpeaker({ actor }),
          content: `<h3>${item.name}</h3><p>${actor.name} uses ${item.name}.</p>`,
        };
        ChatMessage.create(chatData).catch((err: Error) => {
          console.error(`[foundry-mcp-bridge] Error posting use of ${item.name}:`, err);
        });
      }

      const targetInfo =
        resolvedTargetNames.length > 0
          ? ` targeting ${resolvedTargetNames.join(', ')}`
          : targetsNotSet
            ? headless
              ? ` (targets not set: ${targetsNotSet}; name them again)`
              : ` (targets not set: ${targetsNotSet}; pick them in Foundry before confirming the dialog)`
            : '';

      const result: UseItemResult = {
        success: true,
        status: 'initiated',
        message: `Item use initiated for ${actor.name} using ${item.name}${autoUpcast ? ` at level ${autoUpcast} (no slot left at its own level)` : ''}${targetInfo}. ${
          attackActivity
            ? 'The attack is rolled without a dialog; the roll appears in chat.'
            : headless && systemId === 'dnd5e'
              ? `This GM browser has no canvas, so no dialog was shown: the system defaults were used (the first activity, ${autoUpcast ? `cast at level ${autoUpcast}` : 'no upcasting unless a spell level was given'}) and the attack or damage roll is left to the buttons on the chat card. The Attack button reads the targets of whoever clicks it, not the ones named here: target the token in Foundry before clicking Attack.`
              : 'If a dialog appeared in Foundry VTT, the GM should select options and confirm.'
        } The result will appear in chat.`,
        itemName: item.name,
        actorName: actor.name,
        requiresGMInteraction: !(attackActivity ?? (headless && systemId === 'dnd5e')),
      };

      if (resolvedTargetNames.length > 0) {
        result.targets = resolvedTargetNames;
      }

      return result;
    } catch (error) {
      throw new Error(`Failed to use item "${item.name}": ${this.errorMessage(error)}`, {
        cause: error,
      });
    }
  }

  /**
   * Trigger an NPC's attack (or other item activity) and report the attack roll,
   * hit/miss vs an AC, crit, and damage. dnd5e v3 uses Item-level rollAttack/
   * rollDamage; v4/v5 use the Activity API.
   */
  async useNpcActivity(data: UseNpcActivityInput): Promise<UseNpcActivityResult> {
    shared.validateFoundryState();
    shared.requireDnd5e('use-npc-activity');

    // Token-aware: an unlinked token (a boss) spends its own uses and legendary actions.
    const actor = shared.resolveTargetActor(data.actorName) as NpcActivityActor | undefined;
    if (!actor) throw new Error(`${ERROR_MESSAGES.CHARACTER_NOT_FOUND}: ${data.actorName}`);
    const item = actor.items.find(
      i =>
        i.id === data.itemName ||
        i.name?.toLowerCase() === data.itemName.toLowerCase() ||
        i.name?.toLowerCase().includes(data.itemName.toLowerCase()) === true
    );
    if (!item) throw new Error(`Item "${data.itemName}" not found on "${actor.name}"`);

    const major = shared.systemMajor();
    let attackTotal: number | null = null;
    let isCritical = false;
    let damageTotal: number | null = null;
    let damageByType: Array<{ type: string; total: number }> | undefined;
    let formula: string | null = null;
    let usedActivity = false;
    let attackSucceeded: boolean | null = null;

    const legactBefore = actor.system?.resources?.legact?.spent ?? null;
    let chosen: NpcAttackActivity | undefined;
    if (major >= 4) {
      const activities = item.system?.activities;
      if (data.activity) {
        const wanted = data.activity.toLowerCase();
        const all = activities?.contents ?? [];
        chosen = all.find(
          a => a.id === data.activity || a.name?.toLowerCase() === wanted || a.type === wanted
        );
        if (!chosen) {
          const names = all.map(a => a.name ?? a.type ?? '?').join(', ') || 'none';
          throw new Error(`"${item.name}" has no activity "${data.activity}" (it has: ${names})`);
        }
      }
      const attackAct =
        chosen?.type === 'attack'
          ? chosen
          : chosen
            ? undefined
            : (activities?.getByType?.('attack')?.[0] ??
              (activities?.contents ?? []).find(a => a.type === 'attack'));
      // Public unless asked otherwise; dnd5e's message config names the visibility `rollMode`.
      const message = { create: true, rollMode: shared.rollModeFor(data.isPublic !== false) };
      if (chosen && !attackAct) {
        // A save, damage, utility, heal or cast activity: use it (this posts its card and spends
        // its cost, a legendary action included), then roll its damage when it has any.
        await this.useActivity(chosen, item.name, message);
        if (typeof chosen.rollDamage === 'function' && (chosen.damage?.parts?.length ?? 0) > 0) {
          const dmgOut = await chosen.rollDamage({}, { configure: false }, message);
          const sum = sumDamage(dmgOut);
          damageTotal = sum.total;
          damageByType = sum.byType;
          const first = Array.isArray(dmgOut) ? dmgOut[0] : dmgOut;
          formula = first?.formula ?? null;
        }
      } else if (attackAct) {
        // An attack roll alone does not spend a legendary action: use the activity first.
        if (attackAct.activation?.type === 'legendary') {
          await this.useActivity(attackAct, item.name, message);
        }
        usedActivity = true;
        const atkOut = await attackAct.rollAttack({}, { configure: false }, message);
        const atk = Array.isArray(atkOut) ? atkOut[0] : atkOut;
        attackTotal = atk?.total ?? null;
        isCritical = atk?.isCritical ?? false;
        formula = atk?.formula ?? null;
        // dnd5e auto-fills the attack's target from a targeted token's AC.
        attackSucceeded = typeof atk?.isSuccess === 'boolean' ? atk.isSuccess : null;
        const dmgOut = await attackAct.rollDamage({ isCritical }, { configure: false }, message);
        const sum = sumDamage(dmgOut);
        damageTotal = sum.total;
        damageByType = sum.byType;
      } else {
        // No attack activity, just use the item (posts its card).
        await item.use({}, { configure: false }, message);
      }
    } else {
      // dnd5e v3, Item-level rolls
      const atkOpts: Record<string, unknown> = { fastForward: true };
      if (data.targetAC != null) atkOpts.targetValue = data.targetAC;
      const atk = await item.rollAttack(atkOpts);
      if (atk) {
        usedActivity = true;
        attackTotal = atk.total ?? null;
        isCritical = atk.isCritical ?? false;
        formula = atk.formula ?? null;
        attackSucceeded = typeof atk?.isSuccess === 'boolean' ? atk.isSuccess : null;
        const dmg = await item.rollDamage({
          critical: isCritical,
          options: { fastForward: true },
        });
        damageTotal = dmg?.total ?? null;
      } else {
        await item.use({}, { configureDialog: false, createMessage: true });
      }
    }

    // Resolve the target AC: explicit param wins, else the GM's targeted token.
    let targetAC = data.targetAC ?? null;
    let targetName: string | null = null;
    try {
      // The bridge user's targets, else an active GM's (the bridge may run in another browser).
      const userTargets = shared.currentTargetTokens<{
        id: string;
        name?: string;
        actor?: { system?: { attributes?: { ac?: { value?: number | null } } } } | null;
      }>();
      const ownTargets = Array.from(
        (game.user as { targets?: Iterable<unknown> } | undefined)?.targets ?? []
      );
      // A GM's targets are only a guess: use them when exactly one token is targeted, and
      // do not pair their token's name with an AC the caller passed for another creature.
      const guessed = ownTargets.length === 0;
      if (userTargets.length > 0 && (!guessed || userTargets.length === 1)) {
        const tt = userTargets[0];
        if (!guessed || data.targetAC == null) targetName = tt.name ?? null;
        targetAC ??= tt.actor?.system?.attributes?.ac?.value ?? null;
      }
    } catch {
      // no targeting available
    }

    const hit = targetAC != null && attackTotal != null ? attackTotal >= targetAC : attackSucceeded; // falls back to dnd5e's own target evaluation

    return {
      success: true,
      actor: actor.name,
      item: item.name,
      hadAttack: usedActivity,
      attackTotal,
      targetName,
      targetAC,
      hit,
      isCritical,
      damageTotal,
      ...(damageByType && damageByType.length > 0 ? { damageByType } : {}),
      formula,
      ...(chosen
        ? {
            activity: chosen.name ?? chosen.type,
            activityType: chosen.type,
            ...(chosen.type === 'save'
              ? {
                  save: {
                    abilities: Array.from(chosen.save?.ability ?? []),
                    dc: chosen.save?.dc?.value ?? null,
                    onSave: chosen.damage?.onSave ?? null,
                  },
                }
              : {}),
          }
        : {}),
      ...(legactBefore !== null
        ? {
            legendarySpent: {
              before: legactBefore,
              after: actor.system?.resources?.legact?.spent ?? legactBefore,
            },
          }
        : {}),
    };
  }

  /**
   * Use an activity for its card and cost (a legendary action included) without dnd5e rolling
   * its attack or damage by itself (this tool rolls them) and without a template to place.
   * dnd5e returns nothing when the use is refused (no uses left): that stops the roll.
   */
  private async useActivity(
    activity: NpcAttackActivity,
    itemName: string | undefined,
    message: object
  ): Promise<void> {
    const used = await activity.use?.(
      { subsequentActions: false, create: { measuredTemplate: false } },
      { configure: false },
      message
    );
    if (!used) {
      throw new Error(
        `${itemName ?? 'The item'} could not be used (no uses or legendary actions left?): nothing was rolled`
      );
    }
  }

  /** Extract a human-readable message from an unknown thrown value. */
  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }
}
