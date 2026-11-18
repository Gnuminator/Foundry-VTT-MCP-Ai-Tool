/**
 * Change cards inside Claude (MCP Apps). A `plan-*` tool result can show as a small card with the
 * diff, in hosts that support the MCP Apps extension (Claude Desktop). The card is read-only: the
 * text plan is still the tool result, and Apply still goes through `apply-planned-change` with
 * Claude's own approval. Hosts without the extension ignore the tool's `_meta.ui` and the
 * resource, and show the text only.
 *
 * The stdio wrapper answers `resources/list` and `resources/read` itself (static HTML, no control
 * round trip), like the prompts.
 */
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ErrorCode,
  ListResourcesRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

/** Merge into the server's capabilities so clients ask for resources at all. */
export const RESOURCES_CAPABILITY = { resources: {} } as const;

export const CHANGE_CARD_URI = 'ui://foundry-ai-tool/change-card';
export const CHANGE_CARD_MIME = 'text/html;profile=mcp-app';

/** The card shows a plan, so it hangs on the tools that make one. */
export function hasChangeCard(toolName: string): boolean {
  return toolName.startsWith('plan-');
}

/** Adds the card pointer to a plan tool's definition; every other tool passes through unchanged. */
export function withChangeCardMeta<T extends { name: string; _meta?: unknown }>(tool: T): T {
  if (!hasChangeCard(tool.name)) return tool;
  const meta =
    tool._meta && typeof tool._meta === 'object' ? (tool._meta as Record<string, unknown>) : {};
  return {
    ...tool,
    _meta: {
      ...meta,
      ui: { resourceUri: CHANGE_CARD_URI },
      // Older MCP Apps hosts read the flat key.
      'ui/resourceUri': CHANGE_CARD_URI,
    },
  };
}

/**
 * The card page. It speaks the MCP Apps handshake over postMessage (ui/initialize, then
 * ui/notifications/tool-result) and draws the plan's diff with textContent only, so tool text can
 * never run as markup.
 */
export const CHANGE_CARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Planned change</title>
<style>
  :root { --bg: #ffffff; --fg: #1f2328; --muted: #656d76; --line: #d0d7de; --add: #1a7f37; --del: #cf222e; --chip: #eaeef2; }
  @media (prefers-color-scheme: dark) { :root { --bg: #1f1f1f; --fg: #e6e6e6; --muted: #9aa0a6; --line: #3a3a3a; --add: #3fb950; --del: #f85149; --chip: #2b2b2b; } }
  body { margin: 0; padding: 12px 14px; background: var(--bg); color: var(--fg); font: 14px/1.45 system-ui, sans-serif; }
  h1 { font-size: 15px; margin: 0 0 4px; }
  .meta { color: var(--muted); font-size: 12px; margin-bottom: 8px; }
  .chip { display: inline-block; background: var(--chip); border-radius: 10px; padding: 0 8px; margin-right: 6px; }
  .row { border-top: 1px solid var(--line); padding: 6px 0; }
  .target { font-weight: 600; }
  .path { color: var(--muted); font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
  .before { color: var(--del); text-decoration: line-through; font-family: ui-monospace, Consolas, monospace; }
  .after { color: var(--add); font-family: ui-monospace, Consolas, monospace; }
  .text { white-space: pre-wrap; }
  .foot { margin-top: 8px; color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<div id="root"><div class="meta">Waiting for the plan...</div></div>
<script>
(function () {
  var root = document.getElementById('root');
  var nextId = 1;
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function show(v) {
    if (v === undefined) return '(none)';
    return typeof v === 'string' ? v : JSON.stringify(v);
  }
  function parsePlan(result) {
    var parts = (result && result.content) || [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] && typeof parts[i].text === 'string') {
        try {
          var v = JSON.parse(parts[i].text);
          if (v && Array.isArray(v.diff)) return v;
        } catch (e) {}
      }
    }
    return null;
  }
  function plainText(result) {
    var parts = (result && result.content) || [];
    return parts.map(function (p) { return p && typeof p.text === 'string' ? p.text : ''; }).join('\\n');
  }
  function render(result) {
    root.textContent = '';
    var plan = parsePlan(result);
    if (!plan) {
      root.appendChild(el('div', 'text', plainText(result) || 'Nothing to show.'));
      return;
    }
    root.appendChild(el('h1', '', plan.summary || 'Planned change'));
    var meta = el('div', 'meta');
    if (plan.risk) meta.appendChild(el('span', 'chip', 'risk: ' + String(plan.risk)));
    if (plan.requires && plan.requires.confirmDestructive) meta.appendChild(el('span', 'chip', 'destructive'));
    if (plan.expiresAt) meta.appendChild(el('span', '', 'expires ' + plan.expiresAt));
    root.appendChild(meta);
    plan.diff.forEach(function (d) {
      var row = el('div', 'row');
      if (d.label) row.appendChild(el('div', 'target', d.label));
      if (d.path && ('before' in d || 'after' in d)) {
        var line = el('div');
        line.appendChild(el('span', 'path', d.path + '  '));
        line.appendChild(el('span', 'before', show(d.before)));
        line.appendChild(document.createTextNode('  \\u2192  '));
        line.appendChild(el('span', 'after', show(d.after)));
        row.appendChild(line);
      } else {
        row.appendChild(el('div', 'text', d.text || ''));
      }
      root.appendChild(row);
    });
    root.appendChild(el('div', 'foot', 'Nothing is changed yet. Ask Claude to apply it, or to leave it.'));
  }
  function send(msg) { window.parent.postMessage(msg, '*'); }
  window.addEventListener('message', function (event) {
    var m = event.data;
    if (!m || m.jsonrpc !== '2.0') return;
    if (m.method === 'ui/notifications/tool-result') render(m.params);
  });
  send({
    jsonrpc: '2.0',
    id: nextId++,
    method: 'ui/initialize',
    params: {
      appInfo: { name: 'foundry-ai-tool-change-card', version: '1.0.0' },
      appCapabilities: {},
      protocolVersion: '2026-01-26'
    }
  });
  send({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} });
})();
</script>
</body>
</html>
`;

/** `resources/list` and `resources/read` for the card. */
export function registerChangeCardHandlers(server: Server): void {
  server.setRequestHandler(ListResourcesRequestSchema, () => ({
    resources: [
      {
        uri: CHANGE_CARD_URI,
        name: 'Change card',
        description: 'A card with the diff of a planned change (MCP Apps hosts only).',
        mimeType: CHANGE_CARD_MIME,
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, request => {
    if (request.params.uri !== CHANGE_CARD_URI) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown resource: ${request.params.uri}`);
    }
    return {
      contents: [{ uri: CHANGE_CARD_URI, mimeType: CHANGE_CARD_MIME, text: CHANGE_CARD_HTML }],
    };
  });
}
