/**
 * Import order (R10): tool-sets.ts and tool-hints.ts read the tool modules, which import many
 * files. A module that imports tool-sets.ts, tool-hints.ts or build-id.ts back (directly or
 * through another file) makes a cycle that only breaks when the cycle is entered from one
 * particular side (a TDZ error on first use). Each entry below is loaded first in a fresh module
 * graph, so every side is tried.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ENTRIES = [
  './tool-sets.js',
  './tool-hints.js',
  './build-id.js',
  './tool-router.js',
  './tools/index.js',
  './wrapper-registry.js',
  './wrapper-version.js',
  './tool-reference.js',
  './tool-call-log.js',
] as const;

describe('load order', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it.each(ENTRIES)('loads %s first, with tool sets, hints and build id intact', async entry => {
    await import(/* @vite-ignore */ entry);
    const sets = await import('./tool-sets.js');
    const hints = await import('./tool-hints.js');
    const build = await import('./build-id.js');
    expect(sets.TOOL_SETS.core.tools.length).toBeGreaterThan(0);
    expect(sets.toolSetOf('get-world-info')).toBe('core');
    expect(hints.TOOL_HINTS['get-world-info']?.kind).toBe('read');
    expect(build.BUILD_ID).toMatch(/^[0-9a-f]{12}$/);
  });
});
