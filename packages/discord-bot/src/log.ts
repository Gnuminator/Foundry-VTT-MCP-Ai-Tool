/** Plain line output for the bot window and the CLI. */

import { inspect } from 'node:util';

export function info(message: string): void {
  process.stdout.write(`${message}\n`);
}

export function error(message: string, err?: unknown): void {
  const detail =
    err === undefined
      ? ''
      : `: ${err instanceof Error ? err.message : typeof err === 'string' ? err : inspect(err)}`;
  process.stderr.write(`${message}${detail}\n`);
}
