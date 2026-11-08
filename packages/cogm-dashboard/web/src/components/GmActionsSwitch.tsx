import type { JSX } from 'react';

import { useLivePlay } from '../lib/livePlay';
import { GM_ACTIONS, offReason, offSwitches } from '../lib/liveSwitches';
import { useDashboardSettings } from '../lib/stream';
import { Button, Popover } from '../ui';

const GM_ACTIONS_NAME = 'GM Actions';

/**
 * The GM Actions button in the header: "GM Actions on", or "GM Actions off: Turn on" with what is off
 * in the tooltip and the accessible name. Start session is the only switch (it turns on GM Actions and every Turn on for
 * tonight switch, End session turns them off); this button only shows the state and opens the list
 * of switches, with one Turn on for whatever is off. When the module's switches cannot be read it
 * says so instead of "on". It replaces the old GM Actions button (#btn-gm).
 */
export function GmActionsButton(): JSX.Element {
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
      ? "GM Actions: can't read"
      : 'GM Actions off: Turn on'
    : names.length === 0
      ? 'GM Actions on'
      : 'GM Actions off: Turn on';
  const isOn = !live.unreadable && names.length === 0;
  const tip = live.unreadable
    ? gmActions
      ? 'The GM Actions switches could not be read. Start session turns GM Actions on; End session turns the switches off.'
      : `${offReason([GM_ACTIONS_NAME])}. Start session turns GM Actions on; End session turns the switches off.`
    : names.length === 0
      ? 'GM Actions is on: everything is switched on. End session turns the switches off.'
      : `${offReason(names)}. Start session turns GM Actions on; End session turns the switches off.`;
  return (
    <Popover
      label="GM Actions switches"
      align="end"
      trigger={
        <Button
          id="btn-gm"
          className={names.length === 0 && !live.unreadable ? 'on' : undefined}
          data-track="dash.header.gm-actions"
          data-gm-actions={gmActions ? 'on' : 'off'}
          title={tip}
          aria-label={isOn ? undefined : `${label}. ${tip}`}
        >
          {label}
        </Button>
      }
    >
      <ul className="live-switches" aria-label="GM Actions switches">
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
