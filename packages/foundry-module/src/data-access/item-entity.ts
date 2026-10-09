/**
 * dnd5e 6 item details for `get-character-entity` (G0 fixes batch 6): the fields a model asks
 * about first, read from the live item so derived values (uses left, to-hit, save DC, damage
 * formulas) are already computed by the system. The full `system` still travels next to them.
 */
import type { ActivitySummary, ItemEntityDetails } from '@gnuminator/shared';
import { contentsOf } from '../doc-read.js';
import {
  labelText,
  num,
  rec,
  str,
  strOrNull,
  usesOf,
  type Rec,
} from '../character-sheet-fields.js';

export type { ActivitySummary, ItemEntityDetails };

/** The activities of a dnd5e 6 item: a live Collection, or a plain object keyed by id (source). */
function activityList(activities: unknown): Rec[] {
  const fromCollection = contentsOf(activities);
  if (fromCollection.length > 0 || Array.isArray(rec(activities).contents)) return fromCollection;
  const values = Array.isArray(activities) ? activities : Object.values(rec(activities));
  return values.filter((v): v is Rec => v !== null && typeof v === 'object');
}

/** An optional string field, spread in only when present (`exactOptionalPropertyTypes`). */
function opt<K extends string>(key: K, value: string | null): { [P in K]?: string } {
  return (value ? { [key]: value } : {}) as { [P in K]?: string };
}

/** Summary of one activity from its prepared `labels`, falling back to the raw activation type. */
export function activitySummary(activity: Rec): ActivitySummary {
  const labels = rec(activity.labels);
  const uses = usesOf(activity);
  return {
    id: str(activity.id) || str(activity._id),
    name: str(activity.name),
    type: str(activity.type),
    ...opt('activation', labelText(labels.activation) ?? strOrNull(rec(activity.activation).type)),
    ...opt('range', labelText(labels.range)),
    ...opt('target', labelText(labels.target)),
    ...opt('toHit', labelText(labels.toHit)),
    ...opt('save', labelText(labels.save)),
    ...opt('damage', labelText(labels.damages ?? labels.damage)),
    ...(uses ? { uses } : {}),
  };
}

/** The dnd5e 6 details of an item's `system` (spells add level and school). */
export function itemEntityDetails(type: string, system: Rec): ItemEntityDetails {
  const details: ItemEntityDetails = {};
  if (type === 'spell') {
    details.level = num(system.level, 0);
    const school = strOrNull(system.school);
    if (school) details.school = school;
  }
  const rarity = strOrNull(system.rarity);
  if (rarity) details.rarity = rarity;
  if (system.quantity !== undefined) details.quantity = num(system.quantity, 1);
  if (typeof system.equipped === 'boolean') details.equipped = system.equipped;
  const attunement = strOrNull(system.attunement);
  if (attunement) {
    details.attunement = attunement;
    details.attuned = system.attuned === true;
  }
  const uses = usesOf(system);
  if (uses) details.uses = uses;
  const activities = activityList(system.activities).map(activitySummary);
  if (activities.length > 0) details.activities = activities;
  return details;
}
