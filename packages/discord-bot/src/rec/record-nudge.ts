/**
 * The record-start nudge (item record-start-nudge): the bot watches the play session flag next to
 * the recording and says so when the two disagree for too long. Pure state and wording, no
 * Discord and no timers (the bot feeds it a reading and a clock and posts what it returns).
 * - A play session open for {@link NO_RECORDING_MS} with no recording: one line, and a "norecord"
 *   problem on the health line while it stays so.
 * - A recording still running {@link OVERRUN_MS} after the session ended: one line, and an
 *   "overrun" problem while it stays so.
 * Each line is sent once per condition; the condition ending (a recording starts, the session
 * closes, the recording stops) re-arms it. A null reading (dashboard unreachable) changes nothing.
 */

import { bi } from '../i18n.js';
import type { SessionFlag } from '../session-post.js';
import { formatAge } from './health.js';

export const NO_RECORDING_MS = 5 * 60_000;
export const OVERRUN_MS = 30 * 60_000;

export interface NudgeProblem {
  kind: 'norecord' | 'overrun';
  text: string;
}

export class RecordNudge {
  /** When this run first saw the session open without a recording; null otherwise. */
  private openSince: number | null = null;
  private openReported = false;
  private overrunReported = false;
  /** The session end time (ms) seen while a recording runs. */
  private endedAtMs: number | null = null;

  /** Feed one reading; returns the lines to post now. */
  check(flag: SessionFlag | null, recording: boolean, now: number): string[] {
    if (flag === null) return [];
    const out: string[] = [];
    if (flag.open && !recording) {
      this.openSince ??= now;
      if (!this.openReported && now - this.openSince >= NO_RECORDING_MS) {
        this.openReported = true;
        out.push(
          bi(
            `Recorder: spilsessionen har været åben i ${formatAge(now - this.openSince)}, men der optages ikke. Start optagelsen med /record start.`,
            `Recorder: the play session has been open for ${formatAge(now - this.openSince)}, but nothing is being recorded. Start it with /record start.`
          )
        );
      }
    } else {
      this.openSince = null;
      this.openReported = false;
    }
    const ended = !flag.open && flag.endedAt !== null ? Date.parse(flag.endedAt) : NaN;
    if (recording && Number.isFinite(ended)) {
      if (this.endedAtMs !== ended) {
        this.endedAtMs = ended;
        this.overrunReported = false;
      }
      if (!this.overrunReported && now - ended >= OVERRUN_MS) {
        this.overrunReported = true;
        out.push(
          bi(
            `Recorder: sessionen sluttede for ${formatAge(now - ended)} siden, og optagelsen kører stadig. Stop den med /record stop, hvis den er glemt.`,
            `Recorder: the session ended ${formatAge(now - ended)} ago and the recording is still running. Stop it with /record stop if it was forgotten.`
          )
        );
      }
    } else {
      this.endedAtMs = null;
      this.overrunReported = false;
    }
    return out;
  }

  /** What is off right now, for the dashboard's health line (listed every time, not once). */
  problems(now: number, recording: boolean): NudgeProblem[] {
    const out: NudgeProblem[] = [];
    if (!recording && this.openSince !== null && now - this.openSince >= NO_RECORDING_MS) {
      out.push({
        kind: 'norecord',
        text: `the play session is open but nothing is being recorded (${formatAge(now - this.openSince)})`,
      });
    }
    if (recording && this.endedAtMs !== null && now - this.endedAtMs >= OVERRUN_MS) {
      out.push({
        kind: 'overrun',
        text: `the session ended ${formatAge(now - this.endedAtMs)} ago and the recording still runs`,
      });
    }
    return out;
  }
}
