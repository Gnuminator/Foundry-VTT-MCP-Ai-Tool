/**
 * `ttlMs` and `cacheScope` for the list results of MCP 2026-07-28 (required on `tools/list` and
 * `prompts/list` in that era; a 2025-11-25 client never sees them). The tool list comes from the
 * bridge and changes when it restarts or updates, the prompts are static, and each entry serves one
 * user, so the scope is private and the lifetimes are short. A failed or empty backend list
 * answers an error (see index.ts), which no client caches.
 */
import type { CacheHint } from '@modelcontextprotocol/server';

export const LIST_CACHE_HINTS: Record<'tools/list' | 'prompts/list', CacheHint> = {
  'tools/list': { ttlMs: 60_000, cacheScope: 'private' },
  'prompts/list': { ttlMs: 3_600_000, cacheScope: 'private' },
};
