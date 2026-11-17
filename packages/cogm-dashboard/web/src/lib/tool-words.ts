/**
 * A tool id in words for an error toast, never the id itself: "plan-combat-change" reads "Combat
 * change", "apply-planned-change" "The change", "undo-change" "Undo".
 */
export function toolWords(name: string): string {
  if (name === 'apply-planned-change') return 'The change';
  if (name === 'undo-change') return 'Undo';
  const words = name
    .replace(/^(plan|get|list|set)-/, '')
    .replace(/-/g, ' ')
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'The change';
}
