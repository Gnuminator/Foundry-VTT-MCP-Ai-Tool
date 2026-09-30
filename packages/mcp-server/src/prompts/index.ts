/**
 * MCP prompts: the ready-made "/" prompts Claude Desktop lists, so a GM new to
 * the tool has buttons instead of having to know what to ask.
 *
 * Pure and offline: definitions, argument validation and message building only.
 * `register.ts` connects this to the MCP server. The names below are locked
 * (the GM docs refer to them); descriptions may be refined, names may not.
 */
import type { ToolSetName } from '../tool-sets.js';

import { resolveArguments } from './arguments.js';
import { encounterCheck } from './encounter-check.js';
import { npcImprov } from './npc-improv.js';
import { prepNextSession } from './prep-next-session.js';
import { revealHandout } from './reveal-handout.js';
import { rulesQuestion } from './rules-question.js';
import { sessionRecap } from './session-recap.js';
import {
  PromptError,
  type PromptDefinition,
  type PromptListing,
  type PromptResult,
} from './types.js';

export { PLAYER_RECAP_TOOLS } from './session-recap.js';
export { PromptError } from './types.js';
export type { PromptDefinition, PromptListing, PromptResult } from './types.js';

/** Every prompt, in the order Claude Desktop lists them. */
export const PROMPTS: readonly PromptDefinition[] = [
  prepNextSession,
  rulesQuestion,
  sessionRecap,
  npcImprov,
  encounterCheck,
  revealHandout,
];

/**
 * The prompts to list. With `sets`, only the prompts of those tool sets, so a
 * Claude Desktop entry lists a prompt only next to the tools it needs.
 */
export function listPrompts(sets?: readonly ToolSetName[]): PromptListing[] {
  return PROMPTS.filter(p => !sets || sets.includes(p.set)).map(p => ({
    name: p.name,
    title: p.title,
    description: p.description,
    arguments: p.arguments.map(a => ({
      name: a.name,
      description: a.description,
      required: a.required,
    })),
  }));
}

/**
 * The one user message for a prompt. Throws `PromptError` for an unknown
 * prompt, an unknown argument, a missing required argument or a bad value.
 */
export function getPrompt(
  name: string,
  rawArguments?: Readonly<Record<string, unknown>>
): PromptResult {
  const definition = PROMPTS.find(p => p.name === name);
  if (!definition) {
    throw new PromptError(
      `Unknown prompt "${name}". Prompts: ${PROMPTS.map(p => p.name).join(', ')}.`
    );
  }
  const args = resolveArguments(definition, rawArguments);
  return {
    description: definition.description,
    messages: [{ role: 'user', content: { type: 'text', text: definition.build(args) } }],
  };
}
