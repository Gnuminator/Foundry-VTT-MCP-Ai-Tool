/**
 * A recording nobody has copied off the Pi: a converted session (`raw/convert-report.json`) with no
 * `.pulled` marker (tools/session-notes/pull.ps1 writes it) 24 hours after the conversion gets one
 * DM to the owner from the bot's 15 minute check, then a reminder every 24 hours until it is pulled.
 *
 * `UnpulledNotifier` has no Discord in it (tests pass a fake `send`). Its state lives in memory, so a
 * bot restart can repeat one DM; a DM that fails records nothing, so the next check tries again.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { bi } from './i18n.js';

const UNPULLED_AFTER_MS = 24 * 60 * 60 * 1000;
const UNPULLED_REMINDER_MS = 24 * 60 * 60 * 1000;

export interface UnpulledSession {
  name: string;
  /** Epoch ms of the conversion (the report file's modified time). */
  convertedAtMs: number;
}

/** Converted session folders under `sessionsDir` with no `.pulled` marker. */
export function findUnpulled(sessionsDir: string): UnpulledSession[] {
  if (!existsSync(sessionsDir)) return [];
  const found: UnpulledSession[] = [];
  for (const name of readdirSync(sessionsDir).sort()) {
    const dir = join(sessionsDir, name);
    try {
      if (!statSync(dir).isDirectory()) continue;
      const report = join(dir, 'raw', 'convert-report.json');
      if (!existsSync(report) || existsSync(join(dir, '.pulled'))) continue;
      found.push({ name, convertedAtMs: statSync(report).mtimeMs });
    } catch {
      // unreadable folder: leave it alone
    }
  }
  return found;
}

function unpulledMessage(sessions: UnpulledSession[], now: number, reminder: boolean): string {
  const hours = (s: UnpulledSession): number =>
    Math.max(0, Math.floor((now - s.convertedAtMs) / 3_600_000));
  const list = (da: boolean): string =>
    sessions.map(s => `- ${s.name} (${hours(s)} ${da ? 'timer' : 'hours'})`).join('\n');
  const tag = (da: boolean): string => (reminder ? (da ? ' (påmindelse)' : ' (reminder)') : '');
  return bi(
    `Der ligger optagelser på Pi'en, som ikke er hentet til PC'en endnu${tag(true)}:\n${list(true)}\n` +
      "Kør session-notes pull på PC'en (tools/session-notes/pull.ps1), så de bliver kopieret.",
    `Recordings on the Pi have not been pulled to the PC yet${tag(false)}:\n${list(false)}\n` +
      'Run session-notes pull on the PC (tools/session-notes/pull.ps1) to copy them.'
  );
}

interface UnpulledNotifierOptions {
  /** Send one DM; resolves true when it was delivered. */
  send: (text: string) => Promise<boolean>;
  now?: () => number;
  afterMs?: number;
  reminderMs?: number;
}

export class UnpulledNotifier {
  private readonly lastNoticeAt = new Map<string, number>();
  private readonly now: () => number;
  private readonly afterMs: number;
  private readonly reminderMs: number;

  constructor(private readonly options: UnpulledNotifierOptions) {
    this.now = options.now ?? Date.now;
    this.afterMs = options.afterMs ?? UNPULLED_AFTER_MS;
    this.reminderMs = options.reminderMs ?? UNPULLED_REMINDER_MS;
  }

  /** Look at the unpulled sessions and send one DM listing those that are due. Returns what it sent. */
  async check(sessions: UnpulledSession[]): Promise<'notice' | 'reminder' | null> {
    const now = this.now();
    const present = new Set(sessions.map(s => s.name));
    for (const name of [...this.lastNoticeAt.keys()]) {
      if (!present.has(name)) this.lastNoticeAt.delete(name); // pulled (or gone): forget it
    }
    const due = sessions.filter(s => {
      if (now - s.convertedAtMs < this.afterMs) return false;
      const last = this.lastNoticeAt.get(s.name);
      return last === undefined || now - last >= this.reminderMs;
    });
    if (due.length === 0) return null;
    const reminder = due.some(s => this.lastNoticeAt.has(s.name));
    if (!(await this.options.send(unpulledMessage(due, now, reminder)))) return null;
    for (const s of due) this.lastNoticeAt.set(s.name, now);
    return reminder ? 'reminder' : 'notice';
  }
}
