/**
 * @gnuminator/shared — public surface
 *
 * Re-exports the complete shared vocabulary for the Foundry AI Tool:
 *   - Domain types and interfaces  (types.ts)
 *   - Zod validation schemas       (schemas.ts)
 *   - Frozen wire-contract constants (constants.ts)
 *
 * Import from this package root, not from the sub-modules directly.
 */

export * from './types.js';
export * from './schemas.js';
export * from './constants.js';
