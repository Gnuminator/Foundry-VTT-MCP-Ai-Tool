/**
 * The bridge tool catalog, read from the BUILT mcp-server (packages/mcp-server/dist/tool-sets.js),
 * so a scenario that names a tool no set lists fails `kit check` in CI.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * @param {string} repoRoot
 * @returns {Promise<{sets: Record<string, string[]>, all: Set<string>}>}
 */
export async function loadToolCatalog(repoRoot) {
  const file = path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'tool-sets.js');
  if (!existsSync(file)) {
    throw new Error(`tool catalog not found at ${file}: run "npm run build" first`);
  }
  const mod = await import(pathToFileURL(file).href);
  const specs = mod.TOOL_SETS;
  if (!specs || typeof specs !== 'object') {
    throw new Error(`${file} does not export TOOL_SETS`);
  }
  /** @type {Record<string, string[]>} */
  const sets = {};
  const all = new Set();
  for (const [name, spec] of Object.entries(specs)) {
    const tools = [.../** @type {{tools: readonly string[]}} */ (spec).tools];
    sets[name] = tools;
    for (const t of tools) all.add(t);
  }
  return { sets, all };
}
