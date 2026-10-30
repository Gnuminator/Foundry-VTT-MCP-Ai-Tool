// The combat strip's "Use Foundry targets" button (item foundry-targets-picker): picks the
// combatants whose tokens the GM has targeted (else selected) in Foundry. A lazy chunk of its own
// (first-load budget). It only reads; the pick feeds Damage / Heal and the roll row.
import type { JSX } from 'react';

import { errorText } from '../lib/api';
import { combatIdsFor, fetchFoundryTargets, targetsNote } from '../lib/foundryTargets';

export function FoundryTargetsButton({
  combatants,
  stale,
  onPick,
  note,
  onNote: setNote,
}: {
  combatants: ReadonlyArray<{ id: string; tokenId: string | null }>;
  stale: boolean;
  onPick: (ids: string[]) => void;
  /** The last result line; kept by the caller so it survives this button remounting. */
  note: string;
  onNote: (note: string) => void;
}): JSX.Element {
  const away = stale ? 'The bridge is away' : undefined;
  const run = (): void => {
    setNote('Reading Foundry…');
    void fetchFoundryTargets().then(
      found => {
        const ids = combatIdsFor(combatants, found.tokens);
        const missing = found.tokens.length - ids.length;
        setNote(
          found.source === 'none'
            ? targetsNote(found)
            : `${ids.length} ${found.source} in Foundry picked${missing > 0 ? `, ${missing} not in this fight` : ''}`
        );
        if (ids.length > 0) onPick(ids);
      },
      (err: unknown) => setNote(`Could not read Foundry: ${errorText(err)}`)
    );
  };
  return (
    <>
      <button
        type="button"
        className="ca-btn"
        data-track="dash.combat.foundry-targets"
        data-sel="foundry"
        aria-disabled={stale ? 'true' : undefined}
        title={away ?? 'Pick the combatants you have targeted (or selected) in Foundry'}
        onClick={() => {
          if (!stale) run();
        }}
      >
        Use Foundry targets
      </button>
      <span className="ca-hint" role="status">
        {note}
      </span>
    </>
  );
}
