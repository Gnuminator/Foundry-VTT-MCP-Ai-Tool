import {
  PromptError,
  type PromptDefinition,
  type PromptArgumentSpec,
  type ResolvedPromptArguments,
} from './types.js';

/**
 * Clean text the GM typed into a prompt field: one line ending style, no
 * control characters (a tab or a newline is fine), no backticks (backticks in
 * a prompt message always mean a tool or parameter name), no outer spaces.
 */
export function cleanArgument(value: string): string {
  const unified = value.replace(/\r\n?/g, '\n').replace(/`/g, "'");
  let out = '';
  for (const ch of unified) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 9 || code === 10 || (code >= 32 && code !== 127)) out += ch;
  }
  return out.trim();
}

function listArguments(specs: readonly PromptArgumentSpec[]): string {
  return specs.length === 0 ? 'none' : specs.map(s => s.name).join(', ');
}

/**
 * Validate the raw `prompts/get` arguments against a prompt's declared ones.
 *
 * - An argument the prompt does not declare is refused (a typo would otherwise
 *   be silently ignored).
 * - A blank value counts as missing: a required one is refused, an optional one
 *   falls back to its default (or stays absent).
 * - Values are cleaned, length-limited, matched against `oneOf`, then checked.
 */
export function resolveArguments(
  definition: PromptDefinition,
  raw: Readonly<Record<string, unknown>> | undefined
): ResolvedPromptArguments {
  const given = raw ?? {};
  const known = new Set(definition.arguments.map(a => a.name));
  for (const key of Object.keys(given)) {
    if (!known.has(key)) {
      throw new PromptError(
        `Unknown argument "${key}" for prompt "${definition.name}". Arguments: ${listArguments(definition.arguments)}.`
      );
    }
  }

  const resolved: Record<string, string> = {};
  for (const spec of definition.arguments) {
    const rawValue = Object.prototype.hasOwnProperty.call(given, spec.name)
      ? given[spec.name]
      : undefined;
    if (rawValue !== undefined && rawValue !== null && typeof rawValue !== 'string') {
      throw new PromptError(`Argument "${spec.name}" must be text.`);
    }
    let value = typeof rawValue === 'string' ? cleanArgument(rawValue) : '';

    if (value === '') {
      if (spec.default !== undefined) {
        resolved[spec.name] = spec.default;
      } else if (spec.required) {
        throw new PromptError(
          `Missing required argument "${spec.name}" for prompt "${definition.name}": ${spec.description}`
        );
      }
      continue;
    }

    if (value.length > spec.maxLength) {
      throw new PromptError(
        `Argument "${spec.name}" is too long (${value.length} characters, at most ${spec.maxLength}).`
      );
    }
    if (spec.oneOf) {
      const lower = value.toLowerCase();
      if (!spec.oneOf.includes(lower)) {
        throw new PromptError(
          `Argument "${spec.name}" must be one of: ${spec.oneOf.join(', ')} (got "${value}").`
        );
      }
      value = lower;
    }
    const problem = spec.check?.(value) ?? null;
    if (problem) throw new PromptError(`Argument "${spec.name}" ${problem}`);
    resolved[spec.name] = spec.normalize ? spec.normalize(value) : value;
  }
  return resolved;
}
