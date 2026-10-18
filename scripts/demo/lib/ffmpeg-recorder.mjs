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
import { mkdirSync, rmSync } from 'node:fs';
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
      ffmpegArgs({ width: this.width, height: this.height, outputIdx: this.outputIdx, file: this.ts }),
      { stdio: ['pipe', 'ignore', 'inherit'], windowsHide: true }
    );
    this.exited = new Promise(resolve => this.child.once('exit', resolve));
    // ddagrab fails at once when NVENC or the monitor is not there.
    await new Promise(r => setTimeout(r, 1500));
    if (this.child.exitCode !== null) throw new Error('ffmpeg ddagrab recording did not start.');
  }

  /** Stop recording; resolves with the finished MP4's path. */
  async stopRecord() {
    // "q" on stdin lets ffmpeg finish the file cleanly.
    this.child.stdin.write('q');
    this.child.stdin.end();
    await Promise.race([this.exited, new Promise(r => setTimeout(r, 10000))]);
    if (this.child.exitCode === null) this.child.kill();
    const mp4 = this.ts.replace(/\.ts$/, '.mp4');
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', this.ts, '-c', 'copy', mp4]);
    if (r.status !== 0) throw new Error(`ffmpeg remux failed: ${String(r.stderr)}`);
    rmSync(this.ts, { force: true });
    return mp4;
  }

  close() {
    if (this.child && this.child.exitCode === null) this.child.kill();
  }
}
