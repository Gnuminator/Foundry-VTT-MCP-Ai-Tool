// Stand-in for kit-session.mjs (there is no Foundry or Chromium in the container): prints what the kit-session stage
// hands it, never the password itself, and what the Pi looked like at that moment (the world options.json launches,
// whether the fake Foundry runs). It fails, after printing, when the scenario made /tmp/driverfail.
import { existsSync, readFileSync } from 'node:fs';

const options = JSON.parse(readFileSync('/var/lib/foundry/Config/options.json', 'utf8'));
const foundryRuns = !existsSync('/tmp/stopped-foundry.service');
console.log(
  `DRIVER ACTION=${process.env.ACTION} WORLD=${process.env.WORLD} HOME=${process.env.HOME} TOOL_APP=${process.env.TOOL_APP} MAX_DELETE=${process.env.MAX_DELETE ?? ''} HAS_USER=${(process.env.GM_USER || '') !== ''} HAS_PW=${(process.env.GM_PASSWORD || '') !== ''}`
);
console.log(`DRIVER_SEES options=${options.world} foundry_runs=${foundryRuns}`);
if (existsSync('/tmp/driverfail')) {
  console.log('[kit-session] error: the fake driver was told to fail');
  process.exit(1);
}
