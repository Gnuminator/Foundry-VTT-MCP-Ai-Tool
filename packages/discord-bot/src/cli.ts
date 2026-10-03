#!/usr/bin/env node
/**
 * `discord-bot run` starts the bot; `discord-bot convert <session folder>` converts (again) a
 * recording's `raw/` folder, for example after a crash or with a newer converter.
 * `discord-bot rehearse <folder>` tests the recorder with speaker bots (see `rehearse/rehearse.ts`).
 */

import { RecorderBot } from './bot.js';
import { loadConfig, loadRehearsalConfig } from './config.js';
import { convertSession } from './convert/convert.js';
import * as log from './log.js';
import { rehearse } from './rehearse/rehearse.js';

async function main(argv: string[]): Promise<number> {
  const [cmd, arg] = argv;
  if (cmd === 'convert' && arg) {
    const result = convertSession(arg);
    for (const t of result.tracks) {
      const s = t.stats;
      log.info(
        `${t.file}: ${t.seconds} s, ${s.packets} packets, ${s.silenceFrames} silence frames, ` +
          `${s.reanchors} re-anchors, ${s.droppedDave} undecrypted, ${s.duplicates} duplicates, ` +
          `max late ${Math.round(s.maxLateSamples / 48)} ms${
            t.truncatedBytes ? `, ${t.truncatedBytes} bytes cut off at the end` : ''
          }`
      );
    }
    log.info(result.speakersWritten ? 'Wrote speakers.json.' : 'Kept the existing speakers.json.');
    return 0;
  }
  if (cmd === 'run') {
    const bot = new RecorderBot(loadConfig());
    let closing = false;
    const close = (): void => {
      if (closing) return;
      closing = true;
      log.info('Stopping...');
      bot.shutdown().then(
        () => process.exit(0),
        (err: unknown) => {
          log.error('Shutdown failed', err);
          process.exit(1);
        }
      );
    };
    process.on('SIGINT', close);
    process.on('SIGTERM', close);
    await bot.run();
    return -1; // keep running
  }
  if (cmd === 'rehearse' && arg) {
    const flag = (name: string): string | undefined => {
      const i = argv.indexOf(name);
      return i > 0 ? argv[i + 1] : undefined;
    };
    const num = (name: string): number | undefined => {
      const v = flag(name);
      return v === undefined ? undefined : Number(v);
    };
    const report = await rehearse(loadConfig(), loadRehearsalConfig(), {
      sourceDir: arg,
      seconds: num('--seconds') ?? 0,
      dropAtS: argv.includes('--no-drop') ? -1 : num('--drop-at'),
      settleS: num('--settle') ?? 5,
    });
    log.info(`\nRehearsal: ${report.verdict.toUpperCase()} (${report.folder})`);
    log.info(
      `Played ${report.playedSeconds} s; recorder away ${report.awaySeconds ?? '-'} s; tracks ` +
        `${report.interTrackSpreadMs ?? '-'} ms apart.`
    );
    for (const r of report.speakers) {
      const a = r.alignment;
      log.info(
        `  ${r.speaker} (${r.bot}): sent ${r.sentFrames}, recorded ${r.recordedPackets}, ` +
          `${r.framesSentWhileAway} while away, loss ${r.lossOutsideGapPct} %; ${
            a
              ? `offset ${a.medianMs} ms, wander p95 ${a.p95SpreadMs} ms (${a.windows} windows)`
              : 'not lined up'
          }`
      );
    }
    for (const reason of report.reasons) log.info(`  check: ${reason}`);
    return report.verdict === 'pass' ? 0 : 2;
  }
  log.info(
    'Usage: discord-bot run | convert <session folder> | rehearse <folder of tracks> ' +
      '[--seconds N] [--drop-at S | --no-drop] [--settle S]'
  );
  return cmd ? 1 : 0;
}

main(process.argv.slice(2)).then(
  code => {
    if (code >= 0) process.exitCode = code;
  },
  (err: unknown) => {
    log.error('discord-bot', err);
    process.exitCode = 1;
  }
);
