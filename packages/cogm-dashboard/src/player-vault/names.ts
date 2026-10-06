/**
 * Safe file and folder names for the player vault (O7). Names come from Foundry (handout titles,
 * character and user names), so they are reduced to characters every OS and Obsidian accept, and
 * never carry link syntax (`[[`, `]]`, `|`, `#`, `^`) that Obsidian would treat as a link.
 */

/** Longest name we write, before the extension. */
export const MAX_NAME_LENGTH = 120;

const UNSAFE = /[\\/:*?"<>|#^[\]{}%~`$]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/**
 * A name that is safe as one path segment: unsafe characters become spaces, runs of spaces
 * collapse, leading dots and trailing dots or spaces go (no hidden files, no Windows trouble),
 * Windows device names get a trailing underscore, and the result is at most
 * {@link MAX_NAME_LENGTH} characters. Empty results become `fallback`.
 */
export function safeFileName(name: string, fallback: string): string {
  let out = String(name ?? '')
    .normalize('NFC')
    .replace(CONTROL, ' ')
    .replace(UNSAFE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[. ]+/, '')
    .replace(/[. ]+$/, '');
  if (out.length > MAX_NAME_LENGTH) out = out.slice(0, MAX_NAME_LENGTH).replace(/[. ]+$/, '');
  if (out === '') return fallback;
  if (RESERVED.test(out)) out = `${out}_`;
  return out;
}

/**
 * Hands out unique names within one folder: the second "Letter" becomes "Letter (2)".
 * Comparison ignores case, as Windows and macOS file systems do.
 */
export class NameAllocator {
  private readonly used = new Set<string>();

  take(name: string, fallback: string): string {
    const base = safeFileName(name, fallback);
    let candidate = base;
    for (let n = 2; this.used.has(candidate.toLowerCase()); n++) candidate = `${base} (${n})`;
    this.used.add(candidate.toLowerCase());
    return candidate;
  }
}
