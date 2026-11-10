/**
 * The one source for every port the tool uses. `shared/ports.json` is the same table for
 * scripts that cannot import TypeScript (PowerShell, node .mjs, shell); a test keeps the two equal
 * and fails on a new port literal in production code (see `ports.test.ts`).
 *
 * Each environment is one row: Foundry, the bridge control channel, the Foundry link and the
 * co-GM dashboard. The live row (31414 to 31416) is never bound from a dev session.
 */
export interface PortSet {
  foundry: number;
  control: number;
  link: number;
  dashboard: number;
}

export const PORTS = {
  /** The real campaign (the Pi on game night, or this PC's Plan B with `-GameNight`). */
  live: { foundry: 30000, control: 31414, link: 31415, dashboard: 3000 },
  /** Test server A (default for quick checks and `live:roundtrip`). */
  testA: { foundry: 30001, control: 31514, link: 31515, dashboard: 3100 },
  testB: { foundry: 30002, control: 31524, link: 31525, dashboard: 3101 },
  testC: { foundry: 30003, control: 31534, link: 31535, dashboard: 3102 },
  /** Plan B rehearsal (everything shifted so it never meets the live ports). */
  rehearsal: { foundry: 30100, control: 31614, link: 31615, dashboard: 3300 },
} as const satisfies Record<string, PortSet>;

/** Other fixed ports. */
export const EXTRA_PORTS = {
  /** Third bridge port next to control and link; reserved, never bound by this tool. */
  liveReserved: 31416,
  /** Test bridge reserved port, same idea. */
  testReserved: 31516,
  controlCenter: 3200,
} as const;

/** What the release builds listen on when nothing overrides them. */
export const DEFAULT_CONTROL_PORT = PORTS.live.control;
export const DEFAULT_LINK_PORT = PORTS.live.link;
export const DEFAULT_FOUNDRY_PORT = PORTS.live.foundry;
export const DEFAULT_DASHBOARD_LISTEN_PORT = PORTS.live.dashboard;

/** Every port a helper container or tool must refuse to take (live, test, reserved). */
export function forbiddenPorts(): number[] {
  const set = new Set<number>();
  for (const key of ['live', 'testA', 'testB', 'testC'] as const) {
    for (const port of Object.values(PORTS[key])) set.add(port);
  }
  set.add(EXTRA_PORTS.liveReserved);
  set.add(EXTRA_PORTS.testReserved);
  return [...set].sort((a, b) => a - b);
}

/** The JSON form written to `shared/ports.json`. */
export function portsJson(): string {
  return `${JSON.stringify({ ports: PORTS, extra: EXTRA_PORTS, forbidden: forbiddenPorts() }, null, 2)}\n`;
}
