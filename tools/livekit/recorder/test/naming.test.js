import { describe, expect, it } from 'vitest';
import {
  resolveLabel,
  safeSegment,
  sessionFolderName,
  trackExtension,
  trackFilename,
  trackKind,
  trackSource,
} from '../src/naming.js';

describe('enum helpers', () => {
  it('maps numbers and names', () => {
    expect(trackKind(0)).toBe('audio');
    expect(trackKind('VIDEO')).toBe('video');
    expect(trackKind(99)).toBe('unknown');
    expect(trackSource(2)).toBe('microphone');
    expect(trackSource('CAMERA')).toBe('camera');
    expect(trackSource(3)).toBe('screen_share');
    expect(trackSource(undefined)).toBe('unknown');
  });
});

describe('safeSegment', () => {
  it('strips path characters and keeps letters', () => {
    expect(safeSegment('../evil/name')).toBe('evil_name');
    expect(safeSegment('Sø ren:*?')).toBe('Sø_ren');
    expect(safeSegment('')).toBe('unknown');
    expect(safeSegment(undefined, 'x')).toBe('x');
  });
});

describe('trackExtension', () => {
  it('uses ogg for audio and picks a video container by codec', () => {
    expect(trackExtension('audio', 'audio/opus')).toBe('ogg');
    expect(trackExtension('audio', 'audio/red')).toBe('ogg');
    expect(trackExtension('video', 'video/VP8')).toBe('webm');
    expect(trackExtension('video', 'video/H264')).toBe('mp4');
    expect(trackExtension('video')).toBe('webm');
  });
});

describe('sessionFolderName', () => {
  const date = new Date('2026-11-06T18:05:30Z');
  it('formats yyyy-mm-dd_HHMM in a given zone', () => {
    expect(sessionFolderName(date, 'UTC')).toBe('2026-11-06_1805');
    expect(sessionFolderName(date, 'Europe/Copenhagen')).toBe('2026-11-06_1905');
  });
  it('uses 00 for midnight hour', () => {
    expect(sessionFolderName(new Date('2026-11-06T00:07:00Z'), 'UTC')).toBe('2026-11-06_0007');
  });
});

describe('trackFilename', () => {
  it('is identity__source__sid.ext', () => {
    expect(
      trackFilename({
        identity: 'abc123',
        source: 'microphone',
        trackSid: 'TR_AMx',
        kind: 'audio',
        mimeType: 'audio/opus',
      }),
    ).toBe('abc123__microphone__TR_AMx.ogg');
    expect(
      trackFilename({
        identity: 'abc123',
        source: 'camera',
        trackSid: 'TR_VCy',
        kind: 'video',
        mimeType: 'video/VP8',
      }),
    ).toBe('abc123__camera__TR_VCy.webm');
  });
});

describe('resolveLabel', () => {
  const labels = { id1: 'Player One', 'Display Two': 'Player Two' };
  it('prefers identity, then name, then falls back', () => {
    expect(resolveLabel(labels, 'id1', 'Anything')).toBe('Player One');
    expect(resolveLabel(labels, 'id2', 'Display Two')).toBe('Player Two');
    expect(resolveLabel(labels, 'id3', 'Someone')).toBe('Someone');
    expect(resolveLabel({}, 'id3', undefined)).toBe('id3');
    expect(resolveLabel(undefined, 'id3', '')).toBe('id3');
  });
});
