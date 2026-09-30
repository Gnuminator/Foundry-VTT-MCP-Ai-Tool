import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createHandler } from '../src/handler.js';

const baseEnv = { LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's', RECORDER_TIMEZONE: 'UTC' };

function setup(envExtra = {}, egressImpl) {
  const config = { ...loadConfig({ ...baseEnv, ...envExtra }), startRetries: 3 };
  const files = new Map();
  const dirs = [];
  const fs = {
    mkdir: vi.fn(async (p) => void dirs.push(p)),
    chmod: vi.fn(async () => {}),
    appendFile: vi.fn(async (p, text) => void files.set(p, (files.get(p) ?? '') + text)),
    writeFile: vi.fn(async (p, text) => void files.set(p, text)),
  };
  const egress = {
    startTrackEgress: vi.fn(
      egressImpl ?? (async (room, output, sid) => ({ egressId: `EG_${sid}`, status: 0, startedAt: 123n })),
    ),
  };
  const handler = createHandler({
    config,
    egress,
    fs,
    labels: { id1: 'Player One' },
    now: () => new Date('2026-11-06T18:05:30Z'),
    sleep: async () => {},
    log: { error() {}, warn() {}, info() {} },
  });
  const lines = (file) =>
    (files.get(file) ?? '')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  return { handler, egress, fs, files, dirs, lines };
}

const audioEvent = (sid = 'TR_A1', identity = 'id1') => ({
  event: 'track_published',
  createdAt: 1762452330,
  room: { name: 'strahd' },
  participant: { identity, name: 'Display One' },
  track: { sid, type: 0, source: 2, mimeType: 'audio/opus' },
});
const videoEvent = (sid = 'TR_V1', source = 1) => ({
  ...audioEvent(sid),
  track: { sid, type: 1, source, mimeType: 'video/VP8' },
});

const journal = '/out/strahd/2026-11-06_1805/session.jsonl';

describe('track_published', () => {
  it('starts a track egress into the session folder and logs it', async () => {
    const { handler, egress, dirs, lines } = setup();
    const result = await handler.handleEvent(audioEvent());
    expect(result.action).toBe('started');
    expect(egress.startTrackEgress).toHaveBeenCalledWith(
      'strahd',
      { filepath: '/out/strahd/2026-11-06_1805/id1__microphone__TR_A1.ogg' },
      'TR_A1',
    );
    expect(dirs).toContain('/out/strahd/2026-11-06_1805');
    const entries = lines(journal);
    expect(entries.map((e) => e.type)).toEqual(['session_started', 'egress_started']);
    expect(entries[1]).toMatchObject({
      label: 'Player One',
      egressId: 'EG_TR_A1',
      egressStartedAtNs: '123',
      file: 'id1__microphone__TR_A1.ogg',
      serverTime: '2026-11-06T18:05:30.000Z',
    });
  });

  it('ignores a duplicate webhook for the same track', async () => {
    const { handler, egress } = setup();
    await handler.handleEvent(audioEvent());
    const again = await handler.handleEvent(audioEvent());
    expect(again.action).toBe('duplicate');
    expect(egress.startTrackEgress).toHaveBeenCalledTimes(1);
  });

  it('skips camera video by default and records it when enabled', async () => {
    const off = setup();
    expect((await off.handler.handleEvent(videoEvent())).action).toBe('skipped');
    expect(off.egress.startTrackEgress).not.toHaveBeenCalled();
    expect(off.lines(journal).at(-1).type).toBe('track_skipped');

    const on = setup({ RECORD_VIDEO: 'true' });
    expect((await on.handler.handleEvent(videoEvent())).action).toBe('started');
    expect(on.egress.startTrackEgress.mock.calls[0][1].filepath).toMatch(/__camera__TR_V1\.webm$/);
  });

  it('skips screen share unless enabled', async () => {
    const off = setup({ RECORD_VIDEO: 'true' });
    expect((await off.handler.handleEvent(videoEvent('TR_S1', 3))).action).toBe('skipped');
    const on = setup({ RECORD_SCREEN_SHARE: '1' });
    expect((await on.handler.handleEvent(videoEvent('TR_S1', 3))).action).toBe('started');
  });

  it('retries a failing start and then logs egress_failed', async () => {
    const { handler, egress, lines } = setup({}, async () => {
      throw new Error('no egress available');
    });
    const result = await handler.handleEvent(audioEvent());
    expect(result.action).toBe('failed');
    expect(egress.startTrackEgress).toHaveBeenCalledTimes(3);
    expect(lines(journal).at(-1)).toMatchObject({
      type: 'egress_failed',
      error: 'no egress available',
    });
  });

  it('succeeds on a retry', async () => {
    let calls = 0;
    const { handler, egress } = setup({}, async (room, output, sid) => {
      calls += 1;
      if (calls < 2) throw new Error('not ready');
      return { egressId: `EG_${sid}` };
    });
    expect((await handler.handleEvent(audioEvent())).action).toBe('started');
    expect(egress.startTrackEgress).toHaveBeenCalledTimes(2);
  });

  it('ignores events missing the track, participant or room', async () => {
    const { handler, egress } = setup();
    expect((await handler.handleEvent({ event: 'track_published', room: { name: 'r' } })).action).toBe(
      'ignored',
    );
    expect(egress.startTrackEgress).not.toHaveBeenCalled();
  });

  it('keeps several participants in one folder', async () => {
    const { handler, egress } = setup();
    await handler.handleEvent(audioEvent('TR_A1', 'id1'));
    await handler.handleEvent(audioEvent('TR_A2', 'id2'));
    const paths = egress.startTrackEgress.mock.calls.map((c) => c[1].filepath);
    expect(new Set(paths.map((p) => p.split('/').slice(0, -1).join('/'))).size).toBe(1);
  });
});

describe('room_finished', () => {
  it('writes done.json and starts a new folder afterwards', async () => {
    const { handler, files, lines } = setup();
    await handler.handleEvent(audioEvent());
    const result = await handler.handleEvent({ event: 'room_finished', room: { name: 'strahd' } });
    expect(result.action).toBe('done');
    const done = JSON.parse(files.get('/out/strahd/2026-11-06_1805/done.json'));
    expect(done.room).toBe('strahd');
    expect(done.participants.id1.label).toBe('Player One');
    expect(done.tracks).toHaveLength(1);
    expect(lines(journal).at(-1).type).toBe('room_finished');
    expect(handler.sessions.size).toBe(0);
  });

  it('ignores a finished room that was never recorded', async () => {
    const { handler, fs } = setup();
    expect((await handler.handleEvent({ event: 'room_finished', room: { name: 'x' } })).action).toBe(
      'ignored',
    );
    expect(fs.writeFile).not.toHaveBeenCalled();
  });
});

describe('egress_ended', () => {
  it('logs file results and the error of a failed egress', async () => {
    const { handler, fs, lines } = setup();
    await handler.handleEvent(audioEvent());
    expect(fs.chmod).toHaveBeenCalledWith('/out/strahd/2026-11-06_1805', 0o777);
    expect(fs.chmod).toHaveBeenCalledWith('/out/strahd', 0o777);
    const ok = await handler.handleEvent({
      event: 'egress_ended',
      egressInfo: {
        egressId: 'EG_TR_A1',
        roomName: 'strahd',
        status: 3,
        fileResults: [{ filename: 'a.ogg', size: 1000n, duration: 20000000000n }],
      },
    });
    expect(ok.action).toBe('egress_ended');
    const bad = await handler.handleEvent({
      event: 'egress_ended',
      egressInfo: { egressId: 'EG_X', roomName: 'strahd', status: 4, error: 'permission denied' },
    });
    expect(bad.action).toBe('egress_error');
    const entries = lines(journal).filter((e) => e.type === 'egress_ended');
    expect(entries[0].files[0]).toMatchObject({ size: 1000, durationNs: '20000000000' });
    expect(entries[1].error).toBe('permission denied');
  });
});

describe('other events', () => {
  it('logs joins and leaves for alignment, ignores unknown events', async () => {
    const { handler, lines } = setup();
    await handler.handleEvent({
      event: 'participant_joined',
      room: { name: 'strahd' },
      participant: { identity: 'id1' },
    });
    await handler.handleEvent({
      event: 'participant_joined',
      room: { name: 'strahd' },
      participant: { identity: 'EG_abc' },
    });
    await handler.handleEvent({ event: 'egress_updated', room: { name: 'strahd' } });
    const entries = lines(journal);
    expect(entries.map((e) => e.type)).toEqual(['session_started', 'participant_joined']);
  });
});

describe('loadConfig', () => {
  it('requires the key and secret', () => {
    expect(() => loadConfig({})).toThrow(/LIVEKIT_API_KEY/);
  });
  it('has audio on and video off by default', () => {
    const c = loadConfig(baseEnv);
    expect(c).toMatchObject({ recordAudio: true, recordVideo: false, recordScreenShare: false });
  });
});
