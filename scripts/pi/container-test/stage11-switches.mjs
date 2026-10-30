// Stand-in for /opt/foundry-ai-tool/gm-browser/world-switches.mjs in the stage 11 container test
// (scripts/pi/container-test/stage11-scenarios.sh). The real one drives Chromium and sets the world switches; this
// one only records the call: one line per run in /tmp/switches (and on stdout) with the world the script was given,
// the world options.json launches at that moment and whether a GM login reached it, never a password value.
// /tmp/switchfail (world-writable, this runs as the foundry user) holds a number of calls that must fail first: each
// failing call counts it down and exits 1 after recording its line with " FAILED" at the end.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const e = process.env;
const launched = JSON.parse(readFileSync('/var/lib/foundry/Config/options.json', 'utf8')).world;
let failing = false;
if (existsSync('/tmp/switchfail')) {
  const left = Number(readFileSync('/tmp/switchfail', 'utf8').trim()) || 0;
  if (left > 0) {
    failing = true;
    writeFileSync('/tmp/switchfail', `${left - 1}\n`);
  }
}
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
