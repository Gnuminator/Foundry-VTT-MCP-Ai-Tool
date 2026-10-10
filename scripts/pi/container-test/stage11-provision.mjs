// Stand-in for /opt/foundry-ai-tool/gm-browser/assistant-gm.mjs in the stage 11 container test
// (scripts/pi/container-test/stage11-scenarios.sh). The real one drives Chromium; this one only records the call:
// one line per run in /tmp/provision (and on stdout), with the world options.json launches at that moment and
// whether a password was given, never a password value. /tmp/provfail holds a number of calls that must fail
// first (the scenario writes it, the file is world-writable because this runs as the foundry user): each failing
// call counts it down and exits 1 after recording its line with " FAILED" at the end.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

if (process.argv[2] !== 'provision') {
  console.error(`fake assistant-gm: unexpected arguments ${process.argv.slice(2).join(' ')}`);
  process.exit(2);
}
const e = process.env;
const world = JSON.parse(readFileSync('/var/lib/foundry/Config/options.json', 'utf8')).world;
const line = [
  'PROVISION',
  `world=${world}`,
  `gm=${e.PROVISION_GM_USER}`,
  `new_pw=${Boolean(e.PROVISION_GM_NEW_PASSWORD)}`,
  `extra=${e.PROVISION_EXTRA_GM_USER || '-'}`,
  `extra_pw=${Boolean(e.PROVISION_EXTRA_GM_PASSWORD)}`,
  `assistant=${e.ASSISTANT_GM_USER}`,
].join(' ');
let failing = false;
if (existsSync('/tmp/provfail')) {
  const left = Number(readFileSync('/tmp/provfail', 'utf8').trim()) || 0;
  if (left > 0) {
    failing = true;
    writeFileSync('/tmp/provfail', `${left - 1}\n`);
  }
}
const shown = failing ? `${line} FAILED` : line;
appendFileSync('/tmp/provision', `${shown}\n`);
console.log(shown);
if (failing) process.exit(1);
