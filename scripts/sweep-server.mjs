/**
 * The test dashboard port for `--server A|B|C` (live-write-sweep). Ports come from
 * shared/ports.json, the one ports source. Throws on an unknown server.
 */
import { readFileSync } from 'node:fs';

const PORTS = JSON.parse(
  readFileSync(new URL('../shared/ports.json', import.meta.url), 'utf8')
).ports;
const SERVER_PORTS = {
  A: PORTS.testA.dashboard,
  B: PORTS.testB.dashboard,
  C: PORTS.testC.dashboard,
};

export function parseServerArg(argv) {
  const i = argv.findIndex(a => a === '--server' || a.startsWith('--server='));
  const name = i < 0 ? 'A' : ((argv[i].includes('=') ? argv[i].split('=')[1] : argv[i + 1]) ?? '');
  if (!(name in SERVER_PORTS)) {
    throw new Error(
      `--server must be one of ${Object.keys(SERVER_PORTS).join(', ')} (got "${name}")`
    );
  }
  return { name, port: SERVER_PORTS[name] };
}
