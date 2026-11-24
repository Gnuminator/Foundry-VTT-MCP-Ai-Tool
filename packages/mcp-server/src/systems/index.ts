/**
 * System Adapter Architecture
 *
 * Exports all types, registries, and utilities for the multi-system support.
 */

// Core types and interfaces
export type {
  SystemId,
  SystemMetadata,
  SystemCreatureIndex,
  SystemAdapter,
  DnD5eCreatureIndex,
} from './types.js';

// System registry (MCP server context)
export { getSystemRegistry } from './system-registry.js';
