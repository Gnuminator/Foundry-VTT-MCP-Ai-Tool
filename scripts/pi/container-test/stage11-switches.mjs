// Stand-in for /opt/foundry-ai-tool/gm-browser/world-switches.mjs in the stage 11 container test
// (scripts/pi/container-test/stage11-scenarios.sh). The real one drives Chromium and sets the world switches; this
// one only records the call: one line per run in /tmp/switches (and on stdout) with the world the script was given,
// the world options.json launches at that moment and whether a GM login reached it, never a password value.
// /tmp/switchfail present (world-writable, this runs as the foundry user) makes the call fail after recording it.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const e = process.env;
const launched = JSON.parse(readFileSync('/var/lib/foundry/Config/options.json', 'utf8')).world;
const failing = existsSync('/tmp/switchfail');
const line = [
  'SWITCHES',
  `world=${e.WORLD}`,
  `launches=${launched}`,
  `gm=${e.GM_USER || '-'}`,
  `pw=${Boolean(e.GM_PASSWORD)}`,
  `url=${e.FOUNDRY_URL}`,
].join(' ');
const shown = failing ? `${line} FAILED` : line;
appendFileSync('/tmp/switches', `${shown}\n`);
console.log(shown);
if (failing) process.exit(1);
