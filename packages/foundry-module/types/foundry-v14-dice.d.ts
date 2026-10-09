/**
 * Rolls and roll terms.
 *
 * Foundry VTT 14.368 shapes. Trailing comments are source refs relative to the Foundry app
 * folder (`common/`, `client/`). Schema fields are declared in full; client methods only where
 * useful. Fields that v14 added are optional so v13 data still type-checks.
 */

declare global {
  /** `RollOptions` (client/dice/_types.mjs:1): free-form; `flavor` is the only core key. */
  interface FoundryRollOptions {
    flavor?: string | null; // client/dice/_types.mjs:1
    [key: string]: unknown; // dnd5e adds target, advantageMode, type, ...
  }

  /** One entry of `DiceTerm#results` (client/dice/_types.mjs:4-12). */
  interface FoundryDiceTermResult {
    result: number; // client/dice/_types.mjs:5
    /** False for a dropped (keep/drop modifier) result. Absent means active. */
    active?: boolean; // client/dice/_types.mjs:6
    count?: number; // client/dice/_types.mjs:7
    success?: boolean; // client/dice/_types.mjs:8
    failure?: boolean; // client/dice/_types.mjs:9
    discarded?: boolean; // client/dice/_types.mjs:10
    rerolled?: boolean; // client/dice/_types.mjs:11
    exploded?: boolean; // client/dice/_types.mjs:12
  }

  /** Base of every term (client/dice/terms/term.mjs). */
  interface FoundryRollTerm {
    options: FoundryRollOptions; // client/dice/terms/term.mjs:28
    readonly isIntermediate: boolean; // client/dice/terms/term.mjs:48
    readonly expression: string; // client/dice/terms/term.mjs:82
    readonly formula: string; // client/dice/terms/term.mjs:90
    /** Number once evaluated; operators return their symbol. */
    readonly total: number | string | undefined; // client/dice/terms/term.mjs:100
    readonly flavor: string; // client/dice/terms/term.mjs:108
    readonly isDeterministic: boolean; // client/dice/terms/term.mjs:116
    toJSON(): Record<string, unknown>; // client/dice/terms/term.mjs:240
  }

  /** Die, Coin, FateDie (client/dice/terms/dice.mjs). `results` hold every roll including dropped ones. */
  interface FoundryDiceTerm extends FoundryRollTerm {
    /** Number of dice; undefined when still an unevaluated sub-roll. */
    readonly number: number | undefined; // client/dice/terms/dice.mjs:111
    readonly faces: number | undefined; // client/dice/terms/dice.mjs:138
    modifiers: string[]; // client/dice/terms/dice.mjs:57
    results: FoundryDiceTermResult[]; // client/dice/terms/dice.mjs:63
    /** "d", "c" or "f". */
    readonly denomination: string; // client/dice/terms/dice.mjs:171
    readonly values: number[]; // client/dice/terms/dice.mjs:208
    /** v14: fulfillment method id ("random" by default). (v13 note) added in v13. */
    readonly method?: string; // client/dice/terms/dice.mjs:42
  }

  /** A flat number inside a formula. */
  interface FoundryNumericTerm extends FoundryRollTerm {
    number: number; // client/dice/terms/numeric.mjs:16
  }

  /** `+`, `-`, `*`, `/`, `%`, `<`, ... */
  interface FoundryOperatorTerm extends FoundryRollTerm {
    operator: string; // client/dice/terms/operator.mjs:17
  }

  /** `max(...)`, `floor(...)`; `terms` are source strings, `rolls` the parsed sub-rolls. */
  interface FoundryFunctionTerm extends FoundryRollTerm {
    fn: string; // client/dice/terms/function.mjs:15
    terms: string[]; // client/dice/terms/function.mjs:16
    rolls: Roll[]; // client/dice/terms/function.mjs:17
    result: number | string | undefined; // client/dice/terms/function.mjs:18
  }

  type FoundryAnyRollTerm =
    | FoundryDiceTerm
    | FoundryNumericTerm
    | FoundryOperatorTerm
    | FoundryFunctionTerm
    | FoundryRollTerm;

  /** Options of `Roll#evaluate` (client/dice/roll.mjs:274). */
  interface FoundryRollEvaluateOptions {
    minimize?: boolean;
    maximize?: boolean;
    allowStrings?: boolean;
    allowInteractive?: boolean; // client/dice/roll.mjs:274
  }

  /**
   * Options of `Roll#toMessage` (client/dice/roll.mjs:926). v14 takes `messageMode`
   * (a key of CONFIG.ChatMessage.modes: "public", "gm", "blind", "self"); `rollMode` still works but is deprecated.
   * (v13 note) v13 takes only `rollMode` ("publicroll", "gmroll", "blindroll", "selfroll").
   */
  interface FoundryRollToMessageOptions {
    messageMode?: string; // client/dice/roll.mjs:926
    /** @deprecated since v14, removed in v16. */
    rollMode?: string; // client/dice/roll.mjs:926-929
    create?: boolean; // client/dice/roll.mjs:926
  }

  /**
   * Roll (client/dice/roll.mjs). A `ChatMessage#rolls` entry is a Roll (or a dnd5e subclass).
   * Replaces the existing `class Roll { constructor; formula; total; evaluate; toMessage }`.
   */
  class Roll {
    constructor(formula?: string, data?: Record<string, unknown>, options?: FoundryRollOptions); // client/dice/roll.mjs:35
    /** The data object substituted into `@attr` references. */
    data: Record<string, unknown>; // client/dice/roll.mjs:53
    options: FoundryRollOptions; // client/dice/roll.mjs:59
    terms: FoundryAnyRollTerm[]; // client/dice/roll.mjs:65
    /** Every DiceTerm in the roll, including those inside parentheses and pools. */
    readonly dice: FoundryDiceTerm[]; // client/dice/roll.mjs:158
    /** The displayed formula (rebuilt from terms). */
    readonly formula: string; // client/dice/roll.mjs:173
    /** The arithmetic expression after rolling, e.g. "12 + 3". */
    readonly result: string; // client/dice/roll.mjs:183
    /**
     * Always a number: `Number(_total) || 0`, so 0 before evaluation. (The current d.ts says
     * `number | undefined`, which is wrong for v13 and v14.)
     */
    readonly total: number; // client/dice/roll.mjs:193
    readonly product: number | string; // client/dice/roll.mjs:203
    readonly isDeterministic: boolean; // client/dice/roll.mjs:213
    /** @internal */
    _evaluated: boolean; // client/dice/roll.mjs:86
    evaluate(options?: FoundryRollEvaluateOptions): Promise<this>; // client/dice/roll.mjs:274
    evaluateSync(options?: FoundryRollEvaluateOptions & { strict?: boolean }): this; // client/dice/roll.mjs:303
    clone(): Roll; // client/dice/roll.mjs:249
    reroll(options?: FoundryRollEvaluateOptions): Promise<Roll>; // client/dice/roll.mjs:475
    toMessage(
      messageData?: Record<string, unknown>,
      options?: FoundryRollToMessageOptions
    ): Promise<ChatMessage | Record<string, unknown>>; // client/dice/roll.mjs:926
    toJSON(): {
      class: string;
      options: FoundryRollOptions;
      dice: FoundryDiceTerm[];
      formula: string;
      terms: Record<string, unknown>[];
      total: number | undefined;
      evaluated: boolean;
    }; // client/dice/roll.mjs:1044
    render(options?: Record<string, unknown>): Promise<string>; // client/dice/roll.mjs:886
    static create(
      formula: string,
      data?: Record<string, unknown>,
      options?: FoundryRollOptions
    ): Roll; // client/dice/roll.mjs:519
    static fromData(data: Record<string, unknown>): Roll; // client/dice/roll.mjs:1063
    static fromJSON(json: string): Roll; // client/dice/roll.mjs:1102
    static validate(formula: string): boolean; // client/dice/roll.mjs:773
    static getFormula(terms: FoundryAnyRollTerm[]): string; // client/dice/roll.mjs:562
  }

  /**
   * Not on the core Roll: `isCritical` and `isFumble` come from dnd5e's D20Roll (and DamageRoll's `isCritical`).
   * Core Roll has no such getters. The module reads them off the dnd5e attack roll result
   * (src/data-access/actor-builder.ts:1511) and computes its own crit/fumble from d20 results
   * (src/play-recorder.ts:580-582, src/session-events.ts:562-567).
   */
  interface Dnd5eRollExtras {
    readonly isCritical?: boolean; // dnd5e D20Roll/DamageRoll (not in C:\FoundryTest\app)
    readonly isFumble?: boolean; // dnd5e D20Roll
  }
}

export {};
