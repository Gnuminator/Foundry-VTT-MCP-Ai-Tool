#!/usr/bin/env node
/**
 * `discord-bot run` starts the bot; `discord-bot convert <session folder>` converts (again) a
 * recording's `raw/` folder, for example after a crash or with a newer converter.
 */

import { RecorderBot } from './bot.js';
import { loadConfig } from './config.js';
import { convertSession } from './convert/convert.js';
import * as log from './log.js';

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
  log.info('Usage: discord-bot run | discord-bot convert <session folder>');
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
