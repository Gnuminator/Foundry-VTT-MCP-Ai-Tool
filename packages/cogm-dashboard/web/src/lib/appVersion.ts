// The tool version shown in the header (test 3: the GM looked for it there). Vite writes it into the
// bundle at build time from the dashboard's package.json, so it costs a few bytes and no request.
declare const __APP_VERSION__: string | undefined;

/** "v0.24.0", or null when the build did not set it (tests, stories). */
export function appVersionLabel(raw?: string | undefined): string | null {
  const value = raw ?? (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '');
  return /^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(value) ? `v${value}` : null;
}
