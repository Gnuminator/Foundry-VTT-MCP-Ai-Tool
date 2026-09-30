/**
 * Types for the MCP prompts (the ready-made "/" prompts Claude Desktop shows).
 *
 * Deliberately independent of the MCP SDK: definitions, argument validation and
 * message building are plain data and pure functions, so they are unit-tested
 * with no server and no network. `register.ts` is the only file that touches
 * the SDK.
 */

/** One argument a prompt accepts. MCP prompt arguments are always strings. */
export interface PromptArgumentSpec {
  name: string;
  /** Shown next to the field in Claude Desktop. Plain language, for a GM new to the tool. */
  description: string;
  required: boolean;
  /** Longest accepted value, in characters. */
  maxLength: number;
  /** Accepted values (case-insensitive). The resolved value is lower-cased. */
  oneOf?: readonly string[];
  /** Used when the argument is left out or blank. */
  default?: string;
  /** Extra check on the cleaned value: what is wrong ("must be ..."), or null when fine. */
  check?: (value: string) => string | null;
  /** Applied to a value that passed every check, for a canonical form. */
  normalize?: (value: string) => string;
}

/** Arguments after validation: cleaned, defaults applied, only declared names. */
export type ResolvedPromptArguments = Readonly<Record<string, string | undefined>>;

export interface PromptDefinition {
  /** The name Claude Desktop lists (locked: docs refer to it). */
  name: string;
  /** Short display name. */
  title: string;
  /** One sentence for the prompt list. */
  description: string;
  arguments: readonly PromptArgumentSpec[];
  /** The one user message this prompt sends: numbered instructions for Claude. */
  build: (args: ResolvedPromptArguments) => string;
}

/** What `prompts/list` returns for one prompt. */
export interface PromptListing {
  name: string;
  title: string;
  description: string;
  arguments: { name: string; description: string; required: boolean }[];
}

/**
 * What `prompts/get` returns: exactly one user message. A type alias, not an
 * interface: the SDK's result types have an index signature, which only a type
 * alias satisfies.
 */
export type PromptResult = {
  description: string;
  messages: [{ role: 'user'; content: { type: 'text'; text: string } }];
};

/** A prompt request that cannot be served (unknown prompt, bad or missing argument). */
export class PromptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptError';
  }
}
