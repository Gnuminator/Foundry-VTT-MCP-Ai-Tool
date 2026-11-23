/**
 * Character diaries, route B (I-183): after a session is marked, `plan-character-diaries` plans
 * one draft diary journal per player character, each owned by that character's player and the GM
 * only (everyone else gets no access). One guarded plan; apply-planned-change writes the journals
 * and undo-change removes them again.
 */

/** The guarded feature switch ("AI Tool: Character diaries (writes)"), off by default. */
export const CHARACTER_DIARY_FEATURE_ID = 'character-diary';
