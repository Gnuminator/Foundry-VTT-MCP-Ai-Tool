/** Plain line output for the bot window and the CLI. */

export function info(message: string): void {
  process.stdout.write(`${message}\n`);
}

/** One line for an error: its message only, never the object dump (it can carry request headers or tokens). */
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'unexpected error (details not logged)';
}

export function error(message: string, err?: unknown): void {
  const detail = err === undefined ? '' : `: ${describeError(err)}`;
  process.stderr.write(`${message}${detail}\n`);
}
