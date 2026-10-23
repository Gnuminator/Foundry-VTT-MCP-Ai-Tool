// A screen recorder for the demo takes that uses ffmpeg (ddagrab + NVENC) instead of OBS.
// OBS 32.2.2 froze on window captures on 2026-10-18; ffmpeg ddagrab of the top-left corner of
// the primary monitor worked. It has the same few methods the take needs from ObsClient, so
// `demo:take --recorder ffmpeg` swaps one for the other.
//
// The take windows are fullscreen with the page in the top-left corner at css * scale pixels
// (browser.mjs), so recording the top-left width x height of the monitor shows exactly the page.
// The window on air is the one in front: Take.scene() calls setScene, which raises the scene's
// window by its pinned title (Playwright's bringToFront does not raise the OS window).

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SCENES } from './scenes.mjs';

/** The ffmpeg arguments for one recording. Exported for tests. */
export function ffmpegArgs({ width, height, outputIdx = 0, file, grab = 'ddagrab' }) {
  // gdigrab is the fallback for a night when ddagrab opens the output and then never delivers a
  // frame (2026-10-24); set FOUNDRY_DEMO_GRAB=gdigrab.
  const input =
    grab === 'gdigrab'
      ? [
          '-f',
          'gdigrab',
          '-framerate',
          '60',
          '-offset_x',
          '0',
          '-offset_y',
          '0',
          '-video_size',
          `${width}x${height}`,
          '-i',
          'desktop',
        ]
      : [
          '-f',
          'lavfi',
          '-i',
          `ddagrab=output_idx=${outputIdx}:framerate=60:offset_x=0:offset_y=0:video_size=${width}x${height}`,
        ];
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    ...input,
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

  /**
   * Put the scene's window in front of the others. OBS shows one window per scene; a screen
   * recording shows whatever is on top, and Playwright's bringToFront does not raise the
   * operating system window. Finds the window by its pinned title (scenes.mjs).
   */
  async setScene(sceneName) {
    const title = SCENES[sceneName];
    if (!title) return;
    const ps = [
      'Add-Type -Name W -Namespace U -MemberDefinition \'[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h,int c); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h); [DllImport("user32.dll")] public static extern void keybd_event(byte k,byte s,int f,int e); [DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h);\'',
      `$p = Get-Process msedge -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq '${title}' } | Select-Object -First 1`,
      'if (-not $p) { exit 3 }',
      // A tap on Alt lets SetForegroundWindow through the foreground lock.
      '[U.W]::keybd_event(0x12,0,0,0); [U.W]::keybd_event(0x12,0,2,0)',
      'if ([U.W]::IsIconic($p.MainWindowHandle)) { [U.W]::ShowWindow($p.MainWindowHandle, 9) | Out-Null }',
      '[U.W]::SetForegroundWindow($p.MainWindowHandle) | Out-Null',
    ].join('; ');
    const r = spawnSync('pwsh', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
    if (r.status === 3)
      console.warn(`ffmpeg recorder: no window titled "${title}" to bring forward.`);
    else if (r.status !== 0)
      console.warn(`ffmpeg recorder: could not raise "${title}": ${r.stderr}`);
    // Let the window repaint before the take goes on.
    await new Promise(r => setTimeout(r, 400));
  }

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
        grab: process.env.FOUNDRY_DEMO_GRAB === 'gdigrab' ? 'gdigrab' : 'ddagrab',
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
