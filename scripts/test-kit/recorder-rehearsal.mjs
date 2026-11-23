#!/usr/bin/env node
/**
 * The recorder rehearsal for the pre-gate list: a 60 second `discord-bot rehearse` with one drop of
 * the recorder's voice connection, on the built bot, and its result as one row in the vault note
 * `Dev/Foundry AI Tool/Test kit runs.md` (the same table the kit run writes).
 *
 *   npm run kit:recorder -- <folder of per-speaker tracks> [--seconds 60] [--drop-at 30] [--no-record]
 *
 * It uses the rehearsal speaker bots and REHEARSAL_CHANNEL_ID from discord-bot.env, never the
 * campaign channels. The real bot must not run at the same time. Needs ffmpeg and a built bot
 * (`npm run build -w @gnuminator/discord-bot`). Exit codes: 0 PASS, 1 the run broke, 2 CHECK.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NOTE, updateNote } from './kit-run.mjs';
import { pushPaths, vaultDirFrom } from './lib/vault-push.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..');
const CLI = path.join(REPO_ROOT, 'packages', 'discord-bot', 'dist', 'cli.js');

export function parseArgs(argv) {
  const o = { dir: '', seconds: 60, dropAt: 30, record: true, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--no-record') o.record = false;
    else if (a === '--seconds' || a === '--drop-at') {
      const n = Number(argv[(i += 1)]);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`${a} needs a positive number`);
      if (a === '--seconds') o.seconds = n;
      else o.dropAt = n;
    } else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else if (!o.dir) o.dir = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  if (!o.help && !o.dir) throw new Error('give the folder of per-speaker tracks');
  if (o.dropAt >= o.seconds) throw new Error('--drop-at must be before --seconds');
  return o;
}

const cell = s =>
  String(s ?? '')
    .replace(/\|/g, '/')
    .replace(/\s+/g, ' ')
    .trim();

function localTime(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The note row (same columns as a kit run) for a rehearsal report. */
export function rehearsalRow(report, meta) {
  const pass = report.verdict === 'pass';
  const worst = Math.max(0, ...report.speakers.map(s => s.lossOutsideGapPct ?? 0));
  const result = pass
    ? `PASS: ${report.speakers.length} tracks, played ${report.playedSeconds} s, away ${report.awaySeconds ?? '-'} s, tracks ${report.interTrackSpreadMs ?? '-'} ms apart, loss ${worst} %`
    : `CHECK: ${report.reasons.length} reason(s)`;
  return `| ${[
    localTime(meta.at),
    meta.pc,
    `recorder rehearse ${meta.seconds} s, drop at ${meta.dropAt} s (discord-bot ${meta.version})`,
    meta.git,
    result,
    pass ? '' : report.reasons.join('; '),
    report.folder ? `\`${report.folder}\`` : '',
  ]
    .map(cell)
    .join(' | ')} |`;
}

function git(args) {
  return new Promise(resolve => {
    const p = spawn('git', args, { cwd: REPO_ROOT, windowsHide: true });
    let out = '';
    p.stdout.on('data', d => (out += d));
    p.on('close', () => resolve(out.trim()));
    p.on('error', () => resolve(''));
  });
}

/** Run the CLI; resolves with its exit code and the rehearsal folder it printed. */
function runCli(o) {
  return new Promise((resolve, reject) => {
    const args = [
      CLI,
      'rehearse',
      o.dir,
      '--seconds',
      String(o.seconds),
      '--drop-at',
      String(o.dropAt),
    ];
    const p = spawn(process.execPath, args, { cwd: REPO_ROOT, windowsHide: true });
    let out = '';
    const keep = d => {
      out += d;
      process.stdout.write(d);
    };
    p.stdout.on('data', keep);
    p.stderr.on('data', keep);
    p.on('error', reject);
    p.on('close', code => resolve({ code, out }));
  });
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
    return 0;
  }
  if (!existsSync(CLI))
    throw new Error('the bot is not built: npm run build -w @gnuminator/discord-bot');
  const version = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version;
  const { code, out } = await runCli(o);
  const m = /Rehearsal: (?:PASS|CHECK) \((.+)\)/.exec(out);
  if (!m) throw new Error(`the rehearsal gave no result (exit ${code})`);
  const report = JSON.parse(readFileSync(path.join(m[1], 'rehearsal.json'), 'utf8'));
  const sha = await git(['rev-parse', '--short', 'HEAD']);
  const dirty = (await git(['status', '--porcelain', '--untracked-files=no'])) !== '';
  const row = rehearsalRow(report, {
    at: new Date(),
    pc: process.env.COMPUTERNAME || os.hostname(),
    seconds: o.seconds,
    dropAt: o.dropAt,
    version,
    git: `${sha}${dirty ? ' (dirty)' : ''}`,
  });
  console.log(`\n${row}`);
  if (o.record) {
    const dir = vaultDirFrom();
    const res = await pushPaths({
      dir,
      paths: [NOTE],
      message: `Recorder rehearsal ${report.verdict} on ${os.hostname()}`,
      write: async vault => {
        const file = path.join(vault, ...NOTE.split('/'));
        const old = existsSync(file) ? readFileSync(file, 'utf8') : '';
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, updateNote(old, row), 'utf8');
      },
    });
    console.log(`vault note: ${res.state} ${res.detail ?? ''}`);
  }
  return report.verdict === 'pass' ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(
    code => {
      process.exitCode = code;
    },
    err => {
      console.error(`kit:recorder ${err.message}`);
      process.exitCode = 1;
    }
  );
}
