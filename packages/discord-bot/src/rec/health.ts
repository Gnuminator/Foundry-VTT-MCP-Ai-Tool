/**
 * What the recorder knows about its own health (item recorder-heartbeat): when each speaker's last
 * packet arrived, who is in the channel, and which problems were already reported. Pure state and
 * wording, no Discord and no timers: the bot feeds it events and a clock, posts what it returns,
 * and /record status prints {@link RecorderHealth.status}.
 *
 * Nothing here reaches Discord by itself. A dead stream used to look exactly like a quiet table
 * (raw/events.jsonl was the only trace); these messages are what #gm-bot shows instead.
 */

/** A member in the channel with no packet for this long is reported once. */
export const SILENCE_MS = 5 * 60_000;
/** The same kind of problem is reported at most this often. */
export const REPEAT_ALERT_MS = 5 * 60_000;
/** Rejoin attempts from this number on are worth a message. */
export const REJOIN_ALERT_FROM = 3;

interface Member {
  name: string;
  muted: boolean;
  joinedAt: number;
  /** Time of the last packet, null before the first. */
  lastPacket: number | null;
  /** The current silence was reported; cleared by the next packet. */
  silenceReported: boolean;
}

/** "42 s", "7 min", "2 h 5 min". */
export function formatAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 === 0 ? `${h} h` : `${h} h ${m % 60} min`;
}

/** What the dashboard's health line reads (item health-line-dots): problems in plain words. */
export interface RecorderProblem {
  kind: 'silent' | 'stream' | 'rejoin';
  /** Plain words for the GM, without the "Recorder:" prefix. */
  text: string;
}

export class RecorderHealth {
  private readonly members = new Map<string, Member>();
  private readonly lastAlertAt = new Map<string, number>();
  /** Who left the channel and has not joined again (their late packets are ignored). */
  private readonly left = new Set<string>();
  /** Speakers whose audio stream failed and who have not sent a packet since. */
  private readonly streamErrors = new Map<string, string>();
  /** The failed rejoin attempt number while the bot is out of the channel, else null. */
  private rejoinAttempt: number | null = null;
  /** True after a tick with the voice connection down, until the first tick after it is back. */
  private wasDown = false;

  /** Someone is in the channel (a join, or already there when the recording started). */
  join(userId: string, name: string, muted: boolean, now: number): void {
    this.left.delete(userId);
    const known = this.members.get(userId);
    if (known) {
      known.name = name;
      known.muted = muted;
      return;
    }
    this.members.set(userId, {
      name,
      muted,
      joinedAt: now,
      lastPacket: null,
      silenceReported: false,
    });
  }

  /** Someone left the channel: no silence report for them any more (their packets stay listed). */
  leave(userId: string): void {
    this.members.delete(userId);
    this.left.add(userId);
  }

  setMuted(userId: string, muted: boolean, now: number): void {
    const m = this.members.get(userId);
    if (!m) return;
    // Unmuting starts a fresh silence window instead of an instant report.
    if (m.muted && !muted) m.joinedAt = now;
    m.muted = muted;
    // A muted speaker sends no packets, so a stream error would otherwise stay on the line.
    if (muted) this.streamErrors.delete(userId);
  }

  /** A packet arrived for this speaker. */
  packet(userId: string, name: string, now: number): void {
    let m = this.members.get(userId);
    // A late packet from someone who already left must not bring them back as a silent member.
    if (!m && this.left.has(userId)) return;
    if (!m) {
      m = { name, muted: false, joinedAt: now, lastPacket: null, silenceReported: false };
      this.members.set(userId, m);
    }
    m.lastPacket = now;
    m.silenceReported = false;
    this.streamErrors.delete(userId);
  }

  /**
   * Members in the channel, not muted, with nothing recorded for {@link SILENCE_MS}: one message
   * each, then quiet until their next packet. While the voice connection is down (`connected`
   * false) nothing is reported: the rejoin alerts already say nothing is being recorded.
   */
  silent(now: number, connected = true): string[] {
    const out: string[] = [];
    if (!connected) {
      this.wasDown = true;
      return out;
    }
    // Nobody could be recorded while the link was down: every window starts again now, so a long
    // outage does not report all members at once on the first tick after it.
    if (this.wasDown) {
      this.wasDown = false;
      for (const m of this.members.values()) m.joinedAt = now;
    }
    for (const m of this.members.values()) {
      if (m.muted || m.silenceReported) continue;
      // The later of the last packet and the window start (joining, unmuting, a reconnect).
      const since = Math.max(m.lastPacket ?? m.joinedAt, m.joinedAt);
      if (now - since < SILENCE_MS) continue;
      m.silenceReported = true;
      const what =
        m.lastPacket === null
          ? 'has not been recorded at all'
          : `has not been recorded for ${formatAge(now - m.lastPacket)}`;
      out.push(
        `Recorder: ${m.name} ${what}. If they have been speaking, their track may have stopped.`
      );
    }
    return out;
  }

  /** At most once per {@link REPEAT_ALERT_MS} for each key; returns whether to post now. */
  private due(key: string, now: number): boolean {
    const last = this.lastAlertAt.get(key);
    if (last !== undefined && now - last < REPEAT_ALERT_MS) return false;
    this.lastAlertAt.set(key, now);
    return true;
  }

  /** A per-speaker audio stream failed. */
  streamError(userId: string, name: string, message: string, now: number): string | null {
    this.streamErrors.set(userId, name);
    return this.due(`stream:${userId}`, now)
      ? `Recorder: the audio stream for ${name} had an error (${message}). It is subscribed again, but check that their track keeps growing.`
      : null;
  }

  /** The voice connection reported an error. */
  connectionError(message: string, now: number): string | null {
    return this.due('connection', now)
      ? `Recorder: the voice connection reported an error (${message}).`
      : null;
  }

  /** A rejoin failed; from attempt {@link REJOIN_ALERT_FROM} on, repeated every 5 minutes. */
  rejoinFailed(attempt: number, now: number): string | null {
    this.rejoinAttempt = attempt;
    if (attempt < REJOIN_ALERT_FROM || !this.due('rejoin', now)) return null;
    return `Recorder: still cannot rejoin the voice channel (attempt ${attempt}). Nothing is being recorded until it is back.`;
  }

  /** A successful rejoin ends the repeat window, so the next outage reports at once. */
  rejoined(): void {
    this.rejoinAttempt = null;
    this.lastAlertAt.delete('rejoin');
  }

  /**
   * What is wrong right now, for the dashboard's health line: unlike {@link silent} this lists a
   * silent speaker every time (not once), and a stream error until that speaker's next packet.
   */
  problems(now: number): RecorderProblem[] {
    const out: RecorderProblem[] = [];
    if (this.rejoinAttempt !== null && this.rejoinAttempt >= REJOIN_ALERT_FROM) {
      out.push({
        kind: 'rejoin',
        text: `the bot cannot rejoin the voice channel (attempt ${this.rejoinAttempt})`,
      });
    }
    for (const [id, name] of this.streamErrors) {
      if (this.members.has(id)) {
        out.push({ kind: 'stream', text: `the audio stream for ${name} failed` });
      }
    }
    for (const m of this.members.values()) {
      if (m.muted) continue;
      const since = m.lastPacket ?? m.joinedAt;
      if (now - since < SILENCE_MS) continue;
      out.push({
        kind: 'silent',
        text:
          m.lastPacket === null
            ? `${m.name} has not been recorded at all`
            : `${m.name} has not been recorded for ${formatAge(now - since)}`,
      });
    }
    return out;
  }

  /** Per-speaker lines for /record status: last packet age, or "nothing yet". */
  speakerLines(now: number): string[] {
    return [...this.members.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(m => {
        const age =
          m.lastPacket === null
            ? 'nothing recorded yet'
            : `last packet ${formatAge(now - m.lastPacket)} ago`;
        return `${m.name}: ${age}${m.muted ? ' (muted)' : ''}`;
      });
  }
}
