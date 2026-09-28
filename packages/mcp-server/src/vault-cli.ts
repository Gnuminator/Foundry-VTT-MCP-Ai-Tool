/** Entry point for `npm run vault` (see vault/cli.ts). */
import { runVaultCli } from './vault/cli.js';

process.exitCode = await runVaultCli(process.argv.slice(2), {
  out: text => process.stdout.write(`${text}\n`),
  err: text => process.stderr.write(`${text}\n`),
});
