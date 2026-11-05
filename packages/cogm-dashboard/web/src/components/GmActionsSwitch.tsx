import type { JSX } from 'react';

import { useLivePlay } from '../lib/livePlay';
import { GM_ACTIONS, offReason, offSwitches } from '../lib/liveSwitches';
import { useDashboardSettings } from '../lib/stream';
import { Button, Popover } from '../ui';

const GM_ACTIONS_NAME = 'GM Actions';

/**
 * The live play line in the header: "Live play on", or "Live play off: Turn on" with what is off
 * in the tooltip and the accessible name. Start session is the only switch (it turns on GM Actions and every Turn on for
 * tonight switch, End session turns them off); this line only shows the state and opens the list
 * of switches, with one Turn on for whatever is off. When the module's switches cannot be read it
 * says so instead of "on". It replaces the old GM Actions button (#btn-gm).
 */
export function LivePlayLine(): JSX.Element {
  const live = useLivePlay();
  const gmActions = useDashboardSettings()?.gmActionsEnabled === true;
  const everything = [GM_ACTIONS, ...live.list.map(s => s.id)];
  const names = offSwitches(everything, gmActions, live.list);
  const rows = [
    { id: GM_ACTIONS, name: 'GM Actions', on: gmActions },
    ...live.list.map(s => ({
      id: s.id,
      name: s.name.replace(/^AI Tool: /, '').replace(/ \(writes\)$/, ''),
      on: s.on,
    })),
  ];
  // The button says it short; the list of what is off is in the tooltip and in the popover.
  const label = live.unreadable
    ? gmActions
      ? "Live play: can't read"
      : 'Live play off: Turn on'
    : names.length === 0
      ? 'Live play on'
      : 'Live play off: Turn on';
  const isOn = !live.unreadable && names.length === 0;
  const tip = live.unreadable
    ? gmActions
      ? 'The live play switches could not be read. Start session turns live play on and End session turns it off.'
      : `${offReason([GM_ACTIONS_NAME])}. Start session turns live play on and End session turns it off.`
    : names.length === 0
      ? 'Live play is on: everything is switched on. End session turns it off.'
      : `${offReason(names)}. Start session turns live play on and End session turns it off.`;
  return (
    <Popover
      label="Live play switches"
      align="end"
      trigger={
        <Button
          id="btn-gm"
          className={names.length === 0 && !live.unreadable ? 'on' : undefined}
          data-track="dash.header.gm-actions"
          title={tip}
          aria-label={isOn ? undefined : `${label}. ${tip}`}
        >
          {label}
        </Button>
      }
    >
      <ul className="live-switches" aria-label="Live play switches">
        {rows.map(r => (
          <li key={r.id} data-switch={r.id} data-on={r.on}>
            {r.on ? '✓' : '✗'} {r.name}
          </li>
        ))}
      </ul>
      {names.length > 0 && (
        <Button
          size="sm"
          variant="primary"
          data-track="dash.live.turn-on"
          busy={live.pending}
          busyLabel="Turning on..."
          onClick={live.turnOn}
        >
          Turn on
        </Button>
      )}
    </Popover>
  );
}
