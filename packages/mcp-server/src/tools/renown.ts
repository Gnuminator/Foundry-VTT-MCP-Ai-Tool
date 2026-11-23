import {
  PARTY_FEATURE_ID,
  RENOWN_ACTIONS,
  RENOWN_ADJUSTMENT_PREFIX,
  RENOWN_STATE_QUERY,
  freeText,
  toolRef,
  type GuardedOp,
  type RenownFaction,
  type RenownHolder,
  type RenownState,
} from '@gnuminator/shared';
import { z } from 'zod';

import type { FoundryClient } from '../foundry-client.js';
import type { GuardedWriteService, PlanView } from '../guarded-write/service.js';
import type { Logger } from '../logger.js';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface RenownToolsOptions {
  foundryClient: Pick<FoundryClient, 'query'>;
  guardedWrites: Pick<GuardedWriteService, 'createPlan'>;
  logger: Logger;
}

const planParams = z.object({
  action: z.enum(RENOWN_ACTIONS),
  actorId: z.string().min(1).optional(),
  faction: z.string().min(1).optional(),
  amount: z.number().int().optional(),
  factionId: z.string().min(1).optional(),
  member: z.string().min(1).optional(),
  rank: z.string().optional(),
  role: z.string().optional(),
});

type PlanParams = z.infer<typeof planParams>;

function unwrap<T>(response: unknown, what: string): T {
  const r = response as { success?: unknown; error?: unknown } | null | undefined;
  if (r && typeof r === 'object' && r.success === false) {
    throw new Error(`${what}: ${typeof r.error === 'string' ? r.error : 'refused by Foundry'}`);
  }
  return response as T;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/**
 * Factions and renown (dnd5e 6.1, D-146): `get-renown` reads the faction actors (ranks, members)
 * and every actor's renown through the module's `getRenownState`; `plan-renown-change` turns one
 * action into a guarded plan (feature "party"), applied with `apply-planned-change` and reverted
 * with `undo-change`:
 *
 * - `adjust` / `set`: change an actor's renown with a faction. dnd5e sums the modifiers of an
 *   actor's renown items, so the plan creates (or updates) one item named "Renown adjustment:
 *   <faction>" that carries the difference; items the GM made by hand are left alone.
 * - `set-member`: add a member to a faction, or change a member's rank and role.
 */
export class RenownTools {
  private readonly options: RenownToolsOptions;
  private readonly logger: Logger;

  constructor(options: RenownToolsOptions) {
    this.options = options;
    this.logger = options.logger.child({ component: 'RenownTools' });
  }

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'get-renown',
        description:
          'dnd5e 6.1 factions and renown: each faction actor (identifier, category, ranks with the renown each needs, members with rank and role) and each character or group that holds renown items, with its renown per faction and the rank that reaches. Says when the "Renown Scores" world setting is off. Read-only. GM only: not for player chat.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'plan-renown-change',
        description:
          'Plan one faction or renown change; nothing changes until apply-planned-change (the GM confirms; needs the "AI Tool: Party (writes)" switch and the dnd5e "Renown Scores" setting). action "adjust": add "amount" (may be negative) to an actor\'s renown with a faction. "set": make the actor\'s renown with the faction exactly "amount". Both create or update one renown item named "Renown adjustment: <faction>" on the actor (a character or a group); the faction is its identifier or name. "set-member": put the actor "member" in the faction actor "factionId", or change its rank ("rank" is a rank id from get-renown) and role. Returns a planId; undo-change reverts it.',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: [...RENOWN_ACTIONS],
              description: 'What to plan: adjust, set or set-member.',
            },
            actorId: {
              type: 'string',
              description: 'For adjust and set: the character or group actor id.',
              ...toolRef('actor', 'id', { filter: { types: ['character', 'npc', 'group'] } }),
            },
            faction: {
              type: 'string',
              description: 'For adjust and set: the faction identifier or name.',
              ...freeText('A faction identifier or name, as get-renown lists them'),
            },
            amount: {
              type: 'integer',
              description: 'For adjust: the change (may be negative). For set: the new score.',
            },
            factionId: {
              type: 'string',
              description: 'For set-member: the faction actor id.',
              ...toolRef('actor', 'id', { filter: { types: ['faction'] } }),
            },
            member: {
              type: 'string',
              description: 'For set-member: the member actor id.',
              ...toolRef('actor', 'id', { filter: { types: ['character', 'npc'] } }),
            },
            rank: { type: 'string', description: 'For set-member: the rank id (empty for none).' },
            role: { type: 'string', description: 'For set-member: the role text.' },
          },
          required: ['action'],
        },
      },
    ];
  }

  private async readState(): Promise<RenownState> {
    const response: unknown = await this.options.foundryClient.query(
      `foundry-mcp-bridge.${RENOWN_STATE_QUERY}`,
      {}
    );
    return unwrap<RenownState>(response, 'Could not read renown');
  }

  /** The creature list is only for plan-renown-change's checks, not an answer for Claude. */
  async handleGetRenown(_args: unknown): Promise<Omit<RenownState, 'creatures'>> {
    const { creatures: _creatures, ...state } = await this.readState();
    return state;
  }

  async handlePlanRenownChange(args: unknown): Promise<PlanView> {
    const params = planParams.parse(args ?? {});
    try {
      const state = await this.readState();
      const { summary, ops } =
        params.action === 'set-member' ? memberChange(state, params) : scoreChange(state, params);
      return await this.options.guardedWrites.createPlan({
        feature: PARTY_FEATURE_ID,
        summary,
        ops,
      });
    } catch (error) {
      this.logger.warn('Renown plan not created', {
        action: params.action,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

function findFaction(state: RenownState, text: string): { id: string; name: string } {
  const key = text.trim().toLowerCase();
  const actor = state.factions.find(
    f => f.identifier.toLowerCase() === key || f.name.toLowerCase() === key
  );
  if (actor) return { id: actor.identifier, name: actor.name };
  for (const holder of state.holders) {
    const score = holder.scores.find(s => s.faction.toLowerCase() === key);
    if (score) return { id: score.faction, name: score.factionName };
  }
  const known = state.factions.map(f => `${f.name} (${f.identifier})`).join(', ');
  throw new Error(
    `No faction "${text}"${known ? `; known: ${known}` : '; there are no faction actors yet'}. ` +
      'Only faction actors in the world count; a faction that sits in a compendium (a module) must be imported into the world first.'
  );
}

function scoreChange(
  state: RenownState,
  params: PlanParams
): { summary: string; ops: GuardedOp[] } {
  if (!state.enabled) {
    throw new Error('Renown is off: turn on "Renown Scores" in the dnd5e system settings first');
  }
  if (!params.actorId) throw new Error(`Action "${params.action}" needs "actorId"`);
  if (!params.faction) throw new Error(`Action "${params.action}" needs "faction"`);
  if (params.amount === undefined) throw new Error(`Action "${params.action}" needs "amount"`);
  const faction = findFaction(state, params.faction);
  const holder = state.holders.find(h => h.actorId === params.actorId);
  const current = holder?.scores.find(s => s.faction === faction.id)?.value ?? 0;
  const target = params.action === 'set' ? params.amount : current + params.amount;
  const diff = target - current;
  const actorName = holder?.name ?? params.actorId;
  if (diff === 0) {
    throw new Error(`${actorName} already has ${current} renown with ${faction.name}`);
  }
  const summary = `Set ${actorName}'s renown with ${faction.name} to ${target} (was ${current}, ${signed(diff)})`;
  const itemName = `${RENOWN_ADJUSTMENT_PREFIX}${faction.name}`;
  const own = holder?.items.find(i => i.name === itemName);
  if (own) {
    const others = own.modifiers.filter(m => m.faction !== faction.id);
    const mine = own.modifiers
      .filter(m => m.faction === faction.id)
      .reduce((sum, m) => sum + m.value, 0);
    return {
      summary,
      ops: [
        {
          kind: 'update',
          uuid: own.uuid,
          changes: { 'system.modifiers': [...others, { faction: faction.id, value: mine + diff }] },
        },
      ],
    };
  }
  const actor = holderUuid(holder, params.actorId);
  return {
    summary,
    ops: [
      {
        kind: 'create',
        documentName: 'Item',
        parentUuid: actor,
        data: {
          name: itemName,
          type: 'renown',
          system: { modifiers: [{ faction: faction.id, value: diff }] },
        },
      },
    ],
  };
}

function holderUuid(holder: RenownHolder | undefined, actorId: string): string {
  return holder?.uuid ?? `Actor.${actorId}`;
}

function memberChange(
  state: RenownState,
  params: PlanParams
): { summary: string; ops: GuardedOp[] } {
  if (!params.factionId) throw new Error('Action "set-member" needs "factionId"');
  if (!params.member) throw new Error('Action "set-member" needs "member"');
  const faction: RenownFaction | undefined = state.factions.find(
    f => f.actorId === params.factionId
  );
  if (!faction) throw new Error(`No faction actor with id "${params.factionId}"`);
  if (!state.enabled) {
    throw new Error('Renown is off: turn on "Renown Scores" in the dnd5e system settings first');
  }
  const creature = state.creatures.find(c => c.actorId === params.member);
  if (!creature) {
    throw new Error(
      `"${params.member}" is not a character or NPC actor id; only those can join a faction`
    );
  }
  const rank = params.rank;
  if (rank && !faction.ranks.some(r => r.id === rank)) {
    throw new Error(
      faction.ranks.length > 0
        ? `${faction.name} has no rank "${rank}"; one of ${faction.ranks.map(r => r.id).join(', ')}`
        : `${faction.name} has no ranks, so "rank" must be empty`
    );
  }
  const uuid = `Actor.${params.member}`;
  const existing = faction.members.find(m => m.uuid === uuid);
  const next = {
    uuid,
    rank: rank ?? existing?.rank ?? '',
    role: params.role ?? existing?.role ?? '',
  };
  if (existing?.rank === next.rank && existing.role === next.role) {
    throw new Error(
      `${existing.name ?? uuid} is already in ${faction.name} with that rank and role`
    );
  }
  const members = faction.members.map(m =>
    m.uuid === uuid ? next : { uuid: m.uuid, rank: m.rank, role: m.role }
  );
  if (!existing) members.push(next);
  const who = creature.name;
  const bits = [next.rank && `rank ${next.rank}`, next.role && `role ${next.role}`]
    .filter(Boolean)
    .join(', ');
  return {
    summary: `${existing ? 'Update' : 'Add'} ${who} in ${faction.name}${bits ? ` (${bits})` : ''}`,
    ops: [{ kind: 'update', uuid: faction.uuid, changes: { 'system.members': members } }],
  };
}
