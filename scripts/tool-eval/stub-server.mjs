#!/usr/bin/env node
/**
 * The stub MCP server of `npm run tool-eval`: serves main's real tool list for the connector sets
 * a case switches on (names, descriptions, schemas and the connector instructions, from the dump
 * that tool-eval-dump.test.ts writes) and answers every call with a canned result from the case.
 * No Foundry, no bridge, no port: it talks stdio to `claude -p`.
 *
 *   node stub-server.mjs --dump <dump.json> --sets core,play --results <results.json>
 */
import { readFileSync } from 'node:fs';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const dump = JSON.parse(readFileSync(arg('dump'), 'utf8'));
const sets = (arg('sets') ?? 'core').split(',');
const results = JSON.parse(readFileSync(arg('results'), 'utf8'));
const tools = dump.tools.filter(t => sets.includes(t.set));
const key = ['core', ...sets.filter(s => s !== 'core')].join(',');
// The dump has one text per combination in canonical set order.
const order = ['core', 'play', 'prep', 'build', 'admin'];
const instructionsKey = order.filter(s => s === 'core' || sets.includes(s)).join(',');
const instructions = dump.instructions[instructionsKey] ?? dump.instructions[key];

const server = new Server(
  { name: 'foundry-mcp', version: '0.0.0' },
  { capabilities: { tools: {} }, instructions }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
}));

server.setRequestHandler(CallToolRequestSchema, async request => {
  const name = request.params.name;
  if (!tools.some(t => t.name === name)) {
    return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  }
  let canned = results[name];
  // {"$match": [{"when": "word", "result": ...}], "else": ...}: pick by the call's arguments.
  if (canned && typeof canned === 'object' && Array.isArray(canned.$match)) {
    const args = JSON.stringify(request.params.arguments ?? {}).toLowerCase();
    const hit = canned.$match.find(m => args.includes(String(m.when).toLowerCase()));
    canned = hit ? hit.result : canned.else;
  }
  const text =
    canned === undefined
      ? JSON.stringify({ ok: true, note: 'Stub result: no data for this call in the eval.' })
      : typeof canned === 'string'
        ? canned
        : JSON.stringify(canned);
  return { content: [{ type: 'text', text }] };
});

await server.connect(new StdioServerTransport());
