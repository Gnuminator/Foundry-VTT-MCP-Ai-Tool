/** Entry point for `npm run obsidian` (see obsidian/cli.ts). */
import { runObsidianCli } from './obsidian/cli.js';

process.exitCode = await runObsidianCli(process.argv.slice(2), {
  out: text => process.stdout.write(`${text}\n`),
  err: text => process.stderr.write(`${text}\n`),
});
