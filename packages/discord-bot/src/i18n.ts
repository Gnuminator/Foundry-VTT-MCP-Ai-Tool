/**
 * Bot language (item bot-language, D-143): every post the bot writes for people is bilingual, Danish
 * first and English below it, so it reads right whether or not a table plays in Danish. Game terms
 * (attack, saving throw, token, roll) stay English inside the Danish text, like the GM guides
 * (docs/da/gm/glossary.md). Logs stay English: they are for the owner and for support.
 */

/** Danish text, a line break, then the English text. */
export function bi(da: string, en: string): string {
  return `${da}\n${en}`;
}

/** Danish singular or plural, and English singular or plural, for a count. */
export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** Discord slash command localisations: the Danish text, keyed by Discord's locale code. */
export function da(text: string): { da: string } {
  return { da: text };
}
