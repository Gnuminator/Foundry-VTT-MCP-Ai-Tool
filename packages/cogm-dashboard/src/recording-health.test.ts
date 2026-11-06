import { describe, expect, it } from 'vitest';

import {
  playLogDot,
  readRecordingHealth,
  recorderDot,
  type PumpSnapshot,
} from './recording-health.js';

const NOW = Date.parse('2026-11-06T21:00:00.000Z');
const OK: PumpSnapshot = {
  pump: 'play',
  lastSuccessAt: '2026-11-06T20:59:50.000Z',
  lastError: null,
  lostCount: 0,
  gapCount: 0,
  lastGap: null,
  notRecordingSince: null,
};

describe('playLogDot', () => {
  it('is hidden when all is well, with no pumps, and before the first read', () => {
    expect(playLogDot([OK], NOW)).toBeNull();
    expect(playLogDot([], NOW)).toBeNull();
    expect(playLogDot([{ ...OK, lastSuccessAt: null }], NOW)).toBeNull();
  });

  it('is red when a pump is not recording, with the time', () => {
    const dot = playLogDot([{ ...OK, notRecordingSince: '2026-11-06T20:41:00.000Z' }], NOW);
    expect(dot?.tone).toBe('bad');
    expect(dot?.text).toBe('not recording');
    expect(dot?.detail).toContain('play log has not been recording since');
  });

  it('is amber for a recent gap with the losses, and clears when the gap is old', () => {
    const gap = { reason: 'ring-wrap', at: '2026-11-06T20:30:00.000Z', fromMs: 1, toMs: 2 };
    const dot = playLogDot([{ ...OK, gapCount: 1, lostCount: 3, lastGap: gap }], NOW);
    expect(dot?.tone).toBe('warn');
    expect(dot?.detail).toContain('3 lost');
    const old = { ...gap, at: '2026-11-06T10:00:00.000Z' };
    expect(playLogDot([{ ...OK, gapCount: 1, lastGap: old }], NOW)).toBeNull();
  });

  it('is amber for a pump error and unknown (never ok) when the bridge cannot be asked', () => {
    const err = { message: 'disk full', at: '2026-11-06T20:58:00.000Z' };
    expect(playLogDot([{ ...OK, lastError: err }], NOW)?.tone).toBe('warn');
    expect(playLogDot(null, NOW)).toMatchObject({ tone: 'unknown', text: 'unknown' });
  });
});

describe('recorderDot', () => {
  it('is hidden while no recording runs, and when a running one is fine', () => {
    expect(recorderDot({ recording: false, problems: [] })).toBeNull();
    expect(recorderDot({ recording: true, problems: [] })).toBeNull();
    expect(
      recorderDot({ recording: false, problems: [{ kind: 'silent', text: 'old' }] })
    ).toBeNull();
  });

  it('is amber for a silent speaker or stream error, red when it cannot rejoin', () => {
    const silent = recorderDot({
      recording: true,
      problems: [{ kind: 'silent', text: 'Mara has not been recorded for 7 min' }],
    });
    expect(silent).toMatchObject({ tone: 'warn', text: 'Mara has not been recorded for 7 min' });
    const rejoin = recorderDot({
      recording: true,
      problems: [
        { kind: 'silent', text: 'Mara has not been recorded for 7 min' },
        { kind: 'rejoin', text: 'the bot cannot get back (attempt 4)' },
      ],
    });
    expect(rejoin?.tone).toBe('bad');
    expect(rejoin?.text).toContain('+1 more');
    expect(rejoin?.detail).toContain('attempt 4');
  });

  it('is unknown when the bot does not answer', () => {
    expect(recorderDot(null)).toMatchObject({ tone: 'unknown' });
  });
});

describe('readRecordingHealth', () => {
  const pumps = (): Promise<PumpSnapshot[] | null> => Promise.resolve([OK]);
  const reply = (body: unknown, ok = true): typeof fetch =>
    (() => Promise.resolve({ ok, json: () => Promise.resolve(body) })) as unknown as typeof fetch;

  it('shows no Recorder dot without a bot URL', async () => {
    const r = await readRecordingHealth({ botStatusUrl: '', readPumps: pumps, now: () => NOW });
    expect(r).toEqual({ recorder: null, playLog: null });
  });

  it('reads the bot, and treats a refused connection, an error status or junk as unknown', async () => {
    const run = (fetchImpl: typeof fetch): ReturnType<typeof readRecordingHealth> =>
      readRecordingHealth({ botStatusUrl: 'http://bot/status', readPumps: pumps, fetchImpl });
    const good = await run(
      reply({
        recording: true,
        problems: [{ kind: 'stream', text: 'the audio stream for Mara failed' }],
      })
    );
    expect(good.recorder?.tone).toBe('warn');
    const refused = await run(() => Promise.reject(new Error('ECONNREFUSED')));
    expect(refused.recorder?.tone).toBe('unknown');
    expect((await run(reply({}, false))).recorder?.tone).toBe('unknown');
    expect((await run(reply({ nope: 1 }))).recorder?.tone).toBe('unknown');
    // A reply whose problems are not the agreed shape is unknown, not a thrown error.
    expect((await run(reply({ recording: true, problems: [null] }))).recorder?.tone).toBe(
      'unknown'
    );
    expect(
      (await run(reply({ recording: true, problems: [{ kind: 'x', text: 1 }] }))).recorder?.tone
    ).toBe('unknown');
  });

  it('shows the Play log as unknown when the pumps cannot be read', async () => {
    const r = await readRecordingHealth({
      botStatusUrl: '',
      readPumps: () => Promise.reject(new Error('bridge away')),
    });
    expect(r.playLog?.tone).toBe('unknown');
  });
});
