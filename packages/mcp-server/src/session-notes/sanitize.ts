/**
 * Allowlist sanitizer for session notes HTML (recap lane, D-087). The pipeline's text is
 * AI-written, so the bridge keeps only plain structure before anything reaches Foundry:
 * `h2`, `h3`, `p`, `ul`, `ol`, `li`, `em`, `strong`, `br`, never an attribute. `script` and
 * `style` are dropped with their content; any other tag is dropped and its text kept.
 */
import { Parser } from 'htmlparser2';

const ALLOWED = new Set(['h2', 'h3', 'p', 'ul', 'ol', 'li', 'em', 'strong', 'br']);
const VOID = new Set(['br']);
/** Elements whose content is dropped with them. */
const DROP_CONTENT = new Set(['script', 'style', 'template', 'iframe', 'object', 'noscript']);

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The allowlisted HTML of `html`; text is re-escaped, so no markup survives in it. */
export function sanitizeNotesHtml(html: string): string {
  const out: string[] = [];
  const open: string[] = [];
  let dropDepth = 0;
  const parser = new Parser(
    {
      onopentag(name): void {
        if (dropDepth > 0 || DROP_CONTENT.has(name)) {
          if (!VOID.has(name)) dropDepth += 1;
          return;
        }
        if (!ALLOWED.has(name)) return;
        if (VOID.has(name)) {
          out.push(`<${name}>`);
          return;
        }
        open.push(name);
        out.push(`<${name}>`);
      },
      ontext(text): void {
        if (dropDepth === 0) out.push(escapeText(text));
      },
      onclosetag(name): void {
        if (dropDepth > 0) {
          if (!VOID.has(name)) dropDepth -= 1;
          return;
        }
        if (!ALLOWED.has(name) || VOID.has(name)) return;
        const at = open.lastIndexOf(name);
        if (at < 0) return;
        // Close anything left open inside it, so the output is always well nested.
        while (open.length > at) out.push(`</${open.pop()}>`);
      },
    },
    { decodeEntities: true, lowerCaseTags: true, recognizeSelfClosing: true }
  );
  parser.write(html);
  parser.end();
  while (open.length > 0) out.push(`</${open.pop()}>`);
  // Empty elements (a stray `</p>` opens and closes an implied one) carry nothing.
  let result = out.join('');
  for (let before = ''; before !== result; ) {
    before = result;
    result = result.replace(/<(h2|h3|p|ul|ol|li|em|strong)>\s*<\/\1>/g, '');
  }
  return result.trim();
}
