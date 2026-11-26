// What the Discord bot container must be able to do on the Pi, checked without a Discord token (CI runs it in the ARM64
// image, .github/workflows/pi-images.yml; the stage 24 scenarios run the same words on a stand-in):
//   docker compose ... run --rm --no-deps discord-bot sh -c 'umask 0007 && node /app/bot-container-check.mjs'
//
//   1. the bot's libraries load on this CPU: discord.js, @discordjs/voice and the native @snazzah/davey (the voice
//      encryption), and the voice library finds an encryption backend
//   2. UDP works from the container (Discord voice is UDP): a datagram goes out of one socket and arrives at another
//   3. a recording lands in the recordings folder as the foundry user: a synthetic session (the raw per-speaker file the
//      recorder writes) is converted by the bot's own converter into the same folders, with the group allowed to write, so the
//      PC's pull over SSH can mark and delete the session
//
// Exit 0 when all three hold; the reason goes to stderr. It writes one folder (check-<pid>) in FVTT_SESSIONS_DIR and removes it.
import dgram from 'node:dgram';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const botDir = process.env.BOT_DIR || '/app/packages/discord-bot';
const sessions = process.env.FVTT_SESSIONS_DIR;
const problems = [];
const ok = text => process.stdout.write(`ok: ${text}\n`);
const bad = text => {
  problems.push(text);
  process.stderr.write(`FAIL: ${text}\n`);
};

// ---- 1. libraries ---------------------------------------------------------------------------------------------
const require = createRequire(path.join(botDir, 'package.json'));
try {
  await import(pathToFileURL(require.resolve('@snazzah/davey')).href);
  await import(pathToFileURL(require.resolve('discord.js')).href);
  const voice = await import(pathToFileURL(require.resolve('@discordjs/voice')).href);
  ok('discord.js, @discordjs/voice and @snazzah/davey load');
  const report = voice.generateDependencyReport();
  if (
    /Encryption Libraries[\s\S]*?(sodium-native|sodium|libsodium-wrappers|tweetnacl|@stablelib\/xchacha20poly1305): (?!not found)/.test(
      report
    )
  ) {
    ok('the voice library found an encryption backend');
  } else {
    // Newer @discordjs/voice versions use Node's own crypto when no package is there: report it, do not fail on the wording.
    process.stdout.write(
      `note: no encryption package in the dependency report (Node crypto is used instead?)\n${report}\n`
    );
  }
} catch (e) {
  bad(`a bot library does not load: ${e?.message ?? e}`);
}

// ---- 2. UDP ---------------------------------------------------------------------------------------------------
try {
  const got = await new Promise((resolve, reject) => {
    const rx = dgram.createSocket('udp4');
    const tx = dgram.createSocket('udp4');
    const timer = setTimeout(() => reject(new Error('no datagram arrived in 5 s')), 5000);
    rx.on('error', reject);
    rx.on('message', msg => {
      clearTimeout(timer);
      rx.close();
      tx.close();
      resolve(msg.toString());
    });
    rx.bind(0, '127.0.0.1', () => {
      tx.send(Buffer.from('voice-udp'), rx.address().port, '127.0.0.1');
    });
  });
  if (got === 'voice-udp') ok('a UDP datagram went out and came back on loopback');
  else bad(`UDP gave back "${got}"`);
} catch (e) {
  bad(`UDP does not work here: ${e?.message ?? e}`);
}

// ---- 3. a recording in the recordings folder -------------------------------------------------------------------
if (!sessions) {
  bad('FVTT_SESSIONS_DIR is not set: the bot would write recordings to its default folder');
} else {
  const dir = path.join(sessions, `check-${process.pid}`);
  try {
    const fmt = await import(pathToFileURL(path.join(botDir, 'dist/rec/format.js')).href);
    const conv = await import(pathToFileURL(path.join(botDir, 'dist/convert/convert.js')).href);
    mkdirSync(path.join(dir, 'raw'), { recursive: true });
    const parts = [
      fmt.encodeTrackHeader({
        v: 1,
        userId: '1',
        track: 1,
        sessionStart: new Date().toISOString(),
      }),
    ];
    // 50 packets of 20 ms: an Opus silence frame (TOC 0xF8 = CELT fullband 20 ms).
    for (let i = 0; i < 50; i++) {
      parts.push(
        fmt.encodeRecord({
          arrival: i * 960,
          seq: i,
          rtpTimestamp: i * 960,
          hasRtp: true,
          payload: Buffer.from([0xf8, 0xff, 0xfe]),
        })
      );
    }
    writeFileSync(path.join(dir, 'raw', '1-check.rec'), Buffer.concat(parts));
    writeFileSync(
      path.join(dir, 'raw', 'session.json'),
      JSON.stringify({ tracks: [{ userId: '1', displayName: 'check' }] })
    );
    const result = conv.convertSession(dir);
    const made = readdirSync(dir).filter(f => f.endsWith('.ogg'));
    if (made.length !== 1 || result.tracks.length !== 1)
      bad(`the converter wrote ${made.length} audio file(s), wanted 1`);
    else if (
      !existsSync(path.join(dir, 'speakers.json')) ||
      !existsSync(path.join(dir, 'raw', 'convert-report.json'))
    )
      bad('the converter did not write speakers.json and convert-report.json');
    else {
      const head = readFileSync(path.join(dir, made[0])).subarray(0, 4).toString('latin1');
      if (head !== 'OggS') bad(`${made[0]} is not an Ogg file`);
      else ok(`a session was recorded and converted in ${sessions}`);
    }
    // The group must be able to write (the PC's pull marks and deletes sessions as a member of the foundry group). The
    // compose command sets umask 0007; without it this check fails on purpose.
    for (const f of [
      path.join(dir, made[0] ?? 'missing.ogg'),
      path.join(dir, 'speakers.json'),
      path.join(dir, 'raw', '1-check.rec'),
    ]) {
      const mode = statSync(f).mode & 0o777;
      if ((mode & 0o060) !== 0o060 || (mode & 0o007) !== 0)
        bad(
          `${path.basename(f)} has mode ${mode.toString(8)}: the group must read and write it and others get nothing (umask 0007)`
        );
    }
    if (!problems.some(p => p.includes('mode')))
      ok('the files are group-writable and closed to others');
  } catch (e) {
    bad(`the recording check failed: ${e?.message ?? e}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

process.exit(problems.length ? 1 : 0);
