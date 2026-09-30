/**
 * Hooks the prompts into an MCP server: `prompts/list` and `prompts/get`.
 *
 * The prompts are static, so the stdio wrapper answers them itself, with no
 * control-channel round trip: listing and getting a prompt never depends on
 * Foundry being connected (only the tools Claude calls afterwards do). A bad
 * request (unknown prompt, missing argument) becomes a JSON-RPC "invalid
 * params" error with a message the GM can read.
 */
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import type { ToolSetName } from '../tool-sets.js';

import { PromptError, getPrompt, listPrompts } from './index.js';

/** Merge into the server's capabilities so clients ask for prompts at all. */
export const PROMPTS_CAPABILITY = { prompts: {} } as const;

/**
 * `sets` limits `prompts/list` to those tool sets' prompts (all when left out).
 * `prompts/get` answers any prompt by name: a client only asks for listed ones.
 */
export function registerPromptHandlers(server: Server, sets?: readonly ToolSetName[]): void {
  server.setRequestHandler(ListPromptsRequestSchema, () => ({ prompts: listPrompts(sets) }));

  server.setRequestHandler(GetPromptRequestSchema, request => {
    try {
      return getPrompt(request.params.name, request.params.arguments);
    } catch (error) {
      if (error instanceof PromptError) throw new McpError(ErrorCode.InvalidParams, error.message);
      throw error;
    }
  });
}
