/**
 * `GET /api/space` (GM only): the storage space check's result for the dashboard banner.
 *
 * The Pi writes the status file (scripts/pi); this route only reads it. The GM page asks every few
 * minutes. No file (a dev machine, an old Pi) answers `{ available: false }` and the page shows
 * nothing. The players' pages (/player, /me) never call it, and the route refuses anyone who is
 * not the GM.
 */
import type { Express, Request, Response } from 'express';

import type { SpaceLevel, SpaceReading } from '@gnuminator/shared';

export interface SpaceDiskView {
  mount: string;
  freePercent: number;
  freeGb: number;
  level: SpaceLevel;
  jobs: string[];
}

export type SpaceView =
  | { available: false; reason: string }
  | {
      available: true;
      level: SpaceLevel;
      stale: boolean;
      checkedAt: string;
      host: string;
      thresholdPercent: number;
      disks: SpaceDiskView[];
    };

export function spaceView(reading: SpaceReading): SpaceView {
  if (reading.state !== 'available') return { available: false, reason: reading.reason };
  const s = reading.status;
  return {
    available: true,
    level: s.level,
    stale: reading.stale,
    checkedAt: s.checkedAt,
    host: s.host,
    thresholdPercent: s.thresholdPercent,
    disks: s.disks.map(d => ({
      mount: d.mount,
      freePercent: d.freePercent,
      freeGb: Math.round((d.freeBytes / 1e9) * 10) / 10,
      level: d.level,
      jobs: d.jobs,
    })),
  };
}

export interface SpaceRouteOptions {
  readStatus: () => SpaceReading;
  requireGm: (req: Request, res: Response, next: () => void) => void;
}

export function mountSpaceRoute(app: Express, options: SpaceRouteOptions): void {
  app.get('/api/space', options.requireGm, (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(spaceView(options.readStatus()));
  });
}
