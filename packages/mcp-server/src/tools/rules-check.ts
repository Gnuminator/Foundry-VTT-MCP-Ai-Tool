import { z } from 'zod';
import {
  AT_THE_TABLE,
  RULES_CHECK_FEATURE_ID,
  toolRef,
  unwrapBridgeReply,
  type LiveMoveFact,
  type LiveTargetPreview,
  type RulesCheckResult,
} from '@gnuminator/shared';
import type { FoundryClient } from '../foundry-client.js';
import type { Logger } from '../logger.js';
import {
  evaluateAction,
  evaluateMovement,
  type CombatFact,
  type MoveFact,
  type SlotFact,
  type UsesFact,
} from '../rules-check/evaluate.js';

export interface RulesCheckToolsOptions {
  foundryClient: Pick<FoundryClient, 'query'>;
  logger: Logger;
}

const params = z.object({
  actor: z.string().min(1),
  item: z.string().min(1),
  target: z.string().min(1).optional(),
  activity: z.string().min(1).optional(),
  castLevel: z.number().int().min(1).max(9).optional(),
});

const SWITCH_OFF =
  'The rules check is switched off. In Foundry, open Game Settings, Configure Settings, AI Tool and turn on "AI Tool: Rules check".';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v !== null && typeof v === 'object' ? (v as Rec) : {});
const text = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/**
 * The item's own range as a label ("150/600 ft", "5 ft", "Self"), else null. A ranged weapon's
 * activity label shows only the long range, so the item's `system.range` wins when it has numbers.
 */
export function itemRangeLabel(system: Rec, attack?: 'melee' | 'ranged' | null): string | null {
  const range = rec(system.range);
  const units = text(range.units);
  if (units === 'self' || units === 'touch') return units;
  // A melee attack uses the reach even when the item can also be thrown (value/long).
  if (attack === 'melee' && typeof range.reach === 'number' && range.reach > 0) {
    return `${range.reach} ft`;
  }
  if (typeof range.value === 'number' && range.value > 0) {
    const long = typeof range.long === 'number' && range.long > 0 ? `/${range.long}` : '';
    return `${range.value}${long} ${units ?? 'ft'}`;
  }
  if (typeof range.reach === 'number' && range.reach > 0) return `${range.reach} ft`;
  return null;
}

/** One activity's source data from `system.activities`: an array (as the bridge sends it) or a map by id. */
export function findActivityData(activities: unknown, id: string | undefined): Rec {
  if (!id) return {};
  const list = Array.isArray(activities) ? activities : Object.values(rec(activities));
  const found = list.map(rec).find(a => a._id === id || a.id === id);
  return found ?? rec(rec(activities)[id]);
}

/** Whether a spell is ready to cast (the module's `spellPrepared` rule, for the sanitized system data). */
export function spellPrepared(system: Rec, level: unknown): boolean {
  if (typeof level !== 'number' || level === 0) return true;
  const method = text(system.method);
  if (method && method !== 'spell' && method !== 'pact') return true;
  if (typeof system.prepared === 'boolean') return system.prepared;
  // Not reported at all: do not call it unprepared.
  return typeof system.prepared === 'number' ? system.prepared >= 1 : true;
}

function usesFrom(v: unknown): UsesFact | null {
  const u = rec(v);
  return typeof u.max === 'number' && typeof u.value === 'number'
    ? { value: u.value, max: u.max, recovery: text(u.recovery) ?? null }
    : null;
}

/**
 * Rules check (I-126). `check-action` reads whether an item, spell or attack looks legal right now
 * (turn, activation cost, range to a target, spell slots and uses left) and says why. It writes
 * nothing and composes existing read queries, so the module needs no handler of its own. Off by
 * default (feature `rules-check`).
 */
export class RulesCheckTools {
  private readonly foundryClient: Pick<FoundryClient, 'query'>;
  private readonly logger: Logger;

  constructor(options: RulesCheckToolsOptions) {
    this.foundryClient = options.foundryClient;
    this.logger = options.logger.child({ component: 'RulesCheckTools' });
  }

  getToolDefinitions(): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }> {
    return [
      {
        name: 'check-action',
        description:
          'Rules check (off by default). Says whether an attack, spell or item looks legal and why: turn, cost, range to a target, spell slots and uses left. Cannot see actions already spent this turn. Read-only.',
        inputSchema: {
          type: 'object',
          properties: {
            actor: {
              type: 'string',
              description: 'Actor name or ID.',
              ...toolRef('actor', 'id', { filter: AT_THE_TABLE }),
            },
            item: { type: 'string', description: 'Item or spell name or ID.' },
            target: {
              type: 'string',
              description: 'Target token name, for range.',
              ...toolRef('token', 'name'),
            },
            activity: {
              type: 'string',
              description: 'Activity name or ID (default: first).',
            },
            castLevel: {
              type: 'integer',
              minimum: 1,
              maximum: 9,
              description: 'Level to cast at (default: its own or lowest slot left).',
            },
          },
          required: ['actor', 'item'],
        },
      },
    ];
  }

  async handleToolCall(name: string, args: unknown): Promise<RulesCheckResult> {
    if (name !== 'check-action') throw new Error(`Unknown rules check tool: ${name}`);
    try {
      return await this.checkAction(args);
    } catch (error) {
      this.logger.error('Error in check-action:', error);
      throw error;
    }
  }

  /**
   * The advisory pre-check other tools run before a roll or a use: null when the switch is off or
   * anything goes wrong, so it never blocks or fails the write it sits in front of.
   */
  async tryCheck(args: unknown): Promise<RulesCheckResult | null> {
    try {
      return await this.checkAction(args);
    } catch (error) {
      if (!(error instanceof Error && error.message === SWITCH_OFF)) {
        // Often just a player name that is not an actor, or a free-text weapon label.
        this.logger.debug('Rules pre-check skipped', error);
      }
      return null;
    }
  }

  /** The advisory movement check for planned token moves; null when off, outside a fight or on any error. */
  async tryCheckMove(targets: LiveTargetPreview[]): Promise<RulesCheckResult | null> {
    try {
      const moves = targets.filter((t): t is LiveTargetPreview & { move: LiveMoveFact } =>
        Boolean(t.move && !t.skipped)
      );
      if (moves.length === 0) return null;
      await this.requireOn();
      const facts: MoveFact[] = [];
      const state = await this.combatState();
      for (const t of moves) {
        // The preview's uuid ends in the token id: "Scene.<id>.Token.<id>".
        const tokenId = /\.Token\.([^.]+)$/.exec(t.actorUuid)?.[1];
        const { combat } = this.combatFrom(state, undefined, t.target, tokenId);
        facts.push({ name: t.target, combat, ...t.move });
      }
      return evaluateMovement(facts);
    } catch (error) {
      if (!(error instanceof Error && error.message === SWITCH_OFF)) {
        this.logger.warn('Rules movement pre-check skipped', error);
      }
      return null;
    }
  }

  private async requireOn(): Promise<void> {
    const features = unwrapBridgeReply(
      await this.foundryClient.query('foundry-mcp-bridge.listGuardedFeatures'),
      'Feature list refused'
    );
    if (!features.find(f => f.id === RULES_CHECK_FEATURE_ID)?.enabled) throw new Error(SWITCH_OFF);
  }

  private async checkAction(args: unknown): Promise<RulesCheckResult> {
    const p = params.parse(args ?? {});
    await this.requireOn();

    const resources = rec(
      await this.foundryClient.query('foundry-mcp-bridge.getCharacterResources', {
        identifier: p.actor,
      })
    );
    this.refused(resources, 'Could not read the actor');
    const actorName = text(resources.actorName) ?? p.actor;
    const actorId = text(resources.actorId);

    const entityReply = rec(
      await this.foundryClient.query('foundry-mcp-bridge.getCharacterEntity', {
        characterIdentifier: actorId ?? p.actor,
        entityIdentifier: p.item,
      })
    );
    this.refused(entityReply, 'Could not read the item');
    const entity = rec(entityReply.entity);
    if (entityReply.entityType !== 'item') {
      throw new Error(`"${p.item}" is an effect on ${actorName}, not an item that can be used.`);
    }

    const activities = Array.isArray(entity.activities) ? entity.activities.map(rec) : [];
    const wanted = p.activity?.toLowerCase();
    const activity = wanted
      ? activities.find(a => a.id === p.activity || text(a.name)?.toLowerCase() === wanted)
      : activities[0];
    if (wanted && !activity) {
      const names = activities.map(a => text(a.name) ?? text(a.id)).join(', ');
      throw new Error(
        `${entity.name as string} has no activity "${p.activity}". It has: ${names || 'none'}.`
      );
    }

    const system = rec(entity.system);
    const isSpell = entity.type === 'spell';
    const properties: unknown[] = Array.isArray(system.properties) ? system.properties : [];
    const activityData = findActivityData(system.activities, text(activity?.id));
    const attackValue = text(rec(rec(activityData.attack).type).value);
    const npc = isSpell ? await this.isNpc(actorId ?? p.actor) : false;
    const attackType = attackValue === 'melee' || attackValue === 'ranged' ? attackValue : null;
    const { combat, tokenName } = await this.combatFact(actorId, actorName);
    const distance = p.target ? await this.distanceFact(tokenName, p.target) : undefined;

    const slots: Record<string, SlotFact> = {};
    for (const [key, raw] of Object.entries(rec(resources.spellSlots))) {
      const s = rec(raw);
      if (typeof s.current === 'number' && typeof s.max === 'number') {
        slots[key] = {
          current: s.current,
          max: s.max,
          ...(typeof s.level === 'number' ? { level: s.level } : {}),
        };
      }
    }

    return evaluateAction({
      actor: actorName,
      item: text(entity.name) ?? p.item,
      spellLevel: isSpell ? (typeof entity.level === 'number' ? entity.level : 0) : null,
      castLevel: p.castLevel ?? null,
      activation: text(activity?.activation) ?? text(rec(system.activation).type),
      spellMethod: isSpell ? (text(system.method) ?? null) : null,
      ritual: isSpell && properties.includes('ritual'),
      prepared: !isSpell || npc || spellPrepared(system, entity.level),
      npc,
      range: itemRangeLabel(system, attackType) ?? text(activity?.range),
      combat,
      target: p.target,
      distance,
      slots,
      needsConcentration: isSpell && properties.includes('concentration'),
      concentration: this.concentrationFact(resources.concentration),
      uses: [usesFrom(entity.uses), usesFrom(activity?.uses)].filter(
        (u): u is UsesFact => u !== null
      ),
    });
  }

  private concentrationFact(raw: unknown): { active: boolean; spell: string | null } | undefined {
    const c = rec(raw);
    return typeof c.active === 'boolean'
      ? { active: c.active, spell: text(c.spell) ?? null }
      : undefined;
  }

  /** Whether the actor is an NPC (false when it cannot be read). */
  private async isNpc(identifier: string): Promise<boolean> {
    try {
      const info = rec(
        await this.foundryClient.query('foundry-mcp-bridge.getCharacterInfo', {
          characterName: identifier,
        })
      );
      return info.type === 'npc';
    } catch (error) {
      this.logger.warn('Rules check: actor type unavailable', error);
      return false;
    }
  }

  private refused(reply: Rec, what: string): void {
    if (reply.success === false) {
      throw new Error(`${what}: ${text(reply.error) ?? 'refused by Foundry'}`);
    }
  }

  /** The encounter facts and the actor's token name (the combatant's name, else the actor's). */
  private async combatFact(
    actorId: string | undefined,
    actorName: string
  ): Promise<{ combat: CombatFact; tokenName: string }> {
    return this.combatFrom(await this.combatState(), actorId, actorName);
  }

  /** The running encounter as the bridge reports it; null when none runs or it cannot be read. */
  private async combatState(): Promise<Rec | null> {
    try {
      const state = rec(await this.foundryClient.query('foundry-mcp-bridge.getCombatState', {}));
      return state.success === false || state.active !== true ? null : state;
    } catch (error) {
      this.logger.warn('Rules check: combat state unavailable', error);
      return null;
    }
  }

  /** `tokenId` (a planned token move) pins the combatant exactly; names are the fallback. */
  private combatFrom(
    state: Rec | null,
    actorId: string | undefined,
    actorName: string,
    tokenId?: string
  ): { combat: CombatFact; tokenName: string } {
    if (!state) return { combat: { active: false }, tokenName: actorName };
    const combatants = Array.isArray(state.combatants) ? state.combatants.map(rec) : [];
    let mine: Rec | undefined;
    let ambiguous = false;
    if (tokenId !== undefined) {
      mine = combatants.find(c => c.tokenId === tokenId);
    } else {
      // Unlinked tokens share an actor id: take the one named like the actor, else give up on turns.
      const byActor = combatants.filter(c => actorId !== undefined && c.actorId === actorId);
      const pool = byActor.length > 0 ? byActor : combatants.filter(c => c.name === actorName);
      const exact = pool.find(c => c.name === actorName);
      mine = exact ?? (pool.length === 1 ? pool[0] : undefined);
      ambiguous = mine === undefined && pool.length > 1;
    }
    return {
      combat: {
        active: true,
        round: typeof state.round === 'number' ? state.round : 0,
        inCombat: mine !== undefined || ambiguous,
        ...(ambiguous ? { ambiguous: true } : {}),
        isCurrentTurn: mine?.isCurrentTurn === true,
        currentName: text(rec(state.current).name) ?? null,
      },
      tokenName: text(mine?.name) ?? actorName,
    };
  }

  private async distanceFact(
    from: string,
    to: string
  ): Promise<{ feet: number | null; error?: string }> {
    try {
      const reply = rec(
        await this.foundryClient.query('foundry-mcp-bridge.measureDistance', {
          fromTokenName: from,
          toTokenName: to,
        })
      );
      if (reply.success === false) return { feet: null, error: text(reply.error) ?? 'refused' };
      const units = text(reply.units)?.toLowerCase() ?? '';
      const feet = typeof reply.distance === 'number' ? reply.distance : null;
      if (feet !== null && units && !/^(ft|feet|foot)/.test(units)) {
        return { feet: null, error: `the scene measures in ${units}, not feet` };
      }
      return { feet };
    } catch (error) {
      return { feet: null, error: error instanceof Error ? error.message : 'measure failed' };
    }
  }
}
