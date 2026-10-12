// What the Pi's runtime code imports (#310 review, M1), for scripts/pi/runtime-imports.test.mjs.
//
// Stage 5 runs `npm prune --omit=dev` on the build, so a package that is only a devDependency is gone on the Pi.
// A runtime file that still imports one passes CI and works on the PC (everything is installed there), and then
// crashes its service in a restart loop after the swap. This reads the sources with the TypeScript parser and
// lists the bare imports that are not Node built-ins, relative paths or the package itself.
import { builtinModules } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const SOURCE = /\.(?:[cm]?[jt]s|tsx)$/;
const SKIPPED_DIRS = new Set(['node_modules', 'test-support', '__tests__', 'dist']);
const SKIPPED_FILES = /\.(?:test|spec)\.|\.d\.[cm]?ts$/;

const BUILTINS = new Set(builtinModules);

/** The package a specifier names: `@scope/name/sub` is `@scope/name`, `name/sub` is `name`. */
export function packageOf(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** True for a Node built-in (`node:fs`, `fs`, `fs/promises`), a relative or absolute path, or a `#` subpath import. */
export function isLocalOrBuiltin(specifier) {
  return (
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('#') ||
    specifier.startsWith('node:') ||
    BUILTINS.has(specifier) ||
    BUILTINS.has(specifier.split('/')[0])
  );
}

/** The string a node holds when it is a string literal (or a template without holes), else undefined. */
function literal(node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

/**
 * Every module specifier the file loads at run time, as written: `import ... from`, `import 'x'`,
 * `export ... from`, `import('x')`, `require('x')` and `createRequire(...)('x')`. Type-only imports are left out
 * (`import type`, `export type`, and an import whose names are all `type` names: the compiler erases them).
 * @param {string} text the source
 * @param {string} [fileName] decides TS or JS syntax
 * @returns {string[]}
 */
export function runtimeSpecifiers(text, fileName = 'file.ts') {
  const kind = /\.tsx$/.test(fileName)
    ? ts.ScriptKind.TSX
    : /\.[cm]?js$/.test(fileName)
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const found = [];
  const visit = node => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const onlyTypes =
        clause &&
        (clause.isTypeOnly ||
          (!clause.name &&
            named &&
            ts.isNamedImports(named) &&
            named.elements.length > 0 &&
            named.elements.every(e => e.isTypeOnly)));
      if (!onlyTypes) found.push(literal(node.moduleSpecifier));
    } else if (ts.isExportDeclaration(node)) {
      if (!node.isTypeOnly && node.moduleSpecifier) found.push(literal(node.moduleSpecifier));
    } else if (ts.isImportEqualsDeclaration(node)) {
      const ref = node.moduleReference;
      if (!node.isTypeOnly && ts.isExternalModuleReference(ref))
        found.push(literal(ref.expression));
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      // createRequire(import.meta.url)('x'), the way the Pi's ESM scripts load a package from the build.
      const isCreated =
        ts.isCallExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === 'createRequire';
      if (isImport || isRequire || isCreated) found.push(literal(node.arguments[0]));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found.filter(s => typeof s === 'string');
}

/**
 * The bare package names a source file imports at run time (built-ins, relative paths and `ownName` left out).
 * @param {string} text
 * @param {string} fileName
 * @param {string} [ownName] the package the file belongs to
 * @returns {string[]} sorted, without repeats
 */
export function bareImports(text, fileName, ownName) {
  const names = new Set();
  for (const s of runtimeSpecifiers(text, fileName)) {
    if (isLocalOrBuiltin(s)) continue;
    const name = packageOf(s);
    if (name !== ownName) names.add(name);
  }
  return [...names].sort();
}

/** The runtime source files under a folder: tests, declaration files and test-support are left out. */
export function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) out.push(...sourceFiles(full));
    } else if (SOURCE.test(entry.name) && !SKIPPED_FILES.test(entry.name)) {
      out.push(full);
    }
  }
  return out.sort();
}

/**
 * The bare imports of a set of files that the package.json does not list under `dependencies`.
 * @param {string[]} files
 * @param {{ name?: string, dependencies?: Record<string, string>, optionalDependencies?: Record<string, string> }} pkg
 * @returns {{ file: string, name: string }[]}
 */
export function undeclaredImports(files, pkg) {
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ]);
  const problems = [];
  for (const file of files) {
    for (const name of bareImports(readFileSync(file, 'utf8'), file, pkg.name)) {
      if (!declared.has(name)) problems.push({ file, name });
    }
  }
  return problems;
}
