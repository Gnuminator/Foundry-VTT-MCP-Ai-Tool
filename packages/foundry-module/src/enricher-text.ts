/**
 * Foundry enrichers ("@UUID[...]{Label}", "[[/damage 2d6]]", "&Reference[condition=prone]") as
 * plain text. One function for the book search and the character sheet, so a fix lands in both.
 */

const unquote = (v: string): string => v.replace(/^(["'])(.*)\1$/, '$2');

/**
 * The words a "&Reference[...]" shows. Tokenized like dnd5e's parseConfig: whitespace separates
 * tokens outside quotes, "key=value" is an option wherever it sits, quotes are stripped. A
 * boolean or numeric option ("apply=false", "level=3") is never the name; "condition=prone"
 * names its value, "Spell Scroll" keeps its words, "Prone=1" (a level or count) is named by
 * its key as a last resort.
 */
export function referenceName(inner: string): string {
  const tokens = inner.match(/[^\s"'=]+=(?:"[^"]*"|'[^']*'|\S*)|"[^"]*"|'[^']*'|\S+/g) ?? [];
  const positional: string[] = [];
  const valued: string[] = [];
  const counted: string[] = [];
  for (const token of tokens) {
    const opt = /^([^\s"'=]+)=(.*)$/.exec(token);
    if (!opt) {
      positional.push(unquote(token));
      continue;
    }
    const value = unquote(opt[2] ?? '');
    if (value === '' || /^(true|false)$/i.test(value)) continue;
    if (/^\d+(\.\d+)?$/.test(value)) counted.push(opt[1] ?? '');
    else valued.push(value);
  }
  if (valued.length > 0) return valued[0]?.trim() ?? '';
  if (positional.length > 0) return positional.join(' ').trim();
  return (counted[0] ?? '').trim();
}

export function enrichersToText(html: string): string {
  return (
    html
      // Labelled enrichers keep their label; a bare roll keeps its command and arguments
      // ("[[/damage 2d6 fire]]" reads "damage 2d6 fire"); a bare reference keeps its name.
      .replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, '$1')
      .replace(/\[\[[^\]]*\]\]\{([^}]*)\}/g, '$1')
      .replace(/\[\[\s*\/?(\w+)\s*([^\]]*)\]\]/g, '$1 $2')
      .replace(/&(?:amp;)?Reference\[[^\]]*\]\{([^}]*)\}/g, '$1')
      .replace(/&(?:amp;)?Reference\[([^\]]*)\]/g, (_m, inner: string) => referenceName(inner))
      // A bare link has no name to show: "(link)" keeps "see ." from reading as a gap.
      .replace(/@UUID\[[^\]]*\]/g, '(link)')
      .replace(/@Embed\[[^\]]*\]/g, '')
  );
}
