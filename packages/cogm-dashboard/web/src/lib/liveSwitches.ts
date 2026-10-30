// Which switches a live control needs and which of them are off: plain data and rules, no React and
// no fetch, so they have unit tests (liveSwitches.test.ts). livePlay.ts has the hook.
import type { SessionSwitch } from './sessionSwitches';

/** The pseudo id of the dashboard's own GM Actions switch in a needs list. */
export const GM_ACTIONS = 'gm-actions';

/** The switches Start and End combat need (`plan-combat-change` is a live-play guarded write). */
export const COMBAT_NEEDS: readonly string[] = [GM_ACTIONS, 'writes', 'live-play'];
/** The switches the roll buttons need: `request-player-rolls` is a plain gated write, no feature. */
export const ROLL_NEEDS: readonly string[] = [GM_ACTIONS, 'writes'];
/** The switches Reveal next needs. */
export const HANDOUT_NEEDS: readonly string[] = [GM_ACTIONS, 'writes', 'handouts'];

/** The names of the switches in `needs` that are off, GM Actions first. Pure, for the tests. */
export function offSwitches(
  needs: readonly string[],
  gmActions: boolean,
  list: SessionSwitch[] | null
): string[] {
  const off: string[] = [];
  for (const id of needs) {
    if (id === GM_ACTIONS) {
      if (!gmActions) off.push('GM Actions');
    } else if (list) {
      const s = list.find(x => x.id === id);
      if (s && !s.on) off.push(s.name.replace(/^AI Tool: /, '').replace(/ \(writes\)$/, ''));
    }
  }
  return off;
}

/** "Live play is off" or "Handouts and GM Actions are off", one line a disabled control shows. */
export function offReason(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} is off`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} are off`;
}
