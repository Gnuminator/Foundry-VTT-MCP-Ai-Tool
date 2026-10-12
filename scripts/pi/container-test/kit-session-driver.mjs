// Stand-in for kit-session.mjs (there is no Foundry or Chromium in the container): prints what the kit-session stage
// hands it, never the passwords themselves, and what the Pi looked like at that moment (the world options.json launches,
// whether the fake Foundry runs, whether the Kit GM password file is there). For the Kit GM password it prints only
// whether it is set and has the shape the real driver requires (32 lowercase hex characters); the value goes to
// /tmp/seen-kit-pw, a file of this test harness, so a scenario can look for it in the stage's output and calls.
// Setup ends with the line the real driver prints about the bridge user it replaced (ORIG_BRIDGE_USER=...): an id by
// default; /tmp/fake-orig-bridge holds EMPTY (Any GM), BAD (not a user id) or NONE (no such line) for a scenario.
// Teardown prints whether ORIG_BRIDGE_USER was handed to it. It fails, after printing, when the scenario made
// /tmp/driverfail.
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';

const options = JSON.parse(readFileSync('/var/lib/foundry/Config/options.json', 'utf8'));
const foundryRuns = !existsSync('/tmp/stopped-foundry.service');
const kitPw = process.env.KIT_GM_PASSWORD ?? '';
const kitEnv = '/etc/foundry-ai-tool/kit-gm.env';
const kitEnvMode = existsSync(kitEnv) ? (statSync(kitEnv).mode & 0o777).toString(8) : 'absent';
if (kitPw) writeFileSync('/tmp/seen-kit-pw', kitPw);
const origBridge =
  process.env.ORIG_BRIDGE_USER === undefined ? 'unset' : `set:${process.env.ORIG_BRIDGE_USER}`;
console.log(
  `DRIVER ACTION=${process.env.ACTION} WORLD=${process.env.WORLD} HOME=${process.env.HOME} TOOL_APP=${process.env.TOOL_APP} MAX_DELETE=${process.env.MAX_DELETE ?? ''} HAS_USER=${(process.env.GM_USER || '') !== ''} HAS_PW=${(process.env.GM_PASSWORD || '') !== ''} HAS_KITPW=${kitPw !== ''} KITPW_SHAPE=${/^[0-9a-f]{32}$/.test(kitPw)}`
);
console.log(
  `DRIVER_SEES options=${options.world} foundry_runs=${foundryRuns} kit_env=${kitEnvMode} orig_bridge=${origBridge}`
);
if (existsSync('/tmp/driverfail')) {
  console.log('[kit-session] error: the fake driver was told to fail');
  process.exit(1);
}
if (process.env.ACTION === 'setup') {
  const mode = existsSync('/tmp/fake-orig-bridge')
    ? readFileSync('/tmp/fake-orig-bridge', 'utf8').trim()
    : '';
  const reported = { '': 'AbCdEfGh01234567', EMPTY: '', BAD: 'not-an-id!' }[mode];
  if (mode !== 'NONE') console.log(`[kit-session] ORIG_BRIDGE_USER=${reported}`);
}
