/**
 * Foundry enrichers ("@UUID[...]{Label}", "[[/damage 2d6]]", "&Reference[condition=prone]") as
 * plain text. One function for the book search and the character sheet, so a fix lands in both.
 */

/** The words a "&Reference[...]" shows: "condition=prone apply=false" is "prone", "Spell Scroll" stays. */
function referenceName(inner: string): string {
  const withoutOptions = inner.replace(/(\s+\w+=\S*)+\s*$/, '').trim();
  const keyed = /^\w+=(.*)$/.exec(withoutOptions);
  return (keyed?.[1] ?? withoutOptions).trim();
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
