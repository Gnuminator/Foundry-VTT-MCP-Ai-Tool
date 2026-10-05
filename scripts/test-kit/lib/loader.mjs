/**
 * Finds, imports and validates scenario files (`*.scenario.mjs`).
 */
import { readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateScenario } from './contract.mjs';

/**
 * @typedef {import('./contract.mjs').Scenario} Scenario
 * @param {string[]} dirs
 * @param {{size?: string, only?: string[], catalog?: {all: Set<string>}}} [opts]
 *   `size` keeps scenarios whose sizes include it (a bigger kit includes the smaller ones'
 *   scenarios only when they list it; there is no implicit inheritance).
 * @returns {Promise<{scenarios: Array<{scenario: Scenario, file: string, dir: string}>, problems: string[]}>}
 */
export async function loadScenarios(dirs, { size, only, catalog } = {}) {
  /** @type {Array<{scenario: Scenario, file: string, dir: string}>} */
  const found = [];
  /** @type {string[]} */
  const problems = [];
  /** @type {Map<string, string>} */
  const seen = new Map();

  for (const dir of dirs) {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      problems.push(`scenario folder not found: ${dir}`);
      continue;
    }
    const names = readdirSync(dir)
      .filter(n => n.endsWith('.scenario.mjs'))
      .sort();
    for (const name of names) {
      const full = path.join(dir, name);
      let mod;
      try {
        mod = await import(pathToFileURL(full).href);
      } catch (e) {
        problems.push(`${name}: import failed: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      const scenario = mod.default;
      const shape = validateScenario(scenario);
      if (shape.length) {
        for (const p of shape) problems.push(`${name}: ${p}`);
        continue;
      }
      if (catalog) {
        for (const t of scenario.tools) {
          if (!catalog.all.has(t)) problems.push(`${name}: unknown tool "${t}" (not in tool-sets)`);
        }
      }
      const prior = seen.get(scenario.id);
      if (prior) {
        problems.push(`${name}: duplicate scenario id "${scenario.id}" (also in ${prior})`);
        continue;
      }
      seen.set(scenario.id, full);
      found.push({ scenario, file: name, dir });
    }
  }

  if (only && only.length) {
    for (const id of only) {
      if (!seen.has(id)) problems.push(`--only: no scenario with id "${id}"`);
    }
  }
  const scenarios = found.filter(
    ({ scenario }) =>
      (!size || scenario.sizes.includes(size)) &&
      (!only || !only.length || only.includes(scenario.id))
  );
  return { scenarios, problems };
}
