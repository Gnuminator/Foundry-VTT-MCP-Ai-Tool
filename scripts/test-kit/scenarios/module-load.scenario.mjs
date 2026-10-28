/**
 * Module load check for the module rehearsal (I-117): in the kit world with the `modules-all`
 * profile every module of the Strahd list is active, and the diagnostics hold no module error
 * that is not on the expected list (scripts/modules/expected.json). On other profiles only the
 * error check runs.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitFindings } from '../../modules/lib.mjs';
import { errorFindings } from '../../modules/rehearse.mjs';
import { listOf } from '../lib/helpers.mjs';

const modulesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'modules');
const readJson = file => JSON.parse(readFileSync(path.join(modulesDir, file), 'utf8'));

/** @type {import('../lib/contract.mjs').Scenario} */
export default {
  id: 'module-load',
  title: 'The profile modules are active and raised no new module errors',
  sizes: ['smoke', 'full'],
  tags: ['bridge', 'module'],
  needs: [],
  tools: ['get-modules', 'get-module-errors'],
  order: 200, // last, so it sees what the other scenarios stirred up
  timeoutMs: 60000,

  async run(t) {
    await t.step('the Strahd modules are active (modules-all profile)', async () => {
      if (t.kit.profile !== 'modules-all') return `skipped on profile ${t.kit.profile}`;
      const result = await t.tool('get-modules', {});
      const byId = new Map(listOf(result, 'modules').map(m => [m.id, m]));
      const wanted = readJson('strahd-modules.json').modules.map(m => m.id);
      const missing = wanted.filter(id => !byId.has(id));
      const inactive = wanted.filter(id => byId.has(id) && !byId.get(id).active);
      t.check(!missing.length, `Strahd modules not installed: ${missing.join(', ')}`, missing);
      t.check(!inactive.length, `Strahd modules not active: ${inactive.join(', ')}`, inactive);
      return `${wanted.length - missing.length - inactive.length} of ${wanted.length} active`;
    });

    await t.step('no module error that is not a known upstream finding', async () => {
      const found = errorFindings(await t.tool('get-module-errors', {}));
      const { known, fresh, unseen } = splitFindings(found, readJson('expected.json').expected);
      t.check(
        !fresh.length,
        `new module errors: ${fresh.map(f => `${f.module}: ${f.text}`).join(' | ')}`,
        fresh
      );
      return `${found.length} seen, ${known.length} known, ${unseen.length} expected entries unseen`;
    });
  },
};
