// The combat strip's roll row (item quick-roll-buttons): ask the party, or the picked player
// characters, for a check, save or skill in one click. Sent through QuickRoll's request-player-rolls
// path, so the roll is in the play log. Monsters have no player to ask; picked ones are left out.
import type { JSX } from 'react';

import type { Combatant } from '../lib/combat';
import { Button } from '../ui';
import { QuickRollBar, useQuickRoll } from './QuickRoll';

export function StripRolls({
  party,
  picked,
  stale,
}: {
  /** The player characters in the fight. */
  party: Combatant[];
  /** The picked combatants that are player characters. */
  picked: Combatant[];
  stale: boolean;
}): JSX.Element | null {
  const roll = useQuickRoll();
  if (party.length === 0) return null;
  const off = stale || roll.busy;
  const away = stale ? 'The bridge is away' : undefined;
  return (
    <QuickRollBar roll={roll} idPrefix="strip-roll">
      {picked.length > 0 && (
        <Button
          type="button"
          variant="primary"
          size="sm"
          id="strip-roll-picked"
          data-track="dash.quickroll.picked"
          aria-disabled={off ? 'true' : undefined}
          title={away}
          onClick={() => {
            if (!off) void roll.ask(picked.map(c => c.name));
          }}
        >
          {picked.length === 1 ? `Ask ${picked[0]?.name}` : `Ask ${picked.length} picked`}
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        id="strip-roll-party"
        data-track="dash.quickroll.party"
        aria-disabled={off ? 'true' : undefined}
        title={away}
        onClick={() => {
          if (!off) void roll.ask(party.map(c => c.name));
        }}
      >
        Ask the party
      </Button>
    </QuickRollBar>
  );
}
