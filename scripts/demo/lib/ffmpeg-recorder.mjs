// A screen recorder for the demo takes that uses ffmpeg (ddagrab + NVENC) instead of OBS.
// OBS 32.2.2 froze on window captures on 2026-10-18; ffmpeg ddagrab of the top-left corner of
// the primary monitor worked. It has the same few methods the take needs from ObsClient, so
// `demo:take --recorder ffmpeg` swaps one for the other.
//
// The take windows are fullscreen with the page in the top-left corner at css * scale pixels
// (browser.mjs), so recording the top-left width x height of the monitor shows exactly the page.
// The window on air is the one in front: Take.scene() already calls page.bringToFront(), so
// setScene has nothing to do here.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The ffmpeg arguments for one recording. Exported for tests. */
export function ffmpegArgs({ width, height, outputIdx = 0, file }) {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `ddagrab=output_idx=${outputIdx}:framerate=60:offset_x=0:offset_y=0:video_size=${width}x${height}`,
    '-c:v',
    'h264_nvenc',
    '-preset',
    'p5',
    '-cq',
    '19',
    '-r',
    '60',
    // MPEG-TS survives a killed ffmpeg; it is remuxed to MP4 once the recording stops.
    '-f',
    'mpegts',
    '-flush_packets',
    '1',
    file,
  ];
}

export class FfmpegRecorder {
  /** @param {{width: number, height: number, outputIdx?: number}} o */
  constructor({ width, height, outputIdx = 0 }) {
    this.width = width;
    this.height = height;
    this.outputIdx = outputIdx;
    /** Tells Take not to crop an OBS source. */
    this.noCrop = true;
    this.child = null;
    this.ts = null;
  }

  async setScene() {}

  async startRecord(directory) {
    mkdirSync(directory, { recursive: true });
    this.ts = join(directory, 'recording.ts');
    this.child = spawn(
      'ffmpeg',
      ffmpegArgs({
        width: this.width,
        height: this.height,
        outputIdx: this.outputIdx,
        file: this.ts,
      }),
      { stdio: ['pipe', 'ignore', 'inherit'], windowsHide: true }
    );
    // A missing ffmpeg is an 'error' event; a dead ffmpeg closes stdin with EPIPE.
    this.spawnError = null;
    this.child.once('error', err => (this.spawnError = err));
    this.child.stdin.on('error', () => {});
    this.exited = new Promise(resolve => this.child.once('close', resolve));
    // Wait for the first frames to land in the file, so the recording starts when the take's
    // clock does (a fixed sleep would put every step about a second and a half early). ddagrab
    // fails at once when NVENC or the monitor is not there.
    for (let i = 0; i < 50; i++) {
      if (this.spawnError) throw new Error(`ffmpeg could not start: ${this.spawnError.message}`);
      if (this.child.exitCode !== null) break;
      if (existsSync(this.ts) && statSync(this.ts).size > 0) return;
      await new Promise(r => setTimeout(r, 100));
    }
    this.close();
    throw new Error(
      'ffmpeg ddagrab recording did not start (needs ffmpeg with NVENC on PATH and a primary monitor at least as large as the output).'
    );
  }

  /** Stop recording; resolves with the finished MP4's path. */
  async stopRecord() {
    // "q" on stdin lets ffmpeg finish the file cleanly.
    try {
      this.child.stdin.write('q');
      this.child.stdin.end();
    } catch {
      /* already gone */
    }
    let timer;
    await Promise.race([this.exited, new Promise(r => (timer = setTimeout(r, 10000)))]);
    clearTimeout(timer);
    if (this.child.exitCode === null) this.child.kill();
    const mp4 = this.ts.replace(/\.ts$/, '.mp4');
    const r = spawnSync(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-y', '-i', this.ts, '-c', 'copy', mp4],
      {
        encoding: 'utf8',
      }
    );
    // Keep the raw file when the remux fails; the take still gets its steps.json.
    if (r.status !== 0)
      throw new Error(`ffmpeg remux failed (raw file kept at ${this.ts}): ${r.stderr || r.error}`);
    rmSync(this.ts, { force: true });
    return mp4;
  }

  close() {
    if (this.child && this.child.exitCode === null) this.child.kill();
  }
}
