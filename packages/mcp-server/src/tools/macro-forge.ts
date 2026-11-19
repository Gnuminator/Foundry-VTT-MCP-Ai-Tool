import { z } from 'zod';
import {
  MACRO_FORGE_FEATURE_ID,
  MACRO_FORGE_FLAG,
  MACRO_MAX_SOURCE,
  MACRO_OWNERSHIP_NONE,
  MODULE_ID,
  describeMacroProblems,
  freeText,
  scanMacroSource,
  summarizeMacroEffects,
  type GuardedOp,
} from '@gnuminator/shared';
import type { GuardedWriteService, PlanView } from '../guarded-write/service.js';
import { Logger } from '../logger.js';

interface MacroForgeToolsOptions {
  guardedWrites: Pick<GuardedWriteService, 'createPlan'>;
  logger: Logger;
}

const planParams = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().min(10).max(600),
  source: z.string().max(MACRO_MAX_SOURCE),
});

/**
 * `plan-macro` (I-189): plans one script Macro as a guarded change (feature "macro-forge", off by
 * default). The plan shows the full source and a plain-English summary; the macro is created
 * GM-only (ownership default none) and flagged; apply-planned-change creates it, undo-change
 * deletes it. The source is scanned before the plan exists and again by the module at apply time
 * (shared/src/macro-source.ts): no network, storage, other pages or dynamic code.
 */
export class MacroForgeTools {
  private guardedWrites: Pick<GuardedWriteService, 'createPlan'>;
  private logger: Logger;

  constructor({ guardedWrites, logger }: MacroForgeToolsOptions) {
    this.guardedWrites = guardedWrites;
    this.logger = logger.child({ component: 'MacroForgeTools' });
  }

  getToolDefinitions(): Array<{ name: string; description: string; inputSchema: object }> {
    return [
      {
        name: 'plan-macro',
        description:
          'Plan a script macro (JavaScript) for the GM: created GM-only in the Macro directory, with the full source and a plain-English summary shown in the plan. Apply it with apply-planned-change, revert it with undo-change. It runs in the GM\'s browser, so keep it small and use only Foundry\'s own API (game, canvas, ui, ChatMessage, Roll, actors and tokens). The source is parsed and checked against an allowlist: only the Foundry API names (game, canvas, ui, ChatMessage, Roll, Dialog, Actor, Item, fromUuid and the usual built-ins like Math, Object, JSON), no class, `this`, `with` or module loading, no member name that reaches the network, the page, storage, other macros or dynamic code, no computed member name except a number or a counting loop variable (use Object.entries for data keys; for a random pick write xs[+Math.floor(Math.random() * xs.length)] or xs.at(Math.floor(...)), never xs[Math.floor(...)]), no picture, sound or file fields, no web address, path or markup with attributes in a string. This is a guard against mistakes, not a sandbox: the GM reads the full source in the plan before confirming. Needs the "AI Tool: Macro forge (writes)" switch.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              ...freeText('The name for the new macro, not an existing document'),
              description: 'The macro name shown in the Macro directory (max 60 characters).',
            },
            description: {
              type: 'string',
              ...freeText(
                'Plain-English summary of what the macro does and when the GM would run it'
              ),
              description:
                'What the macro does, in plain English for a GM who will not read the code (10 to 600 characters). Shown in the plan beside the source.',
            },
            source: {
              type: 'string',
              ...freeText('The JavaScript source of the macro, written by the AI for this plan'),
              description: `The full script text (max ${MACRO_MAX_SOURCE} characters).`,
            },
          },
          required: ['name', 'description', 'source'],
        },
      },
    ];
  }

  async handleToolCall(name: string, args: unknown): Promise<PlanView & { autoApply: false }> {
    if (name !== 'plan-macro') throw new Error(`Unknown macro forge tool: ${name}`);
    try {
      return await this.planMacro(args);
    } catch (error) {
      this.logger.error(`Error in macro forge tool ${name}:`, error);
      throw error;
    }
  }

  private async planMacro(args: unknown): Promise<PlanView & { autoApply: false }> {
    const params = planParams.parse(args ?? {});
    const problems = scanMacroSource(params.source);
    if (problems.length > 0) {
      throw new Error(
        `The macro source is not allowed, so nothing was planned: ${describeMacroProblems(problems)}`
      );
    }
    const effects = summarizeMacroEffects(params.source);
    const ops: GuardedOp[] = [
      {
        kind: 'create',
        documentName: 'Macro',
        data: {
          name: params.name,
          type: 'script',
          scope: 'global',
          command: params.source,
          // Nobody but a GM sees or runs it; the creating GM owns it as Foundry always does.
          ownership: { default: MACRO_OWNERSHIP_NONE },
          flags: { [MODULE_ID]: { [MACRO_FORGE_FLAG]: true, summary: params.description } },
        },
      },
    ];
    const plan = await this.guardedWrites.createPlan({
      feature: MACRO_FORGE_FEATURE_ID,
      summary: `Create the GM-only script macro "${params.name}": ${params.description} (Reads the source as: ${effects.join('; ')}.)`,
      ops,
      // The source is only in the op, which a plan view leaves out; a note puts it in the diff the
      // GM reads before confirming and in the audit entry.
      notes: [`Macro source (runs in the GM's browser when clicked):\n${params.source}`],
    });
    return { ...plan, autoApply: false };
  }
}
