/**
 * Macro forge (I-189): the rules a script macro must pass before the AI may create it.
 *
 * `plan-macro` plans one `create` op on a Macro; the module checks the same rules again when the
 * plan is applied (`assertMacroCreateAllowed`). A macro runs in the GM's browser with the GM's
 * rights, so the rules keep it to the open world: no network, no storage, no other page, no
 * dynamic code. This is a static scan of the text, a guard against the AI writing something it
 * should not (and against sloppy code), not a sandbox: the real controls are that the full source
 * is shown in the plan, that the GM confirms, that only the GM can see or run the macro and that
 * the create can be undone.
 *
 * Pure text functions only (no zod, no Node), so the browser bundle of the module can use them.
 */

/** The guarded feature switch ("AI Tool: Macro forge (writes)"), off by default. */
export const MACRO_FORGE_FEATURE_ID = 'macro-forge';

/** The flag (`flags.foundry-mcp-bridge.macroForge`) set on every macro the forge creates. */
export const MACRO_FORGE_FLAG = 'macroForge';

/** Foundry's CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE: nobody but a GM sees or runs the macro. */
export const MACRO_OWNERSHIP_NONE = 0;

/** Longest source the forge accepts, in characters. */
export const MACRO_MAX_SOURCE = 20000;

/** A refusal reason: the rule that failed and the text that tripped it. */
export interface MacroSourceProblem {
  rule: string;
  match: string;
}

/**
 * Words that may not appear anywhere in the source, comments and strings included (so a banned
 * name cannot hide in a string that is looked up later). Whole identifiers only.
 */
/** Words that are only a risk as a bare name; `item.parent` or `a.top` is an ordinary property. */
const BARE_ONLY = new Set([
  'top',
  'parent',
  'self',
  'frames',
  'opener',
  'location',
  'history',
  'this',
  'with',
  'function',
  'import',
  'export',
  'require',
  'document',
  'window',
  'Image',
  'Audio',
  'navigator',
]);

const BANNED_WORDS: Array<[string, string]> = [
  ['fetch', 'network access'],
  ['XMLHttpRequest', 'network access'],
  ['WebSocket', 'network access'],
  ['EventSource', 'network access'],
  ['sendBeacon', 'network access'],
  ['importScripts', 'network access'],
  ['Worker', 'a background worker'],
  ['SharedWorker', 'a background worker'],
  ['ServiceWorker', 'a background worker'],
  ['serviceWorker', 'a background worker'],
  ['FilePicker', 'reading files outside the world'],
  ['socket', 'the game socket'],
  ['eval', 'dynamic code'],
  ['Function', 'dynamic code'],
  ['AsyncFunction', 'dynamic code'],
  ['constructor', 'dynamic code'],
  ['__proto__', 'prototype access'],
  ['Reflect', 'reflection'],
  ['Proxy', 'reflection'],
  ['getPrototypeOf', 'reflection'],
  ['setPrototypeOf', 'reflection'],
  ['getOwnPropertyDescriptor', 'reflection'],
  ['getOwnPropertyDescriptors', 'reflection'],
  ['defineProperty', 'reflection'],
  ['window', 'the browser window'],
  ['globalThis', 'the global object'],
  ['self', 'the global object'],
  ['top', 'another page'],
  ['parent', 'another page'],
  ['frames', 'another page'],
  ['opener', 'another page'],
  ['document', 'the web page itself'],
  ['ownerDocument', 'the web page itself'],
  ['defaultView', 'the browser window'],
  ['contentWindow', 'another page'],
  ['contentDocument', 'another page'],
  ['location', 'navigation'],
  ['navigator', 'the browser'],
  ['history', 'navigation'],
  ['localStorage', 'browser storage'],
  ['sessionStorage', 'browser storage'],
  ['indexedDB', 'browser storage'],
  ['cookie', 'cookies'],
  ['require', 'module loading'],
  ['import', 'module loading'],
  ['export', 'module loading'],
  ['this', 'the global object (use arrow functions and the names the macro is given)'],
  ['function', 'a function expression (use arrow functions)'],
  ['with', 'a with block'],
  ['Image', 'loading a picture (a way to send data out)'],
  ['Audio', 'loading a sound (a way to send data out)'],
];

/** Markup that loads something or runs code when it lands in a chat message or a dialog. */
const BANNED_PATTERNS: Array<[RegExp, string, string]> = [
  [
    /<\s*(script|iframe|object|embed|link|img|video|audio|source|form|base|meta)\b/i,
    'markup',
    'markup that loads or runs something',
  ],
  [/<[^>]*\bon[a-z]{3,}\s*=/i, 'markup', 'an event handler attribute'],
  [/javascript\s*:/i, 'markup', 'a javascript: link'],
  [/\bdata\s*:\s*text\/html/i, 'markup', 'an inline page'],
  [/\bhttps?\s*:\s*\/\//i, 'link', 'a web address'],
  [/\.\.\s*[\\/]/, 'path', 'a path that leaves the world'],
  [/\bworlds\s*[\\/]/i, 'path', 'a path into the worlds folder'],
];

/**
 * Computed member access (`a[x]`) is allowed only with a number, a plain word in quotes or a bare
 * name; anything else (a concatenation, a call, a template) could spell a banned name at run time.
 * A bare name is checked against the banned words too, since `a[eval]` is the same call.
 */
const COMPUTED_ACCESS = /\[\s*([^[\]]*?)\s*\]/g;
const SAFE_INDEX =
  /^(?:\d+|-?\d+|'[\w -]*'|"[\w -]*"|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\s*[+-]\s*\d+)?)$/;

/**
 * Scan macro source text. Returns the problems found, empty when it passes. Looks at the raw
 * text, strings and comments included, so there is no parser to confuse.
 */
export function scanMacroSource(source: string): MacroSourceProblem[] {
  const problems: MacroSourceProblem[] = [];
  if (source.trim() === '') {
    return [{ rule: 'empty', match: 'the source is empty' }];
  }
  if (source.length > MACRO_MAX_SOURCE) {
    problems.push({
      rule: 'size',
      match: `${source.length} characters (limit ${MACRO_MAX_SOURCE})`,
    });
  }
  for (const [word, why] of BANNED_WORDS) {
    // A word counts only as a whole identifier, not inside `selfish` or `topple`; a dot before it
    // (`foo.top`, `game.socket`) still counts, since a property is how these are reached.
    const before = BARE_ONLY.has(word) ? '(?<![\\w$.])' : '(?<![\\w$])';
    const re = new RegExp(`${before}${word}(?![\\w$])`);
    const hit = re.exec(source);
    if (hit) problems.push({ rule: why, match: hit[0] });
  }
  for (const [re, rule, why] of BANNED_PATTERNS) {
    const hit = re.exec(source);
    if (hit) problems.push({ rule: why, match: `${rule}: ${hit[0].trim().slice(0, 60)}` });
  }
  for (const m of source.matchAll(COMPUTED_ACCESS)) {
    const inner = m[1] ?? '';
    // Array literals and empty brackets are not member access; only look at an index that holds
    // something odd. An array literal of plain values has commas or is empty, so it needs the
    // same safe shapes joined by commas.
    if (inner === '') continue;
    const parts = splitTop(inner);
    if (!parts.every(p => p === '' || SAFE_INDEX.test(p.trim()) || isPlainLiteral(p.trim()))) {
      problems.push({ rule: 'a computed member name', match: `[${inner.slice(0, 50)}]` });
    }
  }
  return dedupe(problems);
}

function splitTop(text: string): string[] {
  // Commas inside nested brackets cannot occur here (the pattern excludes brackets); quotes may
  // hold commas, which only makes the check stricter.
  return text.split(',');
}

function isPlainLiteral(text: string): boolean {
  return /^(?:-?\d+(?:\.\d+)?|true|false|null|undefined|'[^'\\]*'|"[^"\\]*")$/.test(text);
}

function dedupe(problems: MacroSourceProblem[]): MacroSourceProblem[] {
  const seen = new Set<string>();
  return problems.filter(p => {
    const key = `${p.rule}|${p.match}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  [
    /\bPlaylist\b|\.playAll\s*\(|\.stopAll\s*\(|\.playSound\s*\(|\bAudioHelper\b/,
    'plays or stops sound',
  ],
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
 * function, at apply time in the module.
 */
export function assertMacroCreateData(feature: string, data: Record<string, unknown>): void {
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
  // The plan carries only `default: 0`; a restore (undo of a delete, rollback) carries the source
  // Foundry recorded, which also lists the creating GM, so only the forge's own write is strict.
  const strict = feature === MACRO_FORGE_FEATURE_ID;
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
