import { describe, expect, it } from 'vitest';

import { alertTarget, isMuted, statusText, voiceAction } from './bot-health.js';

describe('voiceAction', () => {
  it('sees joins, leaves and mute changes in the recorded channel only', () => {
    expect(voiceAction({ channelId: null }, { channelId: 'c' }, 'c')).toBe('join');
    expect(voiceAction({ channelId: 'x' }, { channelId: 'c' }, 'c')).toBe('join');
    expect(voiceAction({ channelId: 'c' }, { channelId: null }, 'c')).toBe('leave');
    expect(voiceAction({ channelId: 'c' }, { channelId: 'c', selfMute: true }, 'c')).toBe(
      'mute-change'
    );
    expect(voiceAction({ channelId: 'x' }, { channelId: 'y' }, 'c')).toBe('ignore');
  });
  it('counts self and server mute as muted', () => {
    expect(isMuted({ channelId: 'c', selfMute: true })).toBe(true);
    expect(isMuted({ channelId: 'c', serverMute: true })).toBe(true);
    expect(isMuted({ channelId: 'c', selfMute: false, serverMute: null })).toBe(false);
  });
});

describe('alertTarget', () => {
  it('prefers the GM channel, then the voice channel', () => {
    expect(alertTarget('g', true)).toBe('gm');
    expect(alertTarget(undefined, true)).toBe('fallback');
    expect(alertTarget(undefined, false)).toBe('none');
  });
});

describe('statusText', () => {
  it('lists the connection and each speaker', () => {
    expect(statusText('Table', 2, false, 'ready', ['Ann: last packet 3 s ago'])).toBe(
      'Optager i Table: 2 spor, RTP tap fra.\nRecording in Table: 2 track(s), RTP tap off.\nVoice-forbindelse / Voice connection: ready.\nAnn: last packet 3 s ago'
    );
  });
});
