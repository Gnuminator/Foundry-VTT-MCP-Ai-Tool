// Stand-in for /opt/foundry-ai-tool/gm-browser/assistant-gm.mjs in the stage 11 container test
// (scripts/pi/container-test/stage11-scenarios.sh). The real one drives Chromium; this one only records the call:
// one line per run in /tmp/provision (and on stdout), with the world options.json launches at that moment and
// whether a password was given, never a password value.
import { appendFileSync, readFileSync } from 'node:fs';

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
appendFileSync('/tmp/provision', `${line}\n`);
console.log(line);
