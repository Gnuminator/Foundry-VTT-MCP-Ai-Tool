/**
 * A short build id for the stdio wrapper's hello: a hash of the tool-set lists in this copy of
 * tool-sets.ts. A wrapper filters the tool list with its own copy, so a wrapper and a bridge of
 * the same version can still disagree on which tools a set holds (a rebuilt bridge, an installed
 * wrapper from before). Comparing this id catches that when the versions are equal. It is the
 * same in the bundled and the unbundled build, and needs no build step.
 */
import { createHash } from 'node:crypto';

import { ALL_TOOL_SET_NAMES, TOOL_SETS } from './tool-sets.js';

/** The build id of a tool-set catalog: 12 hex characters of a SHA-256 over the set lists. */
export function toolSetsBuildId(
  sets: Readonly<Record<string, { tools: readonly string[] }>> = TOOL_SETS,
  names: readonly string[] = ALL_TOOL_SET_NAMES
): string {
  const lists = names.map(name => [name, [...(sets[name]?.tools ?? [])]]);
  return createHash('sha256').update(JSON.stringify(lists)).digest('hex').slice(0, 12);
}

/** This build's id, sent in the wrapper's hello and compared by the backend. */
export const BUILD_ID = toolSetsBuildId();
