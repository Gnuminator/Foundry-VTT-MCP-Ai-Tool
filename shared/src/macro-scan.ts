/**
 * Macro forge (I-189): the source check, as an allowlist over the parsed script.
 *
 * The script is parsed (acorn, pure JavaScript, so the browser bundle can use it) and every name,
 * member and string is checked against lists of what is allowed, so escapes (`fetch`),
 * comments and string splitting cannot hide a banned word: the parser decodes them first. A free
 * name must be one of the globals below or a name the macro itself declares; a member name must not
 * be on the banned list; a computed member name must be a number, a plain string or a counting
 * loop variable (anything built at run time could spell a banned name); strings may not be URLs,
 * paths or markup with attributes. This lowers the chance of a macro that reaches outside the
 * world, whether by mistake or on purpose. It is not a sandbox: the controls that carry the
 * weight are the full source shown in the plan, the GM's confirm, GM-only visibility and undo.
 */
import { parse } from 'acorn';

/** A refusal reason: the rule that failed and the text that tripped it. */
export interface MacroSourceProblem {
  rule: string;
  match: string;
}

type AstNode = { type: string; [key: string]: unknown };

/** Free names a macro may use: Foundry's API entry points, plain built-ins and the macro's own arguments. */
const ALLOWED_GLOBALS = new Set([
  'game',
  'canvas',
  'ui',
  'ChatMessage',
  'Roll',
  'Dialog',
  'CONST',
  'fromUuid',
  'fromUuidSync',
  'Actor',
  'Item',
  'Combat',
  'Playlist',
  'ActiveEffect',
  'Math',
  'Number',
  'String',
  'Boolean',
  'Array',
  'Object',
  'JSON',
  'Date',
  'Set',
  'Map',
  'Promise',
  'Error',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'console',
  'undefined',
  'NaN',
  'Infinity',
  // What Foundry passes to a script macro.
  'speaker',
  'actor',
  'token',
  'character',
  'scope',
  'args',
  'item',
]);

/** Member and property names that reach the network, other pages, dynamic code or the page itself. */
const BANNED_MEMBERS = new Map<string, string>([
  ['constructor', 'dynamic code'],
  ['prototype', 'prototype access'],
  ['__proto__', 'prototype access'],
  ['__defineGetter__', 'prototype access'],
  ['__defineSetter__', 'prototype access'],
  ['__lookupGetter__', 'prototype access'],
  ['__lookupSetter__', 'prototype access'],
  ['getPrototypeOf', 'reflection'],
  ['setPrototypeOf', 'reflection'],
  ['defineProperty', 'reflection'],
  ['defineProperties', 'reflection'],
  ['getOwnPropertyDescriptor', 'reflection'],
  ['getOwnPropertyDescriptors', 'reflection'],
  ['getOwnPropertyNames', 'reflection'],
  ['getOwnPropertySymbols', 'reflection'],
  ['eval', 'dynamic code'],
  ['Function', 'dynamic code'],
  ['socket', 'the game socket'],
  ['emit', 'the game socket'],
  ['fetch', 'network access'],
  ['fetchWithTimeout', 'network access'],
  ['fetchJsonWithTimeout', 'network access'],
  ['sendBeacon', 'network access'],
  ['loadTexture', 'loading a file or address'],
  ['srcExists', 'loading a file or address'],
  ['AudioHelper', 'loading a file or address'],
  ['FilePicker', 'reading files outside the world'],
  ['open', 'opening another page'],
  ['write', 'writing to the page'],
  ['writeln', 'writing to the page'],
  ['location', 'navigation'],
  ['navigator', 'the browser'],
  ['history', 'navigation'],
  ['localStorage', 'browser storage'],
  ['sessionStorage', 'browser storage'],
  ['indexedDB', 'browser storage'],
  ['cookie', 'cookies'],
  ['top', 'another page'],
  ['frames', 'another page'],
  ['opener', 'another page'],
  ['contentWindow', 'another page'],
  ['contentDocument', 'another page'],
  ['ownerDocument', 'the web page itself'],
  ['defaultView', 'the browser window'],
  ['parentElement', 'the web page itself'],
  ['parentNode', 'the web page itself'],
  ['getRootNode', 'the web page itself'],
  ['createElement', 'the web page itself'],
  ['appendChild', 'the web page itself'],
  ['innerHTML', 'the web page itself'],
  ['outerHTML', 'the web page itself'],
  ['insertAdjacentHTML', 'the web page itself'],
  ['srcdoc', 'the web page itself'],
  ['setAttribute', 'the web page itself'],
  ['fromCharCode', 'building text out of numbers'],
  ['fromCodePoint', 'building text out of numbers'],
  ['atob', 'decoding text'],
  ['btoa', 'encoding text'],
  ['unescape', 'decoding text'],
  ['decodeURI', 'decoding text'],
  ['decodeURIComponent', 'decoding text'],
  ['raw', 'building text out of parts'],
  ['replace', 'rewriting text at run time'],
  ['replaceAll', 'rewriting text at run time'],
  ['charAt', 'cutting text apart'],
  ['substring', 'cutting text apart'],
  ['substr', 'cutting text apart'],
  ['Macro', 'creating or running another macro'],
  ['macros', 'creating or running another macro'],
  ['execute', 'running another macro'],
  ['documentClass', 'creating a document outside the plan'],
  ['modules', 'other modules'],
  ['fromEntries', 'building member names at run time'],
  ['groupBy', 'building member names at run time'],
  ['parse', 'building values out of text'],
  ['addEventListener', 'reaching the browser window through an event'],
  ['dispatchEvent', 'reaching the browser window through an event'],
  ['setHTMLUnsafe', 'the web page itself'],
  ['command', 'a macro script'],
  ['processMessage', 'running a chat command'],
]);

/** Names of fields that hold a picture, sound or file path: set to an address they send data out when loaded. */
const SINK_FIELD = /^(?:img|src|icon|texture|sound|path|href|thumb|thumbnail|avatar|background)$/i;

const SAFE_TAGS =
  /<\/?(?:p|b|i|u|em|strong|br|hr|ul|ol|li|h[1-6]|span|div|table|thead|tbody|tr|td|th|code|pre|sup|sub|small)\s*\/?>/gi;

interface Scope {
  names: Set<string>;
  counters: Set<string>;
  parent: Scope | null;
}

const isNode = (value: unknown): value is AstNode =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { type?: unknown }).type === 'string';

/** Names a pattern binds (`a`, `{a, b: [c]}`, `[d = 1, ...e]`). */
function patternNames(pattern: unknown, into: Set<string>): void {
  if (!isNode(pattern)) return;
  switch (pattern.type) {
    case 'Identifier':
      into.add(pattern.name as string);
      return;
    case 'ObjectPattern':
      for (const p of pattern.properties as AstNode[]) {
        patternNames(p.type === 'Property' ? p.value : p, into);
      }
      return;
    case 'ArrayPattern':
      for (const e of pattern.elements as unknown[]) patternNames(e, into);
      return;
    case 'AssignmentPattern':
      patternNames(pattern.left, into);
      return;
    case 'RestElement':
      patternNames(pattern.argument, into);
      return;
    default:
  }
}

/** `var` and function declarations of one function body, found without entering nested functions. */
function hoistedNames(node: unknown, into: Set<string>): void {
  if (!isNode(node)) return;
  switch (node.type) {
    case 'VariableDeclaration':
      if (node.kind === 'var') {
        for (const d of node.declarations as AstNode[]) patternNames(d.id, into);
      }
      return;
    case 'FunctionDeclaration':
      if (isNode(node.id)) into.add(node.id.name as string);
      return;
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
    case 'ClassDeclaration':
    case 'ClassExpression':
      return;
    default:
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const v of value) hoistedNames(v, into);
    else hoistedNames(value, into);
  }
}

/** `let`, `const`, function declarations that sit directly in a statement list. */
function lexicalNames(statements: unknown[], into: Set<string>): void {
  for (const s of statements) {
    if (!isNode(s)) continue;
    if (s.type === 'VariableDeclaration' && s.kind !== 'var') {
      for (const d of s.declarations as AstNode[]) patternNames(d.id, into);
    } else if (s.type === 'FunctionDeclaration' && isNode(s.id)) {
      into.add(s.id.name as string);
    }
  }
}

/** Names assigned anywhere after their declaration (`i = x`, `i += 2`): not safe as a counter. */
function assignedNames(node: unknown, into: Set<string>): void {
  if (!isNode(node)) return;
  if (node.type === 'AssignmentExpression' && isNode(node.left)) {
    const right = node.right;
    const numericStep =
      (node.operator === '+=' || node.operator === '-=') &&
      isNode(right) &&
      right.type === 'Literal' &&
      typeof right.value === 'number';
    if (!numericStep) patternNames(node.left, into);
  }
  // `for (i of xs)` and `for (i in o)` without a declaration assign the name too.
  if (
    (node.type === 'ForOfStatement' || node.type === 'ForInStatement') &&
    isNode(node.left) &&
    node.left.type !== 'VariableDeclaration'
  ) {
    patternNames(node.left, into);
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const v of value) assignedNames(v, into);
    else assignedNames(value, into);
  }
}

class Scanner {
  readonly problems: MacroSourceProblem[] = [];
  private assigned = new Set<string>();

  scan(program: AstNode): void {
    assignedNames(program, this.assigned);
    const names = new Set<string>();
    hoistedNames(program, names);
    lexicalNames(program.body as unknown[], names);
    this.visitList(program.body, { names, counters: new Set(), parent: null });
  }

  private problem(rule: string, match: string): void {
    this.problems.push({ rule, match: match.slice(0, 60) });
  }

  private declared(scope: Scope | null, name: string): Scope | null {
    for (let s = scope; s; s = s.parent) if (s.names.has(name)) return s;
    return null;
  }

  /** A string that is a banned member name, a picture field, an address, a path or odd markup. */
  private checkString(text: string): void {
    const trimmed = text.trim();
    const banned = BANNED_MEMBERS.get(trimmed);
    if (banned) this.problem(banned, trimmed);
    if (SINK_FIELD.test(trimmed.split('.').pop() ?? '')) {
      this.problem('a picture, sound or file field (loading one can send data out)', trimmed);
    }
    if (text.replace(SAFE_TAGS, '').includes('<')) {
      this.problem('markup', text.slice(text.indexOf('<')));
    }
    if (
      /javascript\s*:|\bdata\s*:|:\s*\/|\/\/|^\s*[\\/]|\.\.\s*[\\/]|\bworlds\s*[\\/]/i.test(text)
    ) {
      this.problem('a web address or a path', text);
    }
  }

  private checkMember(name: string): void {
    const banned = BANNED_MEMBERS.get(name);
    if (banned) this.problem(banned, name);
    // A dotted key (`'prototypeToken.texture.src'`) is judged by its last part.
    if (SINK_FIELD.test(name.split('.').pop() ?? '')) {
      this.problem('a picture, sound or file field (loading one can send data out)', name);
    }
  }

  /**
   * A key that is certainly a number: a literal, a counting loop variable, or arithmetic that
   * always gives a number (`xs[xs.length - 1]`, `xs[+Math.floor(n / 2)]`). A `Math` call alone does
   * not count, since the macro could have replaced `Math.floor`; a leading `+` forces a number.
   */
  private isNumericKey(node: unknown, scope: Scope): boolean {
    if (!isNode(node)) return false;
    switch (node.type) {
      case 'Literal':
        return typeof node.value === 'number';
      case 'Identifier': {
        const name = node.name as string;
        const owner = this.declared(scope, name);
        return owner !== null && owner.counters.has(name) && !this.assigned.has(name);
      }
      // Unary plus and minus and binary minus, times and remainder always give a number, whatever
      // the operands are (the caller still visits the operands). Binary plus joins strings, so it
      // counts only when both sides are certain numbers.
      case 'UnaryExpression':
        return node.operator === '-' || node.operator === '+';
      case 'BinaryExpression':
        if (['-', '*', '%'].includes(node.operator as string)) return true;
        return (
          node.operator === '+' &&
          this.isNumericKey(node.left, scope) &&
          this.isNumericKey(node.right, scope)
        );
      default:
        return false;
    }
  }

  private visitList(list: unknown, scope: Scope): void {
    if (Array.isArray(list)) for (const n of list) this.visit(n, scope);
  }

  private functionScope(fn: AstNode, scope: Scope): Scope {
    const names = new Set<string>();
    for (const p of fn.params as unknown[]) patternNames(p, names);
    if (fn.type === 'FunctionExpression' && isNode(fn.id)) names.add(fn.id.name as string);
    const body = fn.body;
    if (isNode(body) && body.type === 'BlockStatement') {
      hoistedNames(body, names);
      lexicalNames(body.body as unknown[], names);
    }
    return { names, counters: new Set(), parent: scope };
  }

  private blockScope(statements: unknown[], scope: Scope): Scope {
    const names = new Set<string>();
    lexicalNames(statements, names);
    return { names, counters: new Set(), parent: scope };
  }

  private visit(node: unknown, scope: Scope): void {
    if (!isNode(node)) return;
    switch (node.type) {
      case 'ThisExpression':
        return this.problem(
          'the global object (use arrow functions and the names the macro is given)',
          'this'
        );
      case 'WithStatement':
        return this.problem('a with block', 'with');
      case 'ImportExpression':
      case 'ImportDeclaration':
      case 'ExportNamedDeclaration':
      case 'ExportDefaultDeclaration':
      case 'ExportAllDeclaration':
      case 'MetaProperty':
        return this.problem('module loading', node.type);
      case 'ClassDeclaration':
      case 'ClassExpression':
        return this.problem('a class (use plain functions and objects)', 'class');
      case 'TaggedTemplateExpression':
        return this.problem('a tagged template', 'tag`...`');
      case 'Identifier': {
        const name = node.name as string;
        if (!this.declared(scope, name) && !ALLOWED_GLOBALS.has(name)) {
          this.problem('a name that is not part of the Foundry API the forge allows', name);
        }
        return;
      }
      case 'Literal':
        if (typeof node.value === 'string') this.checkString(node.value);
        else if (node.regex) {
          // The pattern with its escapes taken out: `https:\/\/x` reads as an address.
          this.checkString(
            String((node.regex as { pattern: string }).pattern).replace(/\\(.)/g, '$1')
          );
        }
        return;
      case 'TemplateLiteral':
        for (const q of node.quasis as AstNode[]) {
          const value = q.value as { cooked?: string | null; raw: string };
          this.checkString(value.cooked ?? value.raw);
        }
        return this.visitList(node.expressions, scope);
      case 'MemberExpression': {
        this.visit(node.object, scope);
        const property = node.property;
        if (node.computed === true) {
          if (isNode(property) && property.type === 'Literal') {
            if (typeof property.value === 'string') this.checkString(property.value);
          } else if (!this.isNumericKey(property, scope)) {
            this.problem('a computed member name', 'a[...]');
          } else {
            this.visit(property, scope);
          }
        } else if (isNode(property)) {
          this.checkMember(property.name as string);
        }
        return;
      }
      case 'Property': {
        if (node.computed === true) {
          const key = node.key;
          if (isNode(key) && key.type === 'Literal') {
            if (typeof key.value === 'string') this.checkString(key.value);
          } else if (!this.isNumericKey(key, scope)) {
            this.problem('a computed member name', '{[...]: ...}');
          } else {
            this.visit(key, scope);
          }
        } else if (isNode(node.key)) {
          this.checkMember(String(node.key.name ?? node.key.value));
        }
        return this.visit(node.value, scope);
      }
      case 'LabeledStatement':
        return this.visit(node.body, scope);
      case 'BreakStatement':
      case 'ContinueStatement':
        return;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        const inner = this.functionScope(node, scope);
        for (const p of node.params as unknown[]) this.visitDefaults(p, inner);
        if (isNode(node.body) && node.body.type === 'BlockStatement') {
          return this.visitList(node.body.body, inner);
        }
        return this.visit(node.body, inner);
      }
      case 'BlockStatement':
      case 'StaticBlock':
        return this.visitList(node.body, this.blockScope(node.body as unknown[], scope));
      case 'SwitchStatement': {
        this.visit(node.discriminant, scope);
        const cases = node.cases as AstNode[];
        const inner = this.blockScope(
          cases.flatMap(c => c.consequent as unknown[]),
          scope
        );
        for (const c of cases) {
          this.visit(c.test, inner);
          this.visitList(c.consequent, inner);
        }
        return;
      }
      case 'ForStatement': {
        const inner = this.blockScope(isNode(node.init) ? [node.init] : [], scope);
        const init = node.init;
        if (isNode(init) && init.type === 'VariableDeclaration') {
          for (const d of init.declarations as AstNode[]) {
            const start = d.init;
            // Only a `let` counter: a `var` can be declared again further down with another value.
            if (
              init.kind === 'let' &&
              isNode(d.id) &&
              d.id.type === 'Identifier' &&
              isNode(start) &&
              start.type === 'Literal' &&
              typeof start.value === 'number'
            ) {
              inner.counters.add(d.id.name as string);
            }
          }
        }
        this.visit(node.init, inner);
        this.visit(node.test, inner);
        this.visit(node.update, inner);
        return this.visit(node.body, inner);
      }
      case 'ForInStatement':
      case 'ForOfStatement': {
        const inner = this.blockScope(isNode(node.left) ? [node.left] : [], scope);
        this.visit(node.left, inner);
        this.visit(node.right, inner);
        return this.visit(node.body, inner);
      }
      case 'TryStatement': {
        this.visit(node.block, scope);
        const handler = node.handler;
        if (isNode(handler)) {
          const names = new Set<string>();
          patternNames(handler.param, names);
          const inner: Scope = { names, counters: new Set(), parent: scope };
          this.visitDefaults(handler.param, inner);
          this.visit(handler.body, inner);
        }
        return this.visit(node.finalizer, scope);
      }
      default:
    }
    // Every other node: look at its children.
    for (const [key, value] of Object.entries(node)) {
      if (key === 'type' || key === 'start' || key === 'end') continue;
      if (Array.isArray(value)) for (const v of value) this.visit(v, scope);
      else this.visit(value, scope);
    }
  }

  /** Default values inside parameters (`(a = x) => ...`) are expressions too. */
  private visitDefaults(pattern: unknown, scope: Scope): void {
    if (!isNode(pattern)) return;
    switch (pattern.type) {
      case 'AssignmentPattern':
        this.visit(pattern.right, scope);
        return this.visitDefaults(pattern.left, scope);
      case 'ObjectPattern':
        for (const p of pattern.properties as AstNode[]) {
          if (p.type === 'Property') {
            if (p.computed === true) {
              const key = p.key;
              if (isNode(key) && key.type === 'Literal') {
                if (typeof key.value === 'string') this.checkString(key.value);
              } else if (!this.isNumericKey(key, scope)) {
                this.problem('a computed member name', '{[...]: ...}');
              } else {
                this.visit(key, scope);
              }
            } else if (isNode(p.key)) this.checkMember(String(p.key.name ?? p.key.value));
            this.visitDefaults(p.value, scope);
          } else this.visitDefaults(p, scope);
        }
        return;
      case 'ArrayPattern':
        for (const e of pattern.elements as unknown[]) this.visitDefaults(e, scope);
        return;
      case 'RestElement':
        return this.visitDefaults(pattern.argument, scope);
      default:
    }
  }
}

/** Parse and check macro source; returns the problems found, empty when it passes. */
export function scanMacroAst(source: string): MacroSourceProblem[] {
  let program: AstNode;
  try {
    program = parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
    }) as unknown as AstNode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [{ rule: 'the source does not parse as JavaScript', match: message.slice(0, 80) }];
  }
  const scanner = new Scanner();
  scanner.scan(program);
  const seen = new Set<string>();
  return scanner.problems.filter(p => {
    const key = `${p.rule}|${p.match}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
