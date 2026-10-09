/**
 * Informational module logging. Warnings and errors use console.warn and console.error
 * directly, which the lint rule allows.
 */

/** Log an informational message to the browser console. */
export function logInfo(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(...args);
}

/** Log a debug message to the browser console. */
export function logDebug(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.debug(...args);
}
