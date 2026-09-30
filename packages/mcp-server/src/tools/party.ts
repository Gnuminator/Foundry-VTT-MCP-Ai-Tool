import {
  PARTY_FEATURE_ID,
  PARTY_REST_TYPES,
  PARTY_STATE_QUERY,
  toolRef,
  type GuardedOp,
  type PartyGroup,
  type PartyState,
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

export interface PartyToolsOptions {
  foundryClient: Pick<FoundryClient, 'query'>;
  guardedWrites: Pick<GuardedWriteService, 'createPlan'>;
  logger: Logger;
}

const PARTY_ACTIONS = ['pace', 'add-to-combat', 'rest-request'] as const;

const planParams = z.object({
  action: z.enum(PARTY_ACTIONS),
  groupId: z.string().min(1).optional(),
  pace: z.string().min(1).optional(),
  rest: z.enum(PARTY_REST_TYPES).optional(),
});

function unwrap<T>(response: unknown, what: string): T {
  const r = response as { success?: unknown; error?: unknown } | null | undefined;
  if (r && typeof r === 'object' && r.success === false) {
    throw new Error(`${what}: ${typeof r.error === 'string' ? r.error : 'refused by Foundry'}`);
  }
  return response as T;
}

function names(list: string[]): string {
  return list.length > 0 ? list.join(', ') : 'nobody';
}

/**
 * The party panel (I-079): `get-party` reads the dnd5e 6 group actors through
 * the module's `getPartyState`; `plan-party-change` turns one action into a
 * guarded plan (feature "party"), applied with `apply-planned-change` and
 * reverted with `undo-change`:
 *
 * - `pace`: an update of the group's `system.attributes.travel.pace`.
 * - `add-to-combat`: creates combatants in the current encounter for member
 *   tokens on its scene that are not in it yet; without an encounter it
 *   creates one on the active scene with those combatants.
 * - `rest-request`: creates dnd5e's rest request chat card (built by the
 *   module); each player clicks it to rest. Undo removes the card, and only
 *   while nobody has used it (a used card reports a conflict).
 */
export class PartyTools {
  private readonly options: PartyToolsOptions;
  private readonly logger: Logger;

  constructor(options: PartyToolsOptions) {
    this.options = options;
    this.logger = options.logger.child({ component: 'PartyTools' });
  }

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'get-party',
        description:
          "GM ONLY. The dnd5e party (group actors, the primary party first): each member's HP, AC, passive Perception, conditions, exhaustion, hit dice and tokens on the current scene (and whether they are in the encounter), the travel pace and whether a slowed member forces slow pace, plus the current encounter. Read-only.",
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'plan-party-change',
        description:
          'Plan one party action; nothing changes until apply-planned-change (the GM confirms, and the "AI Tool: Party (writes)" switch must be on). action "pace": set the travel pace ("pace": slow, normal or fast). "add-to-combat": add the members\' tokens on the current scene to the encounter (starts one when there is none). "rest-request": post dnd5e\'s short or long rest request card ("rest"), which each player clicks to rest. Uses the primary party unless groupId names another group. Returns a planId; undo-change reverts it (a rest request card only while nobody has rested from it).',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: [...PARTY_ACTIONS],
              description: 'What to plan: pace, add-to-combat or rest-request.',
            },
            groupId: {
              type: 'string',
              description: 'The group actor id; default the primary party (else the only group).',
              ...toolRef('actor', 'id', { filter: { types: ['group'] } }),
            },
            pace: {
              type: 'string',
              enum: ['slow', 'normal', 'fast'],
              description: 'For action "pace": the new travel pace.',
            },
            rest: {
              type: 'string',
              enum: [...PARTY_REST_TYPES],
              description: 'For action "rest-request": short or long (default long).',
            },
          },
          required: ['action'],
        },
      },
    ];
  }

  private async readState(): Promise<PartyState> {
    const response: unknown = await this.options.foundryClient.query(
      `foundry-mcp-bridge.${PARTY_STATE_QUERY}`,
      {}
    );
    return unwrap<PartyState>(response, 'Could not read the party');
  }

  async handleGetParty(_args: unknown): Promise<PartyState> {
    return this.readState();
  }

  async handlePlanPartyChange(args: unknown): Promise<PlanView> {
    const params = planParams.parse(args ?? {});
    try {
      const state = await this.readState();
      const group = pickGroup(state, params.groupId);
      const { summary, ops } = buildChange(state, group, params);
      return await this.options.guardedWrites.createPlan({
        feature: PARTY_FEATURE_ID,
        summary,
        ops,
      });
    } catch (error) {
      this.logger.warn('Party plan not created', {
        action: params.action,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

function pickGroup(state: PartyState, groupId: string | undefined): PartyGroup {
  if (groupId) {
    const group = state.groups.find(g => g.actorId === groupId);
    if (!group) throw new Error(`No group actor with id "${groupId}"`);
    return group;
  }
  const group =
    state.groups.find(g => g.primary) ?? (state.groups.length === 1 ? state.groups[0] : undefined);
  if (group) return group;
  throw new Error(
    state.groups.length === 0
      ? 'There is no party: create a Group actor in Foundry and add the characters to it'
      : 'There is no primary party: pass groupId, or set one in Foundry (right-click the group, "Set as Primary Party")'
  );
}

function buildChange(
  state: PartyState,
  group: PartyGroup,
  params: z.infer<typeof planParams>
): { summary: string; ops: GuardedOp[] } {
  switch (params.action) {
    case 'pace':
      return paceChange(state, group, params.pace);
    case 'add-to-combat':
      return combatChange(state, group);
    case 'rest-request':
      return restChange(group, params.rest ?? 'long');
  }
}

function paceChange(
  state: PartyState,
  group: PartyGroup,
  pace: string | undefined
): { summary: string; ops: GuardedOp[] } {
  if (!pace) throw new Error('Action "pace" needs "pace" (slow, normal or fast)');
  const option = state.paceOptions.find(p => p.value === pace);
  if (state.paceOptions.length > 0 && !option) {
    throw new Error(
      `Unknown pace "${pace}"; one of ${state.paceOptions.map(p => p.value).join(', ')}`
    );
  }
  const current = group.pace;
  if (current && current.value === pace && !current.slowed) {
    throw new Error(`${group.name} already travels at ${current.label} pace`);
  }
  const label = option?.label ?? pace;
  const was = current ? ` (was ${current.label})` : '';
  return {
    summary: `Set ${group.name}'s travel pace to ${label}${was}`,
    ops: [{ kind: 'update', uuid: group.uuid, changes: { 'system.attributes.travel.pace': pace } }],
  };
}

function combatChange(state: PartyState, group: PartyGroup): { summary: string; ops: GuardedOp[] } {
  const scene = state.scene;
  if (!scene) throw new Error('No active scene: activate the scene with the party tokens first');
  const toAdd = group.members.flatMap(member =>
    member.tokens.filter(token => !token.inCombat).map(token => ({ member, token }))
  );
  if (toAdd.length === 0) {
    const anyToken = group.members.some(m => m.tokens.length > 0);
    throw new Error(
      anyToken
        ? `Every member token on "${scene.name}" is already in the encounter`
        : `No member of ${group.name} has a token on "${scene.name}"`
    );
  }
  const combatants = toAdd.map(({ member, token }) => ({
    tokenId: token.tokenId,
    sceneId: scene.sceneId,
    actorId: member.actorId,
  }));
  const who = names(toAdd.map(({ token }) => token.name || '?'));
  if (state.encounter) {
    return {
      summary: `Add ${who} to the encounter on "${scene.name}"`,
      ops: combatants.map(data => ({
        kind: 'create' as const,
        documentName: 'Combatant',
        parentUuid: state.encounter?.uuid ?? '',
        data,
      })),
    };
  }
  return {
    summary: `Start an encounter on "${scene.name}" with ${who}`,
    ops: [
      {
        kind: 'create',
        documentName: 'Combat',
        data: { scene: scene.sceneId, active: true, combatants },
      },
    ],
  };
}

function restChange(
  group: PartyGroup,
  rest: 'short' | 'long'
): { summary: string; ops: GuardedOp[] } {
  const card = group.restCards[rest];
  if (!card) throw new Error(`Foundry did not provide a ${rest} rest request (is dnd5e 6 loaded?)`);
  const targets = (card.system as { targets?: unknown[] } | undefined)?.targets ?? [];
  if (targets.length === 0) throw new Error(`${group.name} has no members who can rest`);
  const who = names(group.members.filter(m => m.hp !== null).map(m => m.name));
  return {
    summary: `Post a ${rest} rest request for ${group.name} (${who})`,
    ops: [{ kind: 'create', documentName: 'ChatMessage', data: card }],
  };
}
