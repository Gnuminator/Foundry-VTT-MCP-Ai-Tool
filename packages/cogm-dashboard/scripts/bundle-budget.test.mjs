// The pure parts of the bundle budget (scripts/bundle-budget.mjs): hash stripping, which files are
// the first load, and the limit check.
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LAZY_LIMIT_KB,
  FIRST_LOAD_LIMIT_KB,
  checkBudget,
  chunkStem,
  firstLoadFiles,
  formatTable,
  lazyLimitKb,
} from './bundle-budget.mjs';

describe('chunkStem', () => {
  it('drops the 8 character hash and the extension', () => {
    expect(chunkStem('index-CZFZNM0R.js')).toBe('index');
    expect(chunkStem('Tarokka-Cx9aB1zQ.js')).toBe('Tarokka');
  });

  it('keeps dashes in the name and handles dashes and underscores in the hash', () => {
    expect(chunkStem('react-vendor-AbCd1234.js')).toBe('react-vendor');
    expect(chunkStem('index-D-x_1aB2.js')).toBe('index');
  });

  it('leaves a name without a hash alone', () => {
    expect(chunkStem('main.js')).toBe('main');
  });
});

describe('lazyLimitKb', () => {
  it('uses the limit of a known stem and the default for an unknown one', () => {
    expect(lazyLimitKb('Tarokka-Cx9aB1zQ.js', { Tarokka: 12 })).toBe(12);
    expect(lazyLimitKb('Other-Cx9aB1zQ.js', { Tarokka: 12 })).toBe(DEFAULT_LAZY_LIMIT_KB);
  });

  it('does not take a limit from the object prototype', () => {
    expect(lazyLimitKb('constructor-Cx9aB1zQ.js', {})).toBe(DEFAULT_LAZY_LIMIT_KB);
  });
});

describe('firstLoadFiles', () => {
  const html = `<!doctype html><html><head>
    <link rel="stylesheet" href="/styles.css" />
    <link rel="modulepreload" crossorigin href="/next/assets/vendor-AbCd1234.js">
    <link rel="stylesheet" crossorigin href="/next/assets/index-BibpnUhL.css">
    <script src="/usage.js" data-usage-endpoint="/api/usage"></script>
    <script type="module" crossorigin src="/next/assets/index-CZFZNM0R.js"></script>
    <link rel="modulepreload" href="/next/assets/vendor-AbCd1234.js">
  </head></html>`;

  it('lists the entry script and the modulepreload links, once each', () => {
    expect(firstLoadFiles(html)).toEqual(['vendor-AbCd1234.js', 'index-CZFZNM0R.js']);
  });

  it('ignores stylesheets and scripts outside the assets folder', () => {
    expect(firstLoadFiles('<script src="/usage.js"></script>')).toEqual([]);
  });
});

describe('checkBudget', () => {
  const first = [{ file: 'index-A.js', raw: 400_000, gzip: 100_000 }];

  it('passes while the first load and each lazy chunk fit', () => {
    const lazy = [{ file: 'Tarokka-Cx9aB1zQ.js', raw: 30_000, gzip: 9_000 }];
    const result = checkBudget({ first, lazy }, { firstLoadKb: 100, lazyKb: { Tarokka: 9 } });
    expect(result.ok).toBe(true);
    expect(result.rows.map(r => r.ok)).toEqual([true, true]);
  });

  it('fails when the first load passes its limit', () => {
    const result = checkBudget({ first, lazy: [] }, { firstLoadKb: 99 });
    expect(result.ok).toBe(false);
    expect(result.rows[0].ok).toBe(false);
  });

  it('adds the files of the first load together', () => {
    const two = [
      { file: 'a.js', raw: 10, gzip: 60_000 },
      { file: 'b.js', raw: 10, gzip: 50_000 },
    ];
    expect(checkBudget({ first: two, lazy: [] }, { firstLoadKb: 100 }).ok).toBe(false);
    expect(checkBudget({ first: two, lazy: [] }, { firstLoadKb: 110 }).ok).toBe(true);
  });

  it('fails when a lazy chunk passes its limit, and a new chunk gets the default', () => {
    const big = [{ file: 'New-Cx9aB1zQ.js', raw: 1, gzip: DEFAULT_LAZY_LIMIT_KB * 1000 + 1 }];
    const result = checkBudget({ first, lazy: big }, { firstLoadKb: 100 });
    expect(result.ok).toBe(false);
    expect(result.rows[1].limitKb).toBe(DEFAULT_LAZY_LIMIT_KB);
  });

  it('uses the recorded first-load limit when none is given', () => {
    expect(checkBudget({ first, lazy: [] }).rows[0].limitKb).toBe(FIRST_LOAD_LIMIT_KB);
  });
});

describe('formatTable', () => {
  it('marks a row over its limit', () => {
    const rows = [{ name: 'first load', raw: 5000, gzip: 2000, limitKb: 1, ok: false }];
    expect(formatTable(rows)).toContain('OVER');
    expect(formatTable(rows, true)).toContain('| first load | 5.0 | 2.0 | 1 | OVER |');
  });
});
