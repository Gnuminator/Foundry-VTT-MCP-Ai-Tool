// The usage log (I-084): public/usage.js, loaded by index.html, sets window.cogmUsage and reports
// clicks on elements with a literal data-track="dash.x.y" by itself. Names must be string literals
// (scripts/usage-catalog.mjs scans web/src too). The page works the same when usage.js is missing.

type UsageKind = 'view' | 'action' | 'tool' | 'shortcut' | 'error';

interface CogmUsage {
  track(kind: UsageKind, name: string, extra?: { code?: string; outcome?: string }): void;
  /** A bridge tool run (tool.<name>): ok, error with a code, or cancelled. */
  trackTool(toolName: string, outcome: 'ok' | 'error' | 'cancelled', code?: string): void;
  /** A view (drawer, panel) is open from now until endView; only its visible time counts. */
  trackView(name: string): void;
  endView(name: string): void;
}

declare global {
  interface Window {
    cogmUsage?: CogmUsage;
  }
}

const noop: CogmUsage = {
  track: () => undefined,
  trackTool: () => undefined,
  trackView: () => undefined,
  endView: () => undefined,
};

export function usage(): CogmUsage {
  return window.cogmUsage ?? noop;
}
