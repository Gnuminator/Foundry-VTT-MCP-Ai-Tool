// Runs one scenario script of scripts/pi/container-test/ in the one prebuilt Pi test image (Dockerfile next to this
// file). The Pi container tests call runStageContainer(script, options) instead of each carrying its own
// `docker run ... debian:13 bash <script>`. The image is built once per Dockerfile content: a pull of the published
// copy (pi-images.yml) is tried first, a local build is the fallback, so a changed Dockerfile always works.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, '..', '..', '..');
export const DOCKERFILE = path.join(here, 'Dockerfile');
export const REGISTRY_IMAGE = 'ghcr.io/gnuminator/foundry-ai-tool-pi-test';

/** The tag of the image for this Dockerfile: its content hash, so the image changes only when the file does. */
export function imageTag() {
  // Line endings do not count: pi-images.yml hashes the LF file that CI checks out.
  const text = readFileSync(DOCKERFILE, 'utf8').replace(/\r\n/g, '\n');
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

let ready = null;

/** The image reference to run, pulling or building it on first use. Throws when neither works. */
export function ensureImage() {
  if (ready) return ready;
  const tag = imageTag();
  const local = `foundry-ai-tool-pi-test:${tag}`;
  const docker = (args, timeout = 10 * 60_000) =>
    spawnSync('docker', args, {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout, // a hung pull or mirror fails here, not at the shard's 20 minutes
    });
  if (docker(['image', 'inspect', local]).status !== 0) {
    let got = false;
    if (!process.env.PI_TEST_IMAGE_NO_PULL) {
      const remote = `${REGISTRY_IMAGE}:${tag}`;
      got =
        docker(['pull', '--platform', 'linux/arm64', remote]).status === 0 &&
        docker(['tag', remote, local]).status === 0;
    }
    if (!got) {
      const build = () =>
        docker(
          ['build', '--platform', 'linux/arm64', '-t', local, '-f', DOCKERFILE, here],
          30 * 60_000, // a build under QEMU is slower than a pull
        );
      let b = build();
      if (b.status !== 0) {
        // One retry: a Debian mirror hiccup should not fail a required CI check.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20_000);
        b = build();
      }
      if (b.status !== 0)
        throw new Error(`building the Pi test image failed:\n${b.stdout}\n${b.stderr}`);
    }
  }
  ready = local;
  return local;
}

/**
 * Runs scripts/pi/container-test/<script> in the test image with the repo mounted read-only at /repo.
 * @param {string} script file name inside container-test/, for example 'stage32-scenarios.sh'
 * @param {{ env?: Record<string, string>, timeout?: number, maxBuffer?: number, args?: string[] }} [options]
 *   env: variables passed into the container; args: scenario names after the script
 */
export function runStageContainer(script, options = {}) {
  const { timeout = 900_000, maxBuffer = 16 * 1024 * 1024 } = options;
  return spawnSync('docker', dockerArgs(script, options), {
    encoding: 'utf8',
    maxBuffer,
    timeout,
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  });
}

/** The same run without blocking: resolves with stdout and stderr together (for shards that run side by side). */
export function runStageContainerAsync(script, options = {}) {
  const { timeout = 900_000 } = options;
  return new Promise(resolve => {
    const child = spawn('docker', dockerArgs(script, options), {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, MSYS_NO_PATHCONV: '1' },
    });
    let text = '';
    child.stdout.on('data', d => (text += d));
    child.stderr.on('data', d => (text += d));
    const timer = setTimeout(() => child.kill(), timeout);
    child.on('error', error => resolve(`${text}\n${error.message}`));
    child.on('close', () => {
      clearTimeout(timer);
      resolve(text);
    });
  });
}

function dockerArgs(script, { env = {}, args = [] }) {
  const envArgs = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  return [
    'run',
    '--rm',
    '--platform',
    'linux/arm64',
    '-v',
    `${REPO}:/repo:ro`,
    ...envArgs,
    ensureImage(),
    'bash',
    `/repo/scripts/pi/container-test/${script}`,
    ...args,
  ];
}
