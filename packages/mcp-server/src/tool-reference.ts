/**
 * The tool reference page (I-081): `docs/reference/tools.md`, rendered from
 * the tool catalog so it cannot drift. tool-reference.test.ts compares the
 * committed page with this output and fails CI when they differ; `npm run
 * docs:tools` rewrites the page.
 *
 * Pass the definitions without picker annotations (`stripToolRefs`), the way
 * MCP clients see them. Pure: no I/O.
 */
import type { ToolDefinitionLike } from './tool-router.js';
import { TOOL_SETS, TOOL_SET_NAMES, type ToolSetName } from './tool-sets.js';

interface JsonSchema {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  minItems?: number;
  maxItems?: number;
  items?: JsonSchema;
  oneOf?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
}

/** The Claude Desktop entry that serves a set (the installer writes these names). */
export function claudeDesktopEntry(set: ToolSetName): string {
  return set === 'core' ? 'foundry-mcp' : `foundry-mcp-${set}`;
}

/** Escape `<` and `*` outside code spans: HTML examples and "**bold**" in descriptions show as text. */
function escapeText(text: string): string {
  return text
    .split('`')
    .map((part, i) => (i % 2 === 0 ? part.replace(/</g, '&lt;').replace(/\*/g, '\\*') : part))
    .join('`');
}

function oneLine(text: string): string {
  return escapeText(text.replace(/\s*\n\s*/g, ' ').trim());
}

function code(value: unknown): string {
  // An empty or space-edged string shows quoted, or the code span would be empty or trimmed.
  const plain = typeof value === 'string' && value.trim() === value && value !== '';
  return `\`${plain ? value : JSON.stringify(value)}\``;
}

/** A tool description as Markdown: paragraphs, and lines starting with a bullet as a list. */
function renderDescription(description: string | undefined): string[] {
  if (!description?.trim()) return ['No description.'];
  // Blocks: a paragraph (its lines joined) or a run of list items; a blank line between blocks.
  const blocks: { list: boolean; lines: string[] }[] = [];
  let open = false; // whether the last paragraph block still takes lines
  for (const raw of description.split('\n')) {
    const line = raw.trim();
    const bullet = /^[-•*]\s+(.*)$/.exec(line);
    const last = blocks[blocks.length - 1];
    if (line === '') {
      open = false;
    } else if (!bullet && last?.list && /^\s/.test(raw)) {
      // An indented line under a list item ("  Required: ...") becomes a nested item.
      last.lines.push(`  - ${escapeText(line)}`);
    } else if (bullet) {
      const item = `- ${escapeText(bullet[1] ?? '')}`;
      if (last?.list) last.lines.push(item);
      else blocks.push({ list: true, lines: [item] });
      open = false;
    } else if (open && last && !last.list) {
      last.lines.push(line);
    } else {
      blocks.push({ list: false, lines: [line] });
      open = true;
    }
  }
  return blocks.flatMap((block, i) => [
    ...(i > 0 ? [''] : []),
    ...(block.list ? block.lines : [escapeText(block.lines.join(' '))]),
  ]);
}

function typeLabel(schema: JsonSchema): string {
  if (schema.oneOf) return schema.oneOf.map(typeLabel).join(' or ');
  const type = Array.isArray(schema.type) ? schema.type.join(' or ') : (schema.type ?? 'any');
  return type === 'array' ? `array of ${schema.items ? typeLabel(schema.items) : 'any'}` : type;
}

/** "1 to 50", "at least 1", "above 0", "at most 10", or '' when unbounded. */
function bounds(low: number | undefined, high: number | undefined, lowExclusive = false): string {
  if (low !== undefined && high !== undefined) return `${low} to ${high}`;
  if (low !== undefined) return lowExclusive ? `above ${low}` : `at least ${low}`;
  if (high !== undefined) return `at most ${high}`;
  return '';
}

function valueNotes(schema: JsonSchema): string[] {
  const notes: string[] = [];
  const range = bounds(
    schema.minimum ?? schema.exclusiveMinimum,
    schema.maximum,
    schema.minimum === undefined && schema.exclusiveMinimum !== undefined
  );
  if (range) notes.push(`Range: ${range}.`);
  const items = bounds(schema.minItems, schema.maxItems);
  if (items) notes.push(`Items: ${items}.`);
  const choices = schema.enum ?? schema.items?.enum;
  if (choices) notes.push(`One of: ${choices.map(code).join(', ')}.`);
  if (schema.const !== undefined) notes.push(`Always ${code(schema.const)}.`);
  if (schema.default !== undefined) notes.push(`Default: ${code(schema.default)}.`);
  return notes;
}

function renderProperties(schema: JsonSchema, indent: string): string[] {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).flatMap(([name, prop]) => {
    const head = `${code(name)} (${typeLabel(prop)}${required.has(name) ? ', required' : ''})`;
    const notes = valueNotes(prop);
    let description = prop.description ? oneLine(prop.description) : '';
    if (description && notes.length > 0 && !/[.!?:]$/.test(description)) description += '.';
    const text = [description, ...notes].filter(Boolean).join(' ');
    const lines = [`${indent}- ${head}${text ? `: ${text}` : ''}`];
    const nested = prop.properties ? prop : prop.items?.properties ? prop.items : undefined;
    if (nested) lines.push(...renderProperties(nested, `${indent}  `));
    return lines;
  });
}

function renderTool(tool: ToolDefinitionLike): string[] {
  const schema = (tool.inputSchema ?? {}) as JsonSchema;
  const params = renderProperties(schema, '');
  return [
    `### ${tool.name}`,
    '',
    ...renderDescription(tool.description),
    '',
    ...(params.length > 0 ? ['Parameters:', '', ...params] : ['No parameters.']),
    '',
  ];
}

/** The whole page. `tools` must be the full catalog (every tool is in exactly one set). */
export function renderToolReference(tools: readonly ToolDefinitionLike[]): string {
  const byName = new Map(tools.map(tool => [tool.name, tool]));
  const lines: string[] = [
    '---',
    'description: Every tool the bridge serves, by tool set, with its description and parameters. Generated from the tool catalog.',
    '---',
    '',
    '<!-- Generated from the tool catalog by packages/mcp-server/src/tool-reference.ts. Do not edit by hand: run `npm run docs:tools` after changing a tool. CI fails when this page is stale. -->',
    '',
    '# Tool reference',
    '',
    `The bridge serves ${tools.length} tools in five sets. [Tool sets](TOOL-SETS.md) explains the sets and how Claude Desktop loads them; this page lists every tool with the description and parameters Claude reads.`,
    '',
    '| Set | Claude Desktop entry | Tools | For |',
    '| --- | --- | --- | --- |',
    ...TOOL_SET_NAMES.map(
      set =>
        `| [${TOOL_SETS[set].title}](#${set}) | \`${claudeDesktopEntry(set)}\` | ${TOOL_SETS[set].tools.length} | ${TOOL_SETS[set].purpose} |`
    ),
    '',
  ];
  for (const set of TOOL_SET_NAMES) {
    const spec = TOOL_SETS[set];
    lines.push(`## ${spec.title}`, '', spec.purpose, '');
    for (const name of spec.tools) {
      const tool = byName.get(name);
      if (!tool) throw new Error(`Tool set ${set} lists ${name}, which is not in the catalog`);
      lines.push(...renderTool(tool));
    }
  }
  return lines.join('\n').replace(/\n+$/, '\n');
}
