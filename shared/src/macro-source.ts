/**
 * Macro forge (I-189): the rules a script macro must pass before the AI may create it.
 *
 * `plan-macro` plans one `create` op on a Macro; the module checks the same rules again when the
 * plan is applied (`assertMacroCreateData`). A macro runs in the GM's browser with the GM's
 * rights, so the rules keep it to the open world: no network, storage, other pages or dynamic
 * code. The source is parsed and checked against an allowlist (`macro-scan.ts`). That lowers the
 * chance of a macro that reaches outside the world; it is not a sandbox. The controls that carry
 * the weight are that the full source is shown in the plan, that the GM confirms, that only the
 * GM can see or run the macro and that the create can be undone.
 *
 * No Node and no zod, so the browser bundle of the module can use it.
 */
import { scanMacroAst, type MacroSourceProblem } from './macro-scan.js';

export type { MacroSourceProblem };

/** The guarded feature switch ("AI Tool: Macro forge (writes)"), off by default. */
export const MACRO_FORGE_FEATURE_ID = 'macro-forge';

/** The flag (`flags.foundry-mcp-bridge.macroForge`) set on every macro the forge creates. */
export const MACRO_FORGE_FLAG = 'macroForge';

/** Foundry's CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE: nobody but a GM sees or runs the macro. */
export const MACRO_OWNERSHIP_NONE = 0;

/** Longest source the forge accepts, in characters. */
export const MACRO_MAX_SOURCE = 20000;

/**
 * Scan macro source text. Returns the problems found, empty when it passes. The source is parsed,
 * so escapes, comments and split strings cannot hide a banned name.
 */
export function scanMacroSource(source: string): MacroSourceProblem[] {
  if (source.trim() === '') {
    return [{ rule: 'empty', match: 'the source is empty' }];
  }
  if (source.length > MACRO_MAX_SOURCE) {
    return [
      {
        rule: 'size',
        match: `${source.length} characters (limit ${MACRO_MAX_SOURCE})`,
      },
    ];
  }
  return scanMacroAst(source);
}

/** One line for an error message: every problem, plainly. */
export function describeMacroProblems(problems: MacroSourceProblem[]): string {
  return problems.map(p => `${p.rule} ("${p.match}")`).join('; ');
}

/** What a macro does to the world, found by reading its source: plain English, one line each. */
const EFFECT_HINTS: Array<[RegExp, string]> = [
  [
    /\bChatMessage\s*\.\s*create\b|\.toMessage\s*\(|\.roll\s*\(|\bnew\s+Roll\b|\.evaluate\s*\(/,
    'rolls dice or posts a chat message',
  ],
  [
    /\.update\s*\(|\.updateEmbeddedDocuments\s*\(|\.setFlag\s*\(|\.unsetFlag\s*\(|\.modifyTokenAttribute\s*\(|\.applyDamage\s*\(|\.applyHealing\s*\(/,
    'changes existing documents (hit points, flags, tokens, and so on)',
  ],
  [
    /\.create\s*\(|\.createEmbeddedDocuments\s*\(|\.createDocuments\s*\(|\.createCombat\s*\(/,
    'creates new documents',
  ],
  [/\.delete\s*\(|\.deleteEmbeddedDocuments\s*\(|\.deleteDocuments\s*\(/, 'deletes documents'],
  [
    /\.activate\s*\(|\.view\s*\(|\.pan\s*\(|\.animatePan\s*\(/,
    'changes the scene or moves the view',
  ],
  [/\bPlaylist\b|\.playAll\s*\(|\.stopAll\s*\(|\.playSound\s*\(/, 'plays or stops sound'],
  [
    /\bDialog\b|\.prompt\s*\(|\.confirm\s*\(|\bApplication\b|\.render\s*\(/,
    'opens a dialog or window',
  ],
  [/ui\s*\.\s*notifications|\.notify\s*\(|\.warn\s*\(|\.info\s*\(/, 'shows a notification'],
  [/\bsettings\s*\.\s*set\s*\(/, 'changes a game setting'],
  [
    /\.rollInitiative\s*\(|\.nextTurn\s*\(|\.nextRound\s*\(|\.startCombat\s*\(|\.endCombat\s*\(/,
    'moves combat along',
  ],
  [
    /\.toggleEffect\s*\(|\.toggleStatusEffect\s*\(|\bActiveEffect\b/,
    'adds or removes conditions and effects',
  ],
  [
    /\.use\s*\(|\.rollAttack\s*\(|\.rollDamage\s*\(|\.rollSavingThrow\s*\(|\.rollAbilityCheck\s*\(/,
    'uses an item or rolls for an actor',
  ],
];

/** Plain-English lines for what the source appears to do. Reads only; a hint, not a promise. */
export function summarizeMacroEffects(source: string): string[] {
  const lines = EFFECT_HINTS.filter(([re]) => re.test(source)).map(([, text]) => text);
  return lines.length > 0 ? lines : ['reads from the world and shows nothing (no writes found)'];
}

/**
 * The data of a Macro the forge may create: a script macro, GM-only, flagged, with a name and a
 * source that passes {@link scanMacroSource}. Used by the plan tool and, mirrored by the same
 * function, at apply time in the module. `mode` is the guarded-write mode: an undo (which also
 * re-creates a macro when a delete is undone) restores what Foundry recorded, including the
 * creating GM as an owner, so only an apply must carry nothing but `default: 0`.
 */
export function assertMacroCreateData(
  feature: string,
  data: Record<string, unknown>,
  mode: 'apply' | 'undo' = 'apply'
): void {
  const allowedFeatures = [MACRO_FORGE_FEATURE_ID, 'change-undo', 'rollback'];
  if (!allowedFeatures.includes(feature)) {
    throw new Error(
      `Creating a Macro is only allowed for the "${MACRO_FORGE_FEATURE_ID}" feature (got "${feature}")`
    );
  }
  const odd = Object.keys(data).find(key => key.includes('.') || /^[-=]=/.test(key));
  if (odd !== undefined) {
    throw new Error(`A created Macro may not use the key "${odd}" (plain fields only)`);
  }
  if (typeof data.name !== 'string' || data.name.trim() === '') {
    throw new Error('A created Macro needs a name');
  }
  if (data.type !== 'script') {
    throw new Error(`A created Macro must be a script macro (got ${JSON.stringify(data.type)})`);
  }
  const ownership = data.ownership as Record<string, unknown> | undefined;
  const strict = feature === MACRO_FORGE_FEATURE_ID && mode === 'apply';
  if (
    !ownership ||
    typeof ownership !== 'object' ||
    ownership.default !== MACRO_OWNERSHIP_NONE ||
    (strict && Object.keys(ownership).some(k => k !== 'default'))
  ) {
    throw new Error('A created Macro must be GM only (ownership: { default: 0 } and nothing else)');
  }
  if (typeof data.command !== 'string') {
    throw new Error('A created Macro needs a command (the script text)');
  }
  const problems = scanMacroSource(data.command);
  if (problems.length > 0) {
    throw new Error(`The macro source is not allowed: ${describeMacroProblems(problems)}`);
  }
}
