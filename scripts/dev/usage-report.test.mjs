// Tests for scripts/dev/usage-report.py: an advisor response's context is its last executor pass
// (not the two passes summed) and its cost includes the advisor's own pass. Runs the script on a
// synthetic transcript tree in a temporary home folder; skipped when no Python is installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'usage-report.py');
const python = process.platform === 'win32' ? 'python' : 'python3';
const hasPython = spawnSync(python, ['--version']).status === 0;

function line(id, ts, usage) {
  return JSON.stringify({
    type: 'assistant',
    timestamp: ts,
    message: { id, model: 'claude-opus-test', usage },
  });
}

test(
  'advisor response: context is the last message pass, cost adds the advisor pass',
  { skip: !hasPython },
  () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'usage-report-'));
    try {
      const dir = path.join(home, '.claude', 'projects', 'C--fake-repo');
      mkdirSync(dir, { recursive: true });
      const plain = line('m1', '2026-10-20T10:00:00Z', {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 100,
      });
      // Top level sums the two executor passes: 163,467 + 164,453 = 327,920 cache read.
      const advisor = line('m2', '2026-10-20T10:01:00Z', {
        input_tokens: 4,
        output_tokens: 90,
        cache_read_input_tokens: 327920,
        cache_creation_input_tokens: 2730,
        iterations: [
          {
            type: 'message',
            input_tokens: 2,
            cache_read_input_tokens: 163467,
            cache_creation_input_tokens: 986,
          },
          {
            type: 'advisor_message',
            input_tokens: 163867,
            output_tokens: 500,
            model: 'claude-opus-test',
          },
          {
            type: 'message',
            input_tokens: 2,
            cache_read_input_tokens: 164453,
            cache_creation_input_tokens: 1744,
          },
        ],
      });
      writeFileSync(path.join(dir, 'aaaa1111.jsonl'), `${plain}\n${advisor}\n`);
      const r = spawnSync(python, ['-I', script, '2026-10-01T00:00:00'], {
        env: { ...process.env, HOME: home, USERPROFILE: home },
        encoding: 'utf8',
      });
      assert.equal(r.status, 0, r.stderr);
      // 166,199 is the last pass (2 + 164,453 + 1,744); the sum of both passes would print 330k.
      assert.match(r.stdout, /max\s+166k/);
      // Top-level cost 0.0387 plus the advisor pass (163,867 input + 500 output x 5) 0.1664.
      assert.match(r.stdout, /total 0\.2 units/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }
);
