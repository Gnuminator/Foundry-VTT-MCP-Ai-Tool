// @ts-check
/**
 * @param {string[]} argv
 * @returns {{ pr: number | null, dryRun: boolean, noChangelog: string | null, vault: string | null,
 *   trainReset: string | null, train: boolean, state: string | null, waitCi: boolean,
 *   error: string | null }}
 */
export function parseArgs(argv) {
  const out = {
    pr: /** @type {number | null} */ (null),
    dryRun: false,
    noChangelog: /** @type {string | null} */ (null),
    vault: /** @type {string | null} */ (null),
    trainReset: /** @type {string | null} */ (null),
    train: false,
    state: /** @type {string | null} */ (null),
    waitCi: false,
    error: /** @type {string | null} */ (null),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (v === undefined || v === '' || v.startsWith('--')) return null;
      i++;
      return v;
    };
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--train') out.train = true;
    else if (a === '--wait-ci') out.waitCi = true;
    else if (
      a === '--no-changelog' ||
      a === '--vault' ||
      a === '--train-reset' ||
      a === '--state'
    ) {
      const v = value();
      if (v === null) {
        out.error = `${a} needs a value`;
        return out;
      }
      if (a === '--no-changelog') out.noChangelog = v;
      else if (a === '--vault') out.vault = v;
      else if (a === '--state') out.state = v;
      else out.trainReset = v;
    } else if (/^\d+$/.test(a) && out.pr === null) out.pr = Number(a);
    else {
      out.error = `unexpected argument ${a}`;
      return out;
    }
  }
  if (!out.error && out.pr === null && !out.train && out.trainReset === null) {
    out.error =
      'usage: npm run lane:merge -- <PR> [--dry-run] [--wait-ci] [--no-changelog "reason"] [--vault DIR]';
  }
  if (!out.error && out.waitCi && out.pr === null) out.error = '--wait-ci needs a PR number';
  return out;
}
