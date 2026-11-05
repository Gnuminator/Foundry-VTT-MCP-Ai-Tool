import { describe, expect, it, vi } from 'vitest';

import {
  STREAM_WATCHDOG_MS,
  UPDATE_STALE_MS,
  ageText,
  healthParts,
  healthTrouble,
  type HealthInput,
  type HealthPart,
} from './health';
import type { BridgeStatus } from './stream';

// stream.ts pulls in auth.ts, which reads the page's location when it loads; there is no page here.
vi.mock('./auth', () => ({ streamUrl: (): string => '/api/stream' }));
vi.mock('./api', () => ({ callTool: vi.fn() }));

const NOW = Date.parse('2026-11-05T20:20:00.000Z');
const GOOD: BridgeStatus = {
  controlChannel: 'connected',
  foundry: 'reachable',
  lastError: null,
  lastPollAt: new Date(NOW - 4000).toISOString(),
  foundryDownSince: null,
};

function input(over: Partial<HealthInput> = {}): HealthInput {
  return {
    link: { state: 'open', since: NOW - 60_000 },
    heardAt: NOW - 5000,
    status: GOOD,
    now: NOW,
    ...over,
  };
}
const by = (parts: HealthPart[], key: string): HealthPart => parts.find(p => p.key === key)!;

describe('healthParts', () => {
  it('is four green parts in order when everything is fine', () => {
    const parts = healthParts(input());
    expect(parts.map(p => p.key)).toEqual(['dashboard', 'bridge', 'foundry', 'update']);
    expect(parts.map(p => p.tone)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(by(parts, 'update').text).toBe('4 s ago');
    expect(healthTrouble(parts)).toBe(false);
  });

  it('turns the dashboard part red after the 45 s watchdog', () => {
    const quiet = healthParts(input({ heardAt: NOW - STREAM_WATCHDOG_MS + 1000 }));
    expect(by(quiet, 'dashboard').tone).toBe('ok');
    const dead = healthParts(input({ heardAt: NOW - STREAM_WATCHDOG_MS - 1000 }));
    expect(by(dead, 'dashboard')).toMatchObject({ tone: 'bad' });
    expect(by(dead, 'dashboard').text).toContain('not live');
    expect(healthTrouble(dead)).toBe(true);
  });

  it('keeps a fresh drop amber and turns it red after the grace', () => {
    const at = (ago: number): HealthPart =>
      by(healthParts(input({ link: { state: 'dropped', since: NOW - ago } })), 'dashboard');
    expect(at(1000).tone).toBe('warn');
    expect(at(6000).tone).toBe('bad');
  });

  it('says what a dropped or closed stream is', () => {
    expect(
      by(healthParts(input({ link: { state: 'dropped', since: NOW } })), 'dashboard').text
    ).toBe('reconnecting');
    expect(
      by(healthParts(input({ link: { state: 'closed', since: NOW } })), 'dashboard').tone
    ).toBe('bad');
    expect(by(healthParts(input({ link: undefined, heardAt: null })), 'dashboard').tone).toBe(
      'unknown'
    );
  });

  it('shows the bridge away and Foundry down with the time', () => {
    const status: BridgeStatus = {
      ...GOOD,
      controlChannel: 'disconnected',
      foundry: 'unreachable',
      foundryDownSince: '2026-11-05T20:14:00.000Z',
    };
    const parts = healthParts(input({ status }));
    expect(by(parts, 'bridge')).toMatchObject({ tone: 'bad', text: 'away' });
    expect(by(parts, 'foundry').tone).toBe('bad');
    expect(by(parts, 'foundry').text).toMatch(/^down since \d/);
  });

  it('is unsure, not red, for an unknown Foundry state', () => {
    const parts = healthParts(input({ status: { ...GOOD, foundry: 'unknown' } }));
    expect(by(parts, 'foundry')).toMatchObject({ tone: 'warn', text: 'not sure' });
  });

  it('turns Last update amber past 30 s and grey before any poll', () => {
    const old = { ...GOOD, lastPollAt: new Date(NOW - UPDATE_STALE_MS - 1000).toISOString() };
    expect(by(healthParts(input({ status: old })), 'update').tone).toBe('warn');
    const none = { ...GOOD, lastPollAt: null };
    expect(by(healthParts(input({ status: none })), 'update')).toMatchObject({
      tone: 'unknown',
      text: 'none yet',
    });
  });
});

describe('ageText', () => {
  it('counts in seconds, minutes and hours', () => {
    expect(ageText(12_000)).toBe('12 s ago');
    expect(ageText(180_000)).toBe('3 min ago');
    expect(ageText(2 * 3600_000)).toBe('2 h ago');
  });
});
